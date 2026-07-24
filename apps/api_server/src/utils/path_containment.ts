/**
 * Path-containment guard for #1133 (CWE-59/CWE-22): canonicalize with
 * realpath before deciding whether a target path is inside a boundary
 * directory. A lexical `path.resolve` + `startsWith` check (the previous
 * approach in resolveSessionDir / the worktree routes) can be fooled by a
 * symlink that lives inside the boundary but points outside it.
 *
 * Mirrors apps/opencode_fork/packages/core/src/filesystem.ts `containsReal` —
 * keep the two in sync if the algorithm changes.
 */
import { dirname, basename, join, relative, resolve as pathResolve } from 'path';
import { lstatSync, realpathSync } from 'fs';

/**
 * Canonicalize `p` with realpath, fail-closed.
 *
 * If `p` doesn't exist yet, walks up to the nearest existing ancestor,
 * canonicalizes that, and rejoins the missing tail segments. Throws on
 * anything other than a missing segment — a dangling symlink (its target
 * doesn't exist), EACCES, ELOOP, or no existing ancestor at all — so this
 * must not be treated as "safe" by a bare catch.
 */
export function canonicalize(p: string): string {
  let current = pathResolve(p);
  const tail: string[] = [];
  while (true) {
    try {
      return tail.length ? join(realpathSync(current), ...tail) : realpathSync(current);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
      let dangling = false;
      try {
        dangling = lstatSync(current).isSymbolicLink();
      } catch {
        // current doesn't exist at all (not even as a symlink) — legitimate walk-up
      }
      if (dangling) throw e;
      const parent = dirname(current);
      if (parent === current) throw e;
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Is `target` inside `root`, after canonicalizing both with realpath?
 * Fails closed: any resolution error (dangling symlink, EACCES, ELOOP, no
 * existing ancestor) returns `false`.
 */
export function containsReal(root: string, target: string): boolean {
  try {
    return !relative(canonicalize(root), canonicalize(target)).startsWith('..');
  } catch {
    return false;
  }
}
