import { execFileSync } from 'child_process';

export interface VcsInfo {
  vcsRoot: string | null;
  vcsBranch: string | null;
  vcsDirty: boolean;
}

// Single-quote a string for safe embedding in a `/bin/zsh -lc` argument.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function run(cmd: string): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync('/bin/zsh', ['-lc', cmd], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/**
 * Best-effort git working-tree probe for a project cwd.
 *
 * Runs via `/bin/zsh -lc` so a GUI-stripped PATH (Flutter desktop launches
 * the embedded Node server, which inherits a sparse PATH on macOS) still
 * resolves `git`. Returns null when the directory is not a git repo or git
 * is unavailable. Never throws to the caller.
 */
export function probeVcs(cwd: string): VcsInfo | null {
  const q = shellQuote(cwd);

  const rootRes = run(`git -C ${q} rev-parse --show-toplevel`);
  if (!rootRes.ok) return null;
  const vcsRoot = rootRes.stdout.trim();
  if (vcsRoot === '') return null;

  // Detached HEAD: symbolic-ref exits non-zero. Treat branch as null but
  // still return a populated record (the working tree is a real git repo).
  const branchRes = run(`git -C ${q} symbolic-ref --quiet --short HEAD`);
  const branch = branchRes.ok ? branchRes.stdout.trim() : '';
  const vcsBranch = branch === '' ? null : branch;

  const statusRes = run(`git -C ${q} status --porcelain`);
  const vcsDirty = statusRes.ok && statusRes.stdout.trim().length > 0;

  return { vcsRoot, vcsBranch, vcsDirty };
}
