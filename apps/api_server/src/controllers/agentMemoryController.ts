import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { agentMemoryService } from '../services/agentMemoryService';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { syncMemoryVault } from '../services/memoryVaultSyncService';
import { MemoryWriteError } from '../services/memoryVaultWriteService';

const repo = new AgentMemoryRepository();

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
      const { kind, content, id, source, tags } = req.body as Record<string, unknown>;
      if (!content || typeof content !== 'string') throw AppError.badRequest('content is required');
      const result = await agentMemoryService.remember({
        kind: typeof kind === 'string' ? kind : 'fact',
        content,
        id: typeof id === 'string' ? id : undefined,
        source: typeof source === 'string' ? source : 'agent',
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
