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
import { canonicalize } from '../utils/path_containment';

export const opencodeWorktreesRouter = Router();

function requireDirectory(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(400, 'BAD_REQUEST', 'directory (the project cwd) is required');
  }
  return value;
}

/**
 * Validate that `worktreeDir` is an ACTUAL worktree the engine created for
 * `directory` before proxying to the engine's destructive remove/reset
 * endpoints — see #1133.
 *
 * NOTE 1: engine-created worktrees do NOT live inside `directory` — the fork
 * creates them under a global app-data root keyed by project id
 * (`Global.Path.data/worktree/<projectId>/<name>`, see
 * apps/opencode_fork/packages/opencode/src/worktree/index.ts
 * `makeWorktreeInfo`). A "worktreeDir must be inside directory" containment
 * check (the first attempt at this fix) is the WRONG predicate — it rejects
 * every genuine worktree.
 *
 * NOTE 2: `opencodeClient.listWorktrees(directory)` resolves to `string[]`
 * (a list of directory paths) — NOT `{name,branch,directory}` objects (the
 * second attempt at this fix compared against `.directory` on each entry,
 * which is `undefined` on a plain string, so EVERY worktreeDir — legit or
 * not — failed to match. Verified against the real engine via curl: `GET
 * /experimental/worktree` returns `project.sandboxes(projectId)`, a plain
 * string array; see the `opencodeClient.listWorktrees` doc comment).
 *
 * Validate against this list (the engine's own authoritative source of
 * truth for `directory`, already populated synchronously by the time
 * `POST /opencode/worktrees` returns — see `Worktree.Service.create` →
 * `setup()` → `addSandbox`, awaited before the response is sent; only the
 * *canonical* duplicate entry is added later via the forked `boot()`, so no
 * registration-lag window exists for the raw form `create()` just
 * returned). Canonicalizing (realpath, fail-closed) both sides before
 * comparing still rejects a symlink/garbage path — it just won't match any
 * registered entry.
 */
async function requireRegisteredWorktreeDir(directory: string, worktreeDir: unknown): Promise<string> {
  const dir = requireDirectory(worktreeDir);
  let canonicalTarget: string;
  try {
    canonicalTarget = canonicalize(dir);
  } catch {
    throw new AppError(400, 'PATH_TRAVERSAL', `worktreeDir '${dir}' could not be resolved`);
  }

  const worktrees = await opencodeClient.listWorktrees(directory);
  const registered = worktrees.some((entry) => {
    try {
      return canonicalize(entry) === canonicalTarget;
    } catch {
      return false;
    }
  });
  if (!registered) {
    throw new AppError(400, 'PATH_TRAVERSAL', `worktreeDir '${dir}' is not a registered worktree of '${directory}'`);
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
    const worktreeDir = await requireRegisteredWorktreeDir(directory, body.worktreeDir);
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
    const worktreeDir = await requireRegisteredWorktreeDir(directory, body.worktreeDir);
    const ok = await opencodeClient.resetWorktree(directory, worktreeDir);
    if (!ok) return next(new AppError(502, 'WORKTREE_RESET_FAILED', 'engine failed to reset worktree'));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
