/**
 * Live E2E for #1133 (CWE-59/CWE-22) — realpath-canonicalized path
 * containment against the REAL running api_server + engine.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Targets the dev sandbox on :4098 by default (AGENT_LOCAL=true → no
 * bearer token; the sandbox's DB_PATH is already a throwaway copy — see
 * tools/dev/sandbox.sh).
 *
 * Run it (against a sandbox built from THIS branch's source):
 *   tools/dev/sandbox.sh up
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *     npx vitest run src/__tests__/live_e2e_1133_symlink_escape.test.ts
 *   tools/dev/sandbox.sh down
 *
 * What it proves, end to end against the real running backend:
 *   1. The session file-content proxy (resolveSessionDir) rejects a symlink
 *      living inside the session's cwd that points outside it — 400
 *      PATH_TRAVERSAL, and the response body never contains the canary
 *      secret from the outside directory.
 *   2. The /opencode/worktrees DELETE/reset routes reject a worktreeDir
 *      reached via an in-root symlink pointing outside `directory` — 400,
 *      BEFORE any engine mutation (the outside directory is untouched).
 *   3. Control: a legitimate in-root relative path still returns 200/succeeds
 *      — proving no false lockout (e.g. the macOS /tmp -> /private/tmp case
 *      this fix specifically had to avoid).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const describeLive = LIVE ? describe : describe.skip;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

const cleanupDirs: string[] = [];
const cleanupSessionIds: string[] = [];

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const id of cleanupSessionIds.splice(0)) {
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => {});
  }
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describeLive('live E2E — #1133 realpath containment (symlink escape)', () => {
  beforeAll(async () => {
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start the sandbox first (tools/dev/sandbox.sh up)`);
    const engineHealth = await api('/opencode/health');
    if (!engineHealth.ok) throw new Error('opencode engine not ready — wait for sandbox spawn and re-run');
  });

  it('rejects reading through an in-root symlink pointing outside the session dir (400, no canary bytes)', async () => {
    const sessionDir = scratchDir('e2e-1133-session-');
    const outside = scratchDir('e2e-1133-outside-');
    const CANARY = 'CANARY-SECRET-1133-do-not-leak';
    writeFileSync(join(outside, 'passwd'), CANARY);
    symlinkSync(outside, join(sessionDir, 'escape'));
    writeFileSync(join(sessionDir, 'ok.txt'), 'legit in-root content');

    const created = await api('/agent-sessions', {
      method: 'POST',
      body: JSON.stringify({ agentId: 'claude-code', cwd: sessionDir, name: 'e2e-1133 symlink escape' }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as { id: string };
    cleanupSessionIds.push(session.id);

    // Escape attempt: rejected with 400, no canary bytes anywhere in the body.
    const escapeRes = await api(
      `/agent-sessions/${session.id}/files/content?path=${encodeURIComponent('escape/passwd')}`,
    );
    const escapeBody = await escapeRes.text();
    expect(escapeRes.status).toBe(400);
    expect(escapeBody).not.toContain(CANARY);

    // Control: a legitimate in-root relative path still works (no false lockout).
    const okRes = await api(`/agent-sessions/${session.id}/files/content?path=ok.txt`);
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { content?: string };
    expect(okBody.content).toContain('legit in-root content');
  }, 30_000);

  it('rejects a worktree DELETE/reset whose worktreeDir escapes via an in-root symlink, before any engine mutation', async () => {
    const repo = scratchDir('e2e-1133-repo-');
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo });
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'e2e@rhythm.test']);
    git(['config', 'user.name', 'e2e']);
    writeFileSync(join(repo, 'README.md'), '# e2e\n');
    git(['add', '.']);
    git(['commit', '-m', 'init']);

    const outside = scratchDir('e2e-1133-wt-outside-');
    writeFileSync(join(outside, 'marker.txt'), 'still here');
    const escapeLink = join(repo, 'escape');
    symlinkSync(outside, escapeLink);

    const delRes = await api('/opencode/worktrees', {
      method: 'DELETE',
      body: JSON.stringify({ directory: repo, worktreeDir: escapeLink }),
    });
    expect(delRes.status).toBe(400);
    // No engine mutation happened — the outside directory + marker are untouched.
    expect(existsSync(join(outside, 'marker.txt'))).toBe(true);

    const resetRes = await api('/opencode/worktrees/reset', {
      method: 'POST',
      body: JSON.stringify({ directory: repo, worktreeDir: escapeLink }),
    });
    expect(resetRes.status).toBe(400);
    expect(existsSync(join(outside, 'marker.txt'))).toBe(true);

    // Control: a real worktree created via the wrapper route is still
    // removable — proves the containment check doesn't false-lockout a
    // legitimate (engine-created) worktreeDir.
    const createRes = await api('/opencode/worktrees', {
      method: 'POST',
      body: JSON.stringify({ directory: repo, name: 'e2e-1133-legit' }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { directory: string };
    const removeRes = await api('/opencode/worktrees', {
      method: 'DELETE',
      body: JSON.stringify({ directory: repo, worktreeDir: created.directory }),
    });
    expect(removeRes.ok).toBe(true);
  }, 30_000);
});
