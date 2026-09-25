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
      await opencodeClient.reloadConfig();
      refreshed.push('agent-profiles');

      res.json({ status: 'ok', refreshed });
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
