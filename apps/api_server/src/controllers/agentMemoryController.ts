import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { agentMemoryService } from '../services/agentMemoryService';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { syncMemoryVault } from '../services/memoryVaultSyncService';

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

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { kind, content, source, sourceId, tags } = req.body as Record<string, unknown>;
      if (!content || typeof content !== 'string') throw AppError.badRequest('content is required');
      const item = await agentMemoryService.remember({
        kind: typeof kind === 'string' ? kind : 'fact',
        content,
        source: typeof source === 'string' ? source : 'manual',
        sourceId: typeof sourceId === 'string' ? sourceId : undefined,
        tagsJson: Array.isArray(tags) ? JSON.stringify(tags) : '[]',
        ownerUserId: req.auth?.user.id,
      });
      res.status(201).json(item);
    } catch (err) { next(err); }
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
