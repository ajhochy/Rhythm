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

export const systemRouter = Router();

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
