import { execFileSync, spawnSync } from 'child_process';

export interface VcsInfo {
  vcsRoot: string | null;
  vcsBranch: string | null;
  vcsDirty: boolean;
}

export interface VcsBranches {
  current: string | null;
  local: string[];
  recent: string[];
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

/**
 * List local branches for a git repo at [cwd]. Returns null when not a git
 * repo or git is unavailable. Never throws.
 */
export function listBranches(cwd: string): VcsBranches | null {
  // Confirm it is a git repo first.
  const rootRes = runGit(['-C', cwd, 'rev-parse', '--show-toplevel'], cwd);
  if (!rootRes.ok) return null;

  // Current branch.
  const branchRes = runGit(['-C', cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
  const current = branchRes.ok && branchRes.stdout.trim() !== '' ? branchRes.stdout.trim() : null;

  // All local branches.
  const allRes = runGit(
    ['-C', cwd, 'for-each-ref', "--format=%(refname:short)", 'refs/heads/'],
    cwd,
  );
  const local = allRes.ok
    ? allRes.stdout
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean)
    : [];

  // Recent 5 branches by committer date.
  const recentRes = runGit(
    [
      '-C',
      cwd,
      'for-each-ref',
      '--sort=-committerdate',
      '--count=5',
      "--format=%(refname:short)",
      'refs/heads/',
    ],
    cwd,
  );
  const recent = recentRes.ok
    ? recentRes.stdout
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean)
    : [];

  return { current, local, recent };
}

export interface CheckoutResult {
  ok: boolean;
  stderr: string;
}

/**
 * Perform a git checkout in [cwd]. Supports stashing, discarding, and
 * creating new branches. Returns { ok: true } on success, or
 * { ok: false, stderr } on git failure. Never throws.
 */
export function gitCheckout(
  cwd: string,
  branch: string,
  opts: {
    stash?: 'none' | 'stash' | 'discard';
    createBranch?: boolean;
  } = {},
): CheckoutResult {
  const gitEnv = {
    ...process.env,
    PATH: [process.env.PATH, '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']
      .filter(Boolean)
      .join(':'),
  };

  // Handle dirty-tree pre-processing.
  if (opts.stash === 'stash') {
    const stashResult = spawnSync(
      'git',
      ['-C', cwd, 'stash', 'push', '-m', 'rhythm-auto-stash'],
      { env: gitEnv, encoding: 'utf8' },
    );
    if (stashResult.status !== 0) {
      return { ok: false, stderr: (stashResult.stderr ?? '').trim() };
    }
  } else if (opts.stash === 'discard') {
    spawnSync('git', ['-C', cwd, 'checkout', '--', '.'], { env: gitEnv, encoding: 'utf8' });
  }

  // Build checkout args.
  const args = opts.createBranch
    ? ['-C', cwd, 'checkout', '-b', branch]
    : ['-C', cwd, 'checkout', branch];

  const result = spawnSync('git', args, { env: gitEnv, encoding: 'utf8' });
  if (result.status !== 0) {
    return { ok: false, stderr: (result.stderr ?? '').trim() };
  }
  return { ok: true, stderr: '' };
}
