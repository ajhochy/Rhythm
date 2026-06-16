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
import type { CuratedTokenResolver } from '../services/opencode_client_service';
import type { CuratedMcpServer } from '../config/curated_mcp_servers';
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

        // Redact env values
        const environment = envMap
          ? Object.fromEntries(Object.keys(envMap).map((k) => [k, '***']))
          : undefined;

        // needsCredentials: local → any env value empty; remote → SDK status needs_auth
        let needsCredentials = false;
        if (entry.status === 'needs_auth') {
          needsCredentials = true;
        } else if (envMap) {
          needsCredentials = Object.values(envMap).some((v) => !v || v.trim() === '');
        }

        return {
          name,
          ...entry,
          ...(environment !== undefined ? { environment } : {}),
          needsCredentials,
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

// ── POST /:name/connect ──────────────────────────────────────────────────────

opencodeMcpRouter.post(
  '/:name/connect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      const ok = await opencodeClient.connectMcp(name);
      res.json({ ok });
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
