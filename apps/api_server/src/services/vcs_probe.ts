import { execFileSync } from 'child_process';

export interface VcsInfo {
  vcsRoot: string | null;
  vcsBranch: string | null;
  vcsDirty: boolean;
}

function runGit(args: string[], cwd: string): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      // Augment PATH so GUI-launched Node (Flutter desktop spawns the embedded
      // server with a stripped PATH on macOS) can still find git in standard
      // system locations.
      env: {
        ...process.env,
        PATH: [process.env.PATH, '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']
          .filter(Boolean)
          .join(':'),
      },
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/**
 * Best-effort git working-tree probe for a project cwd. Returns null when the
 * directory is not a git repo or git is unavailable. Never throws.
 */
export function probeVcs(cwd: string): VcsInfo | null {
  const rootRes = runGit(['-C', cwd, 'rev-parse', '--show-toplevel'], cwd);
  if (!rootRes.ok) return null;
  const vcsRoot = rootRes.stdout.trim();
  if (vcsRoot === '') return null;

  const branchRes = runGit(['-C', cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
  const branch = branchRes.ok ? branchRes.stdout.trim() : '';
  const vcsBranch = branch === '' ? null : branch;

  const statusRes = runGit(['-C', cwd, 'status', '--porcelain'], cwd);
  const vcsDirty = statusRes.ok && statusRes.stdout.trim().length > 0;

  return { vcsRoot, vcsBranch, vcsDirty };
}
