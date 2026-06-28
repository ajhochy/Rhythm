/**
 * OPC-M4-3 — MCP server management routes.
 *
 * Mounted at /opencode/mcp in app.ts.
 *
 * Routes:
 *   GET    /opencode/mcp                  → list all MCP servers (status map → array)
 *   POST   /opencode/mcp                  → add a new MCP server (name + command or url)
 *   POST   /opencode/mcp/:name/connect    → connect a named server
 *   POST   /opencode/mcp/:name/disconnect → disconnect a named server
 *   DELETE /opencode/mcp/:name            → remove a named server
 *
 * All SDK errors are forwarded to next(err) — the error handler converts
 * AppError instances to structured JSON with the correct HTTP status code.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import { opencodeClient } from '../services/opencode_engine';
import { mcpOAuthService } from '../services/mcp_oauth_engine';
import type { CuratedTokenResolver } from '../services/opencode_client_service';
import {
  CURATED_MCP_SERVERS,
  type CuratedMcpServer,
} from '../config/curated_mcp_servers';
import { IntegrationsService } from '../services/integrations_service';

export const opencodeMcpRouter = Router();

const integrationsService = new IntegrationsService();

/**
 * MCP-6 — build the token bridge resolver for a given Rhythm user. It reuses
 * the existing `ensureFresh*Account` refresh accessors so token refresh logic
 * is never reimplemented here. Returns `null` (→ skip the server) when the
 * account is not connected; `ensureFresh*Account` throws AppError(400) in that
 * case, which we map to `null` rather than propagating.
 */
function buildCuratedTokenResolver(userId: number): CuratedTokenResolver {
  return async (provider) => {
    try {
      const account =
        provider === 'google'
          ? await integrationsService.ensureFreshGoogleAccount(userId)
          : await integrationsService.ensureFreshPlanningCenterAccount(userId);
      return account.accessToken ?? null;
    } catch {
      // Not connected (or refresh failed) → signal "skip this server".
      return null;
    }
  };
}

/**
 * MCP-6 — redact every `environment` value in a curated server payload so a
 * bridged OAuth token never appears verbatim in an HTTP response. Mirrors the
 * '***' redaction the GET /opencode/mcp route applies (MCP-1).
 */
function redactServerEnv(server: CuratedMcpServer): CuratedMcpServer {
  if (!server.environment) return server;
  return {
    ...server,
    environment: Object.fromEntries(
      Object.keys(server.environment).map((k) => [k, '***']),
    ),
  };
}

/**
 * MCP-7 — find the curated catalog entry for a server addressed by either its
 * stable `id` (the opencode.json key) or its human-readable `name`. Returns
 * undefined when the name matches no curated server.
 */
function findCuratedServer(name: string): CuratedMcpServer | undefined {
  return CURATED_MCP_SERVERS.find((s) => s.id === name || s.name === name);
}

// ── GET / — list all MCP servers ────────────────────────────────────────────

opencodeMcpRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const statusMap = await opencodeClient.listMcp();
      const persistedConfigs = await opencodeClient.getPersistedMcpConfigs();

      const entries = Object.entries(statusMap).map(([name, entry]) => {
        const config = persistedConfigs[name];
        const envMap = config?.environment as Record<string, string> | undefined;
        const curated = findCuratedServer(name);
        const requiredEnv = curated?.requiredEnv ?? [];

        // #786 — provenance, DERIVED from the live status-map key cross-
        // referenced with the curated catalog. This is NOT a second display
        // list: the live engine list remains the sole source of which servers
        // exist (and their count), and the catalog only classifies/enriches.
        //   - 'rhythm'  → the brokered rhythm MCP (persisted under the key
        //                 'rhythm' by ensureRhythmMcp). Checked first so it is
        //                 never mistaken for an adhoc server.
        //   - 'curated' → matches a CURATED_MCP_SERVERS entry by id OR name.
        //   - 'adhoc'   → present in the live list but in neither of the above
        //                 (user-added/discovered; e.g. the `foo` test server).
        // Three-way split chosen (vs. a plain `curated: boolean`) because the
        // rhythm MCP is unambiguously identifiable by its stable key, so the
        // extra precision is free and useful to the UI.
        const source: 'curated' | 'rhythm' | 'adhoc' =
          name === 'rhythm' ? 'rhythm' : curated ? 'curated' : 'adhoc';

        // Redact env values
        const environment = envMap
          ? Object.fromEntries(Object.keys(envMap).map((k) => [k, '***']))
          : undefined;

        // needsCredentials:
        //   - remote → SDK status needs_auth.
        //   - curated key-based server with requiredEnv → any required key
        //     missing-or-empty in the persisted environment (MCP-7). This is
        //     what flags stripe/mailchimp persisted WITHOUT their key.
        //   - non-curated with an env map → preserve the existing empty-value
        //     behavior (any env VALUE empty).
        let needsCredentials = false;
        if (entry.status === 'needs_auth') {
          needsCredentials = true;
        } else if (requiredEnv.length > 0) {
          needsCredentials = requiredEnv.some(
            (k) => !envMap?.[k] || envMap[k].trim() === '',
          );
        } else if (envMap) {
          needsCredentials = Object.values(envMap).some((v) => !v || v.trim() === '');
        }

        return {
          name,
          ...entry,
          ...(environment !== undefined ? { environment } : {}),
          requiredEnv,
          needsCredentials,
          source,
        };
      });
      res.json(entries);
    } catch (err) {
      next(err);
    }
  },
);

// ── POST / — add a new MCP server ───────────────────────────────────────────

opencodeMcpRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, command, url, environment } = req.body as {
        name?: string;
        command?: string;
        url?: string;
        environment?: Record<string, string>;
      };

      if (!name || typeof name !== 'string' || name.trim() === '') {
        return next(
          new AppError(400, 'BAD_REQUEST', 'name is required to add an MCP server'),
        );
      }

      if ((!command || command.trim() === '') && (!url || url.trim() === '')) {
        return next(
          new AppError(
            400,
            'BAD_REQUEST',
            'Either command (for local servers) or url (for remote servers) is required',
          ),
        );
      }

      let config: import('@opencode-ai/sdk').McpLocalConfigInput | import('@opencode-ai/sdk').McpRemoteConfigInput;

      if (url && url.trim() !== '') {
        config = { type: 'remote', url: url.trim() };
      } else {
        // Split command string into argv array.
        const argv = (command as string).trim().split(/\s+/);
        const localConfig: import('@opencode-ai/sdk').McpLocalConfigInput = {
          type: 'local',
          command: argv,
        };
        if (environment && typeof environment === 'object') {
          localConfig.environment = environment;
        }
        config = localConfig;
      }

      const updated = await opencodeClient.addMcp(name.trim(), config);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /rhythm/ensure — auto-install/refresh the rhythm MCP server ─────────
opencodeMcpRouter.post(
  '/rhythm/ensure',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { apiToken, apiUrl } = req.body as {
        apiToken?: string;
        apiUrl?: string;
      };
      if (!apiToken || apiToken.trim() === '') {
        return next(new AppError(400, 'BAD_REQUEST', 'apiToken is required'));
      }
      const result = await opencodeClient.ensureRhythmMcp(
        apiToken.trim(),
        (apiUrl && apiUrl.trim()) || 'https://api.vcrcapps.com',
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /curated/ensure — idempotently install the curated MCP servers ──────
opencodeMcpRouter.post(
  '/curated/ensure',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // MCP-6 — when a user is resolvable, bridge their stored Google/PCO
      // OAuth tokens into the token-bridged curated servers. Without a user
      // (unauthenticated agent-local call) the resolver is omitted, so
      // token-bridged servers are simply skipped — zero-auth servers still
      // install.
      const userId = req.auth?.user.id;
      const tokenResolver =
        userId != null ? buildCuratedTokenResolver(userId) : undefined;

      const result = await opencodeClient.ensureCuratedMcps({ tokenResolver });

      // Redact any environment values (bridged tokens) before responding —
      // tokens may be written to opencode.json but never echoed over HTTP.
      res.json({
        ...result,
        servers: result.servers.map(redactServerEnv),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /:name/credentials — set typed credentials for a curated key-based server ──
//
// MCP-7 — curated LOCAL servers (stripe, mailchimp) declare `requiredEnv` but no
// key is injected at install (the token bridge only handles Google/PCO). This
// endpoint accepts the user-entered secret(s), validates them against the
// curated `requiredEnv`, builds the opencode config from the curated def, and
// persists+reconnects via `addMcp`. Only curated LOCAL servers take typed
// credentials here — remote (OAuth) servers use the /:name/oauth/* flow.
opencodeMcpRouter.post(
  '/:name/credentials',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      const curated = findCuratedServer(name);
      if (!curated) {
        return next(
          new AppError(
            404,
            'NOT_CURATED',
            `'${name}' is not a curated MCP server`,
          ),
        );
      }
      // Only local/key-based servers accept typed credentials. Remote servers
      // have no `command` and authenticate via OAuth, not env keys.
      if (curated.type !== 'local' || !curated.command) {
        return next(
          new AppError(
            400,
            'NOT_KEY_BASED',
            `'${curated.id}' is not a key-based local MCP server`,
          ),
        );
      }

      const body = req.body as { environment?: Record<string, string> };
      const provided =
        body.environment && typeof body.environment === 'object'
          ? body.environment
          : {};

      // Validate: every required key must have a non-empty value. Strip any
      // keys not in requiredEnv (never let the client inject arbitrary env).
      const validated: Record<string, string> = {};
      const missing: string[] = [];
      for (const key of curated.requiredEnv) {
        const value = provided[key];
        if (typeof value !== 'string' || value.trim() === '') {
          missing.push(key);
        } else {
          validated[key] = value;
        }
      }
      if (missing.length > 0) {
        return next(
          new AppError(
            400,
            'MISSING_CREDENTIALS',
            `Missing required credential(s): ${missing.join(', ')}`,
          ),
        );
      }

      // Build the config from the curated def — merge user values over any base
      // environment the curated def carries (stripe/mailchimp have none).
      const config: import('@opencode-ai/sdk').McpLocalConfigInput = {
        type: 'local',
        command: curated.command,
        environment: { ...(curated.environment ?? {}), ...validated },
      };

      const updated = await opencodeClient.addMcp(curated.id, config);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ── MCP remote-OAuth workaround (DCR + PKCE, bypassing the broken SDK auth) ──
//
// opencode's SDK auth path never registers the OAuth state, so we run the
// whole flow ourselves and write tokens into mcp-auth.json. These two routes
// drive that: start() returns the consent URL; the UI polls status().

/**
 * Resolve the remote serverUrl for a named MCP server. Prefers the curated
 * catalog (the canonical source for canva/notion), then falls back to the
 * persisted opencode.json `mcp` config (a remote `url`). Returns null when the
 * name is unknown or is not a remote server (no OAuth flow applies).
 */
async function resolveRemoteServerUrl(name: string): Promise<string | null> {
  const curated = CURATED_MCP_SERVERS.find((s) => s.id === name);
  if (curated && curated.type === 'remote' && curated.url) {
    return curated.url;
  }
  const persisted = await opencodeClient.getPersistedMcpConfigs();
  const entry = persisted[name];
  if (entry && entry.type === 'remote' && typeof entry.url === 'string') {
    return entry.url;
  }
  return null;
}

// ── POST /:name/oauth/start ──────────────────────────────────────────────────
opencodeMcpRouter.post(
  '/:name/oauth/start',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      const serverUrl = await resolveRemoteServerUrl(name);
      if (!serverUrl) {
        return next(
          new AppError(
            400,
            'BAD_REQUEST',
            `'${name}' is not a known remote OAuth MCP server`,
          ),
        );
      }
      const { authorizationUrl } = await mcpOAuthService.start(name, serverUrl);
      res.json({ authorizationUrl });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /:name/oauth/status ──────────────────────────────────────────────────
opencodeMcpRouter.get(
  '/:name/oauth/status',
  (req: Request, res: Response) => {
    const { name } = req.params;
    res.json({ status: mcpOAuthService.status(name) });
  },
);

// ── POST /:name/connect ──────────────────────────────────────────────────────

opencodeMcpRouter.post(
  '/:name/connect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      const result = await opencodeClient.connectMcp(name);
      res.json({
        ok: result.connected,
        authorizationUrl: result.authorizationUrl ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /:name/disconnect ───────────────────────────────────────────────────

opencodeMcpRouter.post(
  '/:name/disconnect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      const ok = await opencodeClient.disconnectMcp(name);
      res.json({ ok });
    } catch (err) {
      next(err);
    }
  },
);

// ── DELETE /:name ─────────────────────────────────────────────────────────────

opencodeMcpRouter.delete(
  '/:name',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      await opencodeClient.removeMcp(name);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
