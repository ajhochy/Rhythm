/** Real sandbox API + engine check for W6. Skips in the normal suite. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const baseUrl = process.env.RHYTHM_LIVE_URL ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const databasePath = process.env.DB_PATH ?? '';

(LIVE ? describe : describe.skip)('W6 live: selected-base isolated session Start', () => {
  let root = '';
  let source = '';
  let selected = '';
  let sessionId = '';

  const git = (cwd: string, args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args], { encoding: 'utf8' });

  beforeAll(() => {
    assertLiveE2EIsolation();
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !/^http:\/\/127\.0\.0\.1:(?!4000\b|4001\b|4002\b|4096\b)\d+$/.test(baseUrl) ||
      !/^\/private\/tmp\/rhythm-/.test(sandboxDir) ||
      realpathSync(sandboxDir) !== sandboxDir ||
      resolve(databasePath) !== resolve(sandboxDir, 'rhythm.db')
    ) throw new Error('W6 live test requires an owned temporary sandbox API and DB');
    root = mkdtempSync(join(sandboxDir, 'w6-git-'));
    source = join(root, 'source repo');
    selected = join(root, 'selected base');
    mkdirSync(source);
    git(source, ['init', '-b', 'main']);
    git(source, ['config', 'user.email', 'w6@rhythm.test']);
    git(source, ['config', 'user.name', 'W6']);
    writeFileSync(join(source, 'tracked file.txt'), 'main base\n');
    git(source, ['add', '.']);
    git(source, ['commit', '-m', 'main base']);
    git(source, ['worktree', 'add', '-b', 'selected-base', selected]);
    writeFileSync(join(selected, 'tracked file.txt'), 'selected base bytes\n');
    writeFileSync(join(selected, 'selected marker.txt'), 'selected base\n');
    git(selected, ['add', '.']);
    git(selected, ['commit', '-m', 'selected marker']);
    writeFileSync(join(source, 'tracked file.txt'), 'unstaged bytes\n');
    writeFileSync(join(source, 'staged file.txt'), 'staged bytes\n');
    git(source, ['add', 'staged file.txt']);
    writeFileSync(join(source, 'untracked file.txt'), 'untracked bytes\n');
  });

  afterAll(async () => {
    let cleanupStatus = 204;
    if (sessionId) {
      cleanupStatus = (await fetch(`${baseUrl}/agent-sessions/${sessionId}/hard?removeWorktree=true`, { method: 'DELETE' })).status;
    }
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
    expect(cleanupStatus).toBe(204);
  });

  it('creates from checked-out selected base while preserving dirty source branch, index, and bytes', async () => {
    const before = {
      branch: git(source, ['branch', '--show-current']),
      status: git(source, ['status', '--porcelain=v1']),
      index: git(source, ['ls-files', '-s']),
    };
    const baseHead = git(selected, ['rev-parse', 'HEAD']);
    const response = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: null, cwd: source, name: 'W6 selected base', branch: 'selected-base', isolateWorktree: true, worktreeName: 'W6 Space' }),
    });
    const body = await response.json() as { id?: string; cwd?: string; worktreePath?: string; worktreeBranch?: string; error?: string };
    expect(response.status, JSON.stringify(body)).toBe(201);
    sessionId = body.id ?? '';
    expect(sessionId).not.toBe('');
    expect(body.cwd).toBe(body.worktreePath);
    expect(body.worktreeBranch).toBe('opencode/w6-space');
    expect(git(body.cwd!, ['rev-parse', 'HEAD'])).toBe(baseHead);
    for (let attempt = 0; attempt < 50 && !existsSync(join(body.cwd!, 'selected marker.txt')); attempt++) {
      await new Promise((done) => setTimeout(done, 200));
    }
    expect(readFileSync(join(body.cwd!, 'selected marker.txt'), 'utf8')).toBe('selected base\n');
    expect(readFileSync(join(body.cwd!, 'tracked file.txt'), 'utf8')).toBe('selected base bytes\n');
    expect({ branch: git(source, ['branch', '--show-current']), status: git(source, ['status', '--porcelain=v1']), index: git(source, ['ls-files', '-s']) }).toEqual(before);
    expect(readFileSync(join(source, 'tracked file.txt'), 'utf8')).toBe('unstaged bytes\n');
    expect(readFileSync(join(source, 'staged file.txt'), 'utf8')).toBe('staged bytes\n');
    expect(readFileSync(join(source, 'untracked file.txt'), 'utf8')).toBe('untracked bytes\n');
    expect(git(selected, ['branch', '--show-current']).trim()).toBe('selected-base');
  }, 30_000);
});
