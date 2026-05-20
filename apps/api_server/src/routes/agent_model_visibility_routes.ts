/**
 * Issue #609 — Agent model visibility endpoints.
 *
 * GET  /agent-models/visibility
 *   Returns [{provider, modelId, visible}] from agent_model_visibility.
 *
 * PATCH /agent-models/visibility
 *   Body: { updates: [{ provider, modelId, visible }] }
 *   Bulk upsert into agent_model_visibility.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { getDb } from '../database/db';

export const agentModelVisibilityRouter = Router();

if (!env.agentLocal) agentModelVisibilityRouter.use(requireAuth);

agentModelVisibilityRouter.get('/', (_req: Request, res: Response) => {
  try {
    const rows = getDb()
      .prepare(`SELECT provider, model_id, visible FROM agent_model_visibility`)
      .all() as { provider: string; model_id: string; visible: number }[];
    res.json(
      rows.map((r) => ({
        provider: r.provider,
        modelId: r.model_id,
        visible: r.visible === 1,
      })),
    );
  } catch (err) {
    console.error('[agent-models/visibility] GET error:', err);
    res.json([]);
  }
});

agentModelVisibilityRouter.patch(
  '/',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updates = body.updates;
      if (!Array.isArray(updates)) {
        res.status(400).json({ error: 'updates must be an array' });
        return;
      }

      const upsert = getDb().prepare(
        `INSERT INTO agent_model_visibility (provider, model_id, visible)
         VALUES (?, ?, ?)
         ON CONFLICT(provider, model_id) DO UPDATE SET visible = excluded.visible`,
      );

      const runAll = getDb().transaction(
        (
          rows: Array<{ provider: string; modelId: string; visible: boolean }>,
        ) => {
          for (const row of rows) {
            if (
              typeof row.provider !== 'string' ||
              typeof row.modelId !== 'string' ||
              typeof row.visible !== 'boolean'
            ) {
              throw new Error(
                `Invalid visibility row: ${JSON.stringify(row)}`,
              );
            }
            upsert.run(row.provider, row.modelId, row.visible ? 1 : 0);
          }
        },
      );

      runAll(
        updates as Array<{
          provider: string;
          modelId: string;
          visible: boolean;
        }>,
      );
      res.json({ updated: updates.length });
    } catch (err) {
      next(err);
    }
  },
);
