/**
 * #948 — POST /system/refresh
 *
 * Hot-reloads in-memory caches that a config-repair agent (Config Doctor, org
 * optimizer, skill extractor) cannot otherwise invalidate without a full
 * server restart. Lets the agent edit a SKILL.md on disk and then verify the
 * fix in the same session via a sub-agent.
 *
 * Today the only memoized caches are the opencode engine's skill discovery
 * (OpencodeClientService.reloadSkills → fork POST /skill/reload) and the global
 * config cache (OpencodeClientService.reloadConfig → fork POST /config/reload,
 * which holds agent profiles merged from ~/.config/opencode/agent(s)/*.md).
 * Agent profiles, tasks, and recipes are otherwise DB-read-through — no other
 * in-memory cache to clear. The `refreshed` array lists what was actually
 * reloaded so the caller knows what took effect; new caches get appended here.
 *
 * Auth: same `requireAuth` + AGENT_LOCAL bypass as every other agent surface —
 * on the local agent server (:4001) the loopback is the trust boundary, on
 * hosted prod a real Bearer session token is required. Mounted only inside the
 * `agentExecutionEnabled` gate because the opencode engine it talks to only
 * exists when the agent runtime is stood up.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { opencodeClient } from '../services/opencode_engine';
import { streamBridge } from '../services/opencode_stream_bridge';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { resetProbeCache } from '../services/provider_catalog_policy';

export const systemRouter = Router();
const sessionsRepository = new AgentSessionsRepository();

type RestartResult =
  | { status: 'ready'; bootId: string; previousBootId: string | null }
  | { status: 'blocked'; reason: 'active work'; blockers: RestartBlocker[] }
  | { status: 'unavailable'; statusMessage: string };

type RestartBlocker =
  | { type: 'session'; id: string; name: string | null; status: string }
  | { type: 'permission'; sessionId: string; permissionId: string; toolName: string; summary: string };

let restartInProgress: Promise<RestartResult> | null = null;

function restartTimeoutMs(): number {
  const parsed = Number(process.env.RHYTHM_ENGINE_RESTART_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

function restartBlockers(): RestartBlocker[] {
  return [
    ...sessionsRepository
      .listActive()
      .filter((session) => session.status === 'starting' || session.status === 'working')
      .map((session) => ({
        type: 'session' as const,
        id: session.id,
        name: session.name,
        status: session.status,
      })),
    ...streamBridge.listPendingPermissions().map((permission) => ({
      type: 'permission' as const,
      ...permission,
    })),
  ];
}

async function restartEngine(): Promise<RestartResult> {
  const previousIdentity = await opencodeClient.getEngineIdentity();
  const blockers = restartBlockers();
  if (blockers.length > 0) return { status: 'blocked', reason: 'active work', blockers };
  await opencodeClient.reloadCredentials();
  const ready = await opencodeClient.ensureReady();
  const currentIdentity = ready ? await opencodeClient.getEngineIdentity() : null;
  if (!ready || !currentIdentity) {
    return {
      status: 'unavailable',
      statusMessage: opencodeClient.statusMessage,
    };
  }
  if (previousIdentity && currentIdentity.bootId === previousIdentity.bootId) {
    return {
      status: 'unavailable',
      statusMessage: 'OpenCode engine did not report a new boot ID after restart',
    };
  }
  return {
    status: 'ready',
    bootId: currentIdentity.bootId,
    previousBootId: previousIdentity?.bootId ?? null,
  };
}

if (!env.agentLocal) systemRouter.use(requireAuth);

const configDigestKey = randomBytes(32);
let lastObserved: { config: string; engine: string } | undefined;

// ponytail: only digest trusted provider metadata, not credentials or headers.
async function providerConfigStatus(): Promise<{
  restart_required: boolean | null;
  reason: string;
}> {
  let configured: Record<
    string,
    {
      models?: Record<string, unknown>;
      options?: Record<string, unknown>;
      whitelist?: string[];
      blacklist?: string[];
    }
  >;
  let enabled: string[] | undefined;
  let disabled: string[] = [];
  try {
    const snapshot = JSON.parse(
      readFileSync(
        join(homedir(), '.config/opencode/opencode.json'),
        'utf8',
      ),
    );
    configured =
      snapshot.provider && typeof snapshot.provider === 'object'
        ? snapshot.provider
        : {};
    enabled = Array.isArray(snapshot.enabled_providers)
      ? snapshot.enabled_providers
      : undefined;
    disabled = Array.isArray(snapshot.disabled_providers)
      ? snapshot.disabled_providers
      : [];
  } catch {
    return { restart_required: null, reason: 'config_unavailable' };
  }
  try {
    const snapshot = await opencodeClient.providerSnapshot();
    const engine = new Map(
      snapshot.providers.map((provider) => [
        provider.id,
        new Set(provider.models.map((model) => model.id)),
      ]),
    );
    const active = Object.entries(configured).filter(
      ([id]) => !disabled.includes(id) && (!enabled || enabled.includes(id)),
    );
    const configDigest = createHmac('sha256', configDigestKey)
      .update(
        JSON.stringify(
          active
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, value]) => [
              id,
              Object.keys(value?.models ?? {})
                .filter(
                  (model) =>
                    !value?.whitelist || value.whitelist.includes(model),
                )
                .filter((model) => !value?.blacklist?.includes(model))
                .sort(),
              value?.options ?? null,
              value.whitelist ?? null,
              value.blacklist ?? null,
            ]),
        ),
      )
      .digest('hex');
    const engineDigest = createHmac('sha256', configDigestKey)
      .update(
        JSON.stringify(
          snapshot.providers
            .map(({ id, digest }) => [id, digest])
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      )
      .digest('hex');
    const drift = active.some(
      ([id, value]) =>
        !engine.has(id) ||
        Object.keys(value?.models ?? {})
          .filter(
            (model) => !value?.whitelist || value.whitelist.includes(model),
          )
          .filter((model) => !value?.blacklist?.includes(model))
          .some((modelId) => !engine.get(id)?.has(modelId)),
    );
    const configChanged =
      !drift &&
      lastObserved &&
      lastObserved.config !== configDigest &&
      lastObserved.engine === engineDigest;
    if (!drift && !configChanged) {
      lastObserved = { config: configDigest, engine: engineDigest };
    }
    return {
      restart_required: Boolean(drift || configChanged),
      reason: drift
        ? 'provider_drift'
        : configChanged
          ? 'config_changed'
          : 'in_sync',
    };
  } catch {
    return { restart_required: null, reason: 'engine_unverified' };
  }
}

/** Capture the engine-loaded configuration once initialization has completed. */
export async function captureProviderConfigBaseline(): Promise<void> {
  await providerConfigStatus();
}

systemRouter.get('/config/status', async (_req: Request, res: Response) => {
  res.json(await providerConfigStatus());
});

systemRouter.post(
  '/refresh',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshed: string[] = [];

      // Engine skill discovery is memoized per-instance; re-scan now.
      await opencodeClient.reloadSkills();
      refreshed.push('skills');

      // Global config cache (Duration.infinity TTL) holds agent profiles merged
      // from disk. Without this invalidate, a Config Doctor edit to an agent
      // file is invisible to new sessions until the engine restarts.
      const configReloaded = await opencodeClient.reloadConfig();
      resetProbeCache();
      const configStatus = await providerConfigStatus();
      const restartRequired =
        !configReloaded || configStatus.restart_required === true;
      if (configReloaded) refreshed.push('agent-profiles');

      res.json({
        status: restartRequired
          ? 'restart_required'
          : configStatus.restart_required === null
            ? 'unknown'
            : 'ok',
        refreshed,
        restart_required:
          restartRequired || configStatus.restart_required === null
            ? restartRequired
              ? true
              : null
            : false,
        reason: !configReloaded ? 'reload_failed' : configStatus.reason,
      });
    } catch (err) {
      next(err);
    }
  },
);

systemRouter.post('/restart-engine', async (_req: Request, res: Response) => {
  if (restartInProgress) {
    res.status(409).json({
      status: 'blocked',
      reason: 'restart in progress',
      blockers: [{ type: 'restart', message: 'Engine restart already in progress' }],
    });
    return;
  }

  const blockers = restartBlockers();
  if (blockers.length > 0) {
    res.status(409).json({
      status: 'blocked',
      reason: 'active work',
      blockers,
    });
    return;
  }

  const operation = restartEngine().catch((): RestartResult => ({
    status: 'unavailable',
    statusMessage: opencodeClient.statusMessage,
  }));
  restartInProgress = operation;
  void operation.finally(() => {
    if (restartInProgress === operation) restartInProgress = null;
  });

  const timeout = new Promise<RestartResult>((resolve) => {
    setTimeout(() => resolve({
      status: 'unavailable',
      statusMessage: opencodeClient.statusMessage,
    }), restartTimeoutMs()).unref();
  });
  const result = await Promise.race([operation, timeout]);
  if (result.status === 'blocked') {
    res.status(409).json(result);
    return;
  }
  if (result.status === 'unavailable') {
    res.status(503).json(result);
    return;
  }
  res.json(result);
});
