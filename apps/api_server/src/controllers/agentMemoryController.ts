import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { agentMemoryService } from '../services/agentMemoryService';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { syncMemoryVault } from '../services/memoryVaultSyncService';
import {
  MemoryWriteError,
  type RememberInput,
} from '../services/memoryVaultWriteService';
import {
  MCP_MEMORY_ACTOR,
  formatActor,
} from '../services/memory_note_format';
import { logger } from '../utils/logger';

const repo = new AgentMemoryRepository();
const sessionsRepo = new AgentSessionsRepository();

function resolveHumanActor(req: Request): {
  actor: string;
  ownerUserId: number;
} {
  const user = req.auth?.user;
  if (!user) {
    throw AppError.unauthorized(
      'Authentication is required to record human memory verification.',
    );
  }
  return {
    actor: formatActor({
      kind: 'human',
      id: user.email || String(user.id),
    }),
    ownerUserId: user.id,
  };
}

export class AgentMemoryController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.auth?.user.id;
      const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
      const limit = req.query.limit ? Math.min(200, parseInt(String(req.query.limit), 10)) : 50;
      const items = await agentMemoryService.list(userId, kind, limit);
      res.json(items);
    } catch (err) { next(err); }
  }

  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      if (!q.trim()) throw AppError.badRequest('q (search query) is required');
      const userId = req.auth?.user.id;
      const limit = req.query.limit ? Math.min(100, parseInt(String(req.query.limit), 10)) : 20;
      const results = await agentMemoryService.search(q, userId, limit);
      res.json(results);
    } catch (err) { next(err); }
  }

  /**
   * Issue #803 — vault-first `remember`. Writes a markdown note to the
   * Memory-Vault FIRST (folders-by-type at `<memoryDir>/<kind>/<slug>.md`),
   * then upserts the derived index, so `GET /search` reflects it immediately.
   * Returns `{ id, path, kind }`. A bad `kind` or a path that would escape the
   * memory dir is rejected 4xx (nothing written) by mapping MemoryWriteError.
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        kind,
        content,
        id,
        source,
        sourceId,
        sessionId,
        sdkSessionId,
        sources,
        usageWindow,
        tags,
      } = req.body as Record<string, unknown>;
      if (!content || typeof content !== 'string') throw AppError.badRequest('content is required');
      const ambientSession = typeof sdkSessionId === 'string'
        ? sessionsRepo.findBySdkSessionId(sdkSessionId)
        : null;
      if (typeof sdkSessionId === 'string' && sdkSessionId !== '' && !ambientSession) {
        logger.warn(
          '[AgentMemory] ambient SDK session had no local mapping; provenance omitted',
        );
      }
      const result = await agentMemoryService.remember({
        kind: typeof kind === 'string' ? kind : 'fact',
        content,
        id: typeof id === 'string' ? id : undefined,
        source: typeof source === 'string' ? source : 'agent',
        sourceId: typeof sourceId === 'string' ? sourceId : undefined,
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
        contextSessionId: ambientSession?.id,
        sources: Array.isArray(sources)
          ? sources as RememberInput['sources']
          : undefined,
        usageWindow: usageWindow && typeof usageWindow === 'object' &&
            !Array.isArray(usageWindow)
          ? usageWindow as RememberInput['usageWindow']
          : undefined,
        tags: Array.isArray(tags) ? tags.map((t) => String(t)) : [],
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof MemoryWriteError) return next(AppError.badRequest(err.message));
      next(err);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await repo.findByIdAsync(req.params.id);
      if (!item) throw AppError.notFound('AgentMemory');
      res.json(item);
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const deleted = await agentMemoryService.forget(req.params.id);
      if (!deleted) throw AppError.notFound('AgentMemory');
      res.status(204).end();
    } catch (err) { next(err); }
  }

  /**
   * Issue #862 — edit-in-place. Updates content/kind/tags for an existing
   * memory, writing through to BOTH the vault note file AND the derived
   * index. Resolves `:id` the same way `remove` does (DB row id OR the
   * frontmatter ULID `remember()` returns — #859d). 404 when no memory
   * exists for `id`; a bad `kind` or content that would end up empty is
   * rejected 4xx (nothing written) by mapping MemoryWriteError.
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { content, kind, tags } = req.body as Record<string, unknown>;
      const patch: { content?: string; kind?: string; tags?: string[] } = {};
      if (content !== undefined) {
        if (typeof content !== 'string' || content.trim() === '') {
          throw AppError.badRequest('content must be a non-empty string');
        }
        patch.content = content;
      }
      if (kind !== undefined) {
        if (typeof kind !== 'string') throw AppError.badRequest('kind must be a string');
        patch.kind = kind;
      }
      if (tags !== undefined) {
        if (!Array.isArray(tags)) throw AppError.badRequest('tags must be an array');
        patch.tags = tags.map((t) => String(t));
      }
      const result = await agentMemoryService.update(req.params.id, patch);
      if (!result) throw AppError.notFound('AgentMemory');
      // Return the full updated row (content/tags/timestamps), not just the
      // vault {id, path, kind} triple, so callers (e.g. the desktop app) can
      // refresh their view of the entry without a second round-trip. The
      // index row is keyed by vault-relative path (result.path), NOT
      // result.id (the frontmatter ULID) — findByIdAsync needs the DB row id.
      const rows = await repo.listAsync(undefined, undefined, 1000);
      const item = rows.find((r) => r.sourceId === result.path);
      res.json(item ?? result);
    } catch (err) {
      if (err instanceof MemoryWriteError) return next(AppError.badRequest(err.message));
      next(err);
    }
  }

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const { staleAfter } = req.body as Record<string, unknown>;
      if (staleAfter !== undefined && typeof staleAfter !== 'string') {
        throw AppError.badRequest('staleAfter must be a YYYY-MM-DD string');
      }
      const identity = resolveHumanActor(req);
      const result = await agentMemoryService.verify(
        req.params.id,
        identity.actor,
        identity.ownerUserId,
        { staleAfter },
      );
      if (!result) throw AppError.notFound('AgentMemory');
      const rows = await repo.listAsync(undefined, undefined, 1000);
      res.json(rows.find((row) => row.sourceId === result.path) ?? result);
    } catch (err) {
      if (err instanceof MemoryWriteError) {
        return next(AppError.badRequest(err.message));
      }
      next(err);
    }
  }

  async deprecate(req: Request, res: Response, next: NextFunction) {
    try {
      const identity = resolveHumanActor(req);
      const result = await agentMemoryService.deprecate(
        req.params.id,
        identity.actor,
        identity.ownerUserId,
      );
      if (!result) throw AppError.notFound('AgentMemory');
      const rows = await repo.listAsync(undefined, undefined, 1000);
      res.json(rows.find((row) => row.sourceId === result.path) ?? result);
    } catch (err) {
      if (err instanceof MemoryWriteError) {
        return next(AppError.badRequest(err.message));
      }
      next(err);
    }
  }

  /**
   * Local MCP-only actor lane. The caller selects an action, never an identity:
   * every event is stamped with the fixed machine actor on the server.
   */
  async agentLifecycle(req: Request, res: Response, next: NextFunction) {
    try {
      const { action, staleAfter } = req.body as Record<string, unknown>;
      if (action !== 'verify' && action !== 'deprecate') {
        throw AppError.badRequest('action must be verify or deprecate');
      }
      if (staleAfter !== undefined && typeof staleAfter !== 'string') {
        throw AppError.badRequest('staleAfter must be a YYYY-MM-DD string');
      }
      const result = action === 'verify'
        ? await agentMemoryService.verify(
            req.params.id,
            MCP_MEMORY_ACTOR,
            undefined,
            { staleAfter },
          )
        : await agentMemoryService.deprecate(
            req.params.id,
            MCP_MEMORY_ACTOR,
          );
      if (!result) throw AppError.notFound('AgentMemory');
      const rows = await repo.listAsync(undefined, undefined, 1000);
      res.json(rows.find((row) => row.sourceId === result.path) ?? result);
    } catch (err) {
      if (err instanceof MemoryWriteError) {
        return next(AppError.badRequest(err.message));
      }
      next(err);
    }
  }

  /**
   * Issue #770 WI6 — manual trigger for the Memory-Vault → agent_memory
   * mirror-sync. Reads all notes from the configured Memory-Vault path and
   * upserts/tombstones them. Returns a summary {scanned, upserted, deleted}.
   * A missing vault path is reported as a no-op summary (all zeros), not a 500.
   */
  async sync(_req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await syncMemoryVault();
      res.json(summary);
    } catch (err) { next(err); }
  }
}
