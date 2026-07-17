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
const ENGINE = process.env.RHYTHM_ENGINE_URL ?? 'http://127.0.0.1:4097';

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

  it('create → list → reset → remove a real worktree', async () => {
    const q = `?directory=${encodeURIComponent(repo)}`;

    const createRes = await fetch(`${ENGINE}/experimental/worktree${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'e2e-wt' }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { name: string; directory: string };
    expect(existsSync(created.directory)).toBe(true);

    const listRes = await fetch(`${ENGINE}/experimental/worktree${q}`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ directory: string }>;
    expect(list.some((w) => w.directory === created.directory)).toBe(true);

    const resetRes = await fetch(`${ENGINE}/experimental/worktree/reset${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: created.directory }),
    });
    expect(resetRes.ok).toBe(true);

    const removeRes = await fetch(`${ENGINE}/experimental/worktree${q}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: created.directory }),
    });
    expect(removeRes.ok).toBe(true);
    expect(existsSync(created.directory)).toBe(false);
  });
});
