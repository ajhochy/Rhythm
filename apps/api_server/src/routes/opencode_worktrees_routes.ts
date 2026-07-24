/**
 * OCU-16 (#1057) — worktree lifecycle REST surface.
 *
 * Thin proxy over the engine's experimental worktree endpoints, scoped by the
 * project `directory` (the project/session cwd). The `worktree.ready` /
 * `worktree.failed` engine events are relayed as first-class WS frames by the
 * stream bridge (see opencode_stream_bridge.ts) — not here.
 *
 * Mounted at /opencode/worktrees:
 *   GET    /?directory=<projectDir>              → list worktrees
 *   POST   /   { directory, name?, startCommand? } → create a worktree
 *   DELETE /   { directory, worktreeDir }          → remove a worktree
 *   POST   /reset { directory, worktreeDir }       → reset a worktree branch
 */

import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import { opencodeClient } from '../services/opencode_engine';
import { containsReal } from '../utils/path_containment';

export const opencodeWorktreesRouter = Router();

function requireDirectory(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(400, 'BAD_REQUEST', 'directory (the project cwd) is required');
  }
  return value;
}

/**
 * Validate that `worktreeDir` is actually inside `directory`'s worktree tree
 * before proxying to the engine's remove/reset endpoints (which perform
 * destructive filesystem operations). Canonicalizes both with realpath
 * (fail-closed) so a symlink can't be used to point the engine at a directory
 * outside the project — see #1133.
 */
function requireContainedWorktreeDir(directory: string, worktreeDir: unknown): string {
  const dir = requireDirectory(worktreeDir);
  if (!containsReal(directory, dir)) {
    throw new AppError(400, 'PATH_TRAVERSAL', `worktreeDir '${dir}' is not inside directory '${directory}'`);
  }
  return dir;
}

opencodeWorktreesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const directory = requireDirectory(req.query.directory);
    res.json(await opencodeClient.listWorktrees(directory));
  } catch (err) {
    next(err);
  }
});

opencodeWorktreesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { directory?: unknown; name?: string; startCommand?: string };
    const directory = requireDirectory(body.directory);
    const created = await opencodeClient.createWorktree(directory, {
      name: body.name,
      startCommand: body.startCommand,
    });
    res.json(created);
  } catch (err) {
    next(err);
  }
});

opencodeWorktreesRouter.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { directory?: unknown; worktreeDir?: unknown };
    const directory = requireDirectory(body.directory);
    const worktreeDir = requireContainedWorktreeDir(directory, body.worktreeDir);
    const ok = await opencodeClient.removeWorktree(directory, worktreeDir);
    if (!ok) return next(new AppError(502, 'WORKTREE_REMOVE_FAILED', 'engine failed to remove worktree'));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

opencodeWorktreesRouter.post('/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { directory?: unknown; worktreeDir?: unknown };
    const directory = requireDirectory(body.directory);
    const worktreeDir = requireContainedWorktreeDir(directory, body.worktreeDir);
    const ok = await opencodeClient.resetWorktree(directory, worktreeDir);
    if (!ok) return next(new AppError(502, 'WORKTREE_RESET_FAILED', 'engine failed to reset worktree'));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
