import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The one git work tree the user's own goal text names by absolute (or `~/`)
 * path, else null. The repo comes from the user-authored captured goal, never
 * from model-supplied tool arguments, so a run cannot be redirected elsewhere.
 * ponytail: repo root must be named exactly (a `.git` beside it); a subdirectory
 * path is ignored rather than walked up.
 */
export function goalRepoPath(objective: string): string | null {
  const repos = new Set<string>();
  for (const match of objective.matchAll(/(?:^|[\s(`'"])((?:~|\/)[^\s`'"),;]*)/g)) {
    let candidate = match[1]!.replace(/[.:!?]+$/, '');
    if (candidate === '~' || candidate.startsWith('~/')) candidate = path.join(homedir(), candidate.slice(1));
    try {
      const real = realpathSync(candidate);
      if (statSync(real).isDirectory() && existsSync(path.join(real, '.git'))) repos.add(real);
    } catch {
      // Not an existing path.
    }
  }
  return repos.size === 1 ? [...repos][0]! : null;
}
