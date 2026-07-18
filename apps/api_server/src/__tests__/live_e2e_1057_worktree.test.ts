/**
 * Live E2E for #1057 (OCU-16) — worktree lifecycle against the REAL engine.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — skips in the normal suite. Creates a real
 * temp git repo, then drives the engine's experimental worktree endpoints
 * (create → list → reset → remove) to prove the contract the api_server
 * wrappers depend on.
 *
 * Run against the dev sandbox engine (:4097):
 *   RHYTHM_LIVE_E2E=1 RHYTHM_ENGINE_URL=http://127.0.0.1:4097 \
 *     npx vitest run __tests__/live_e2e_1057_worktree.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

const RUN = process.env.RHYTHM_LIVE_E2E === '1';
// Drive Rhythm's OWN worktree wrapper routes (the #1057 deliverable) on the
// api_server, not the raw engine experimental API. BASE is the sandbox api.
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';

(RUN ? describe : describe.skip)('#1057 live — worktree lifecycle', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'rhythm-wt-e2e-'));
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo });
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'e2e@rhythm.test']);
    git(['config', 'user.name', 'e2e']);
    writeFileSync(join(repo, 'README.md'), '# e2e\n');
    git(['add', '.']);
    git(['commit', '-m', 'init']);
  });

  afterAll(() => {
    if (repo && existsSync(repo)) rmSync(repo, { recursive: true, force: true });
  });

  it('create → list → reset → remove a real worktree (via Rhythm /opencode/worktrees)', async () => {
    // CREATE via Rhythm's wrapper route.
    const createRes = await fetch(`${BASE}/opencode/worktrees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: repo, name: 'e2e-wt' }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { directory: string };
    expect(typeof created.directory).toBe('string');
    expect(existsSync(created.directory)).toBe(true);

    // LIST via wrapper — returns an array of worktree directory strings.
    const listRes = await fetch(
      `${BASE}/opencode/worktrees?directory=${encodeURIComponent(repo)}`,
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as string[];
    expect(list).toContain(created.directory);

    // RESET via wrapper — { directory, worktreeDir }.
    const resetRes = await fetch(`${BASE}/opencode/worktrees/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: repo, worktreeDir: created.directory }),
    });
    expect(resetRes.ok).toBe(true);

    // REMOVE via wrapper — { directory, worktreeDir } → 204.
    const removeRes = await fetch(`${BASE}/opencode/worktrees`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: repo, worktreeDir: created.directory }),
    });
    expect(removeRes.ok).toBe(true);
    expect(existsSync(created.directory)).toBe(false);
  });
});
