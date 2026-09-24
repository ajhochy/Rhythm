/** Live issue #1575 contract; run only against the isolated sandbox. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4998';
const describeLive = LIVE ? describe : describe.skip;
let agentIds: string[] = [];
let sessionIds: string[] = [];
let tempDirs: string[] = [];
let authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers ?? {}) },
  });
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 180_000;
  let value: T;
  do {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < until);
  throw new Error('timed out waiting for child completion');
}

afterEach(async () => {
  for (const id of sessionIds.reverse()) await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' });
  for (const id of agentIds.reverse()) await api(`/agent-configs/${id}`, { method: 'DELETE' });
  for (const dir of tempDirs.reverse()) rmSync(dir, { recursive: true, force: true });
  agentIds = [];
  sessionIds = [];
  tempDirs = [];
  authHeaders = { 'Content-Type': 'application/json' };
});

async function authenticate(suffix: string): Promise<void> {
  const dbPath = process.env.RHYTHM_LIVE_DB_PATH;
  if (!dbPath) throw new Error('RHYTHM_LIVE_DB_PATH is required for live auth');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  setDb(db);
  const user = new UsersRepository().create({
    name: `Issue 1575 ${suffix}`,
    email: `issue-1575-${suffix}@rhythm.test`,
  });
  const session = await new SessionsRepository().createAsync(user.id);
  authHeaders = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
}

describeLive('issue #1575 live async delegation worktree contract', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    expect((await api('/health')).ok).toBe(true);
    expect(await json<{ status: string }>('/opencode/health')).toMatchObject({ status: 'ready' });
  });

  it('issue-1575-c4: a real child reports its server-created worktree cwd and persisted metadata matches it', async () => {
    // Regression caught: a child receives the manager cwd even though a worktree
    // row exists; the child-reported pwd and every persisted worktree field fail.
    const suffix = randomUUID().slice(0, 8);
    await authenticate(suffix);
    const repo = mkdtempSync(join(tmpdir(), 'rhythm-1575-git-'));
    tempDirs.push(repo);
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'issue-1575@rhythm.test'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'issue-1575'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), '# issue 1575\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo });
    const managerId = `live-1575-manager-${suffix}`;
    const specialistId = `live-1575-specialist-${suffix}`;
    for (const profile of [
      { id: managerId, label: managerId, isAgent: true, isManager: true, enabled: true, sessionSelectable: true, modelProvider: 'google', modelId: 'gemini-2.5-pro', ocAgent: managerId, allowedDelegatesJson: JSON.stringify([specialistId]), corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }) },
      { id: specialistId, label: specialistId, isAgent: true, enabled: true, sessionSelectable: true, modelProvider: 'google', modelId: 'gemini-2.5-pro', ocAgent: specialistId, systemPrompt: 'Use the shell to run pwd, then reply with exactly CWD:<the pwd output> and nothing else.' },
    ]) {
      agentIds.push((await json<{ id: string }>('/agent-configs', { method: 'POST', body: JSON.stringify(profile) })).id);
    }
    await json('/system/refresh', { method: 'POST' });
    const parent = await json<{ id: string }>('/agent-sessions', { method: 'POST', body: JSON.stringify({ agentId: managerId, name: managerId, cwd: repo }) });
    sessionIds.push(parent.id);
    const worktreeName = `issue-1575-${suffix}`;
    const dispatched = await api('/agent-delegation/delegate-async', { method: 'POST', body: JSON.stringify({ callerSessionId: parent.id, targetAgentConfigId: specialistId, prompt: 'Inspect your cwd now.', isolateWorktree: true, worktreeName }) });
    expect(dispatched.status).toBe(202);
    const { sessionId } = await dispatched.json() as { sessionId: string };
    sessionIds.push(sessionId);
    const snapshot = await waitFor(
      () => json<{ session: { cwd: string; worktreeName: string | null; worktreePath: string | null; worktreeBranch: string | null; status: string }; messages: Array<{ rawText: string }> }>(`/agent-sessions/${sessionId}`),
      (value) => value.session.status === 'idle' && value.messages.some((message) => message.rawText.includes('CWD:')),
    );
    const report = snapshot.messages.map((message) => message.rawText).join('\n');
    expect(snapshot.session.worktreeName).toBe(worktreeName);
    expect(snapshot.session.worktreePath).toBe(snapshot.session.cwd);
    expect(snapshot.session.worktreeBranch).toBeTruthy();
    expect(report).toContain(`CWD:${snapshot.session.cwd}`);
    expect(snapshot.session.cwd).not.toBe(repo);
  }, 240_000);

  it('issue-1575-c6: a real git-worktree creation failure preserves a dirty marker and persists no child', async () => {
    // Regression caught: failed isolation deletes/cleans caller files or creates
    // a child row with invented worktree metadata before git rejects the cwd.
    const suffix = randomUUID().slice(0, 8);
    await authenticate(suffix);
    const nonGitDir = mkdtempSync(join(tmpdir(), 'rhythm-1575-not-git-'));
    const marker = join(nonGitDir, 'dirty-marker.txt');
    tempDirs.push(nonGitDir);
    writeFileSync(marker, 'preserve me\n');
    const managerId = `live-1575-fail-manager-${suffix}`;
    const specialistId = `live-1575-fail-specialist-${suffix}`;
    for (const profile of [
      { id: managerId, label: managerId, isAgent: true, isManager: true, enabled: true, sessionSelectable: true, modelProvider: 'google', modelId: 'gemini-2.5-pro', ocAgent: managerId, allowedDelegatesJson: JSON.stringify([specialistId]), corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }) },
      { id: specialistId, label: specialistId, isAgent: true, enabled: true, sessionSelectable: true, modelProvider: 'google', modelId: 'gemini-2.5-pro', ocAgent: specialistId },
    ]) agentIds.push((await json<{ id: string }>('/agent-configs', { method: 'POST', body: JSON.stringify(profile) })).id);
    await json('/system/refresh', { method: 'POST' });
    const parent = await json<{ id: string }>('/agent-sessions', { method: 'POST', body: JSON.stringify({ agentId: managerId, name: managerId, cwd: nonGitDir }) });
    sessionIds.push(parent.id);
    const response = await api('/agent-delegation/delegate-async', { method: 'POST', body: JSON.stringify({ callerSessionId: parent.id, targetAgentConfigId: specialistId, prompt: 'This must not run.', isolateWorktree: true, worktreeName: `fail-${suffix}` }) });
    expect(response.status).toBe(502);
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, 'utf8')).toBe('preserve me\n');
    expect(await json<unknown[]>(`/agent-sessions/${parent.id}/children`)).toEqual([]);
  }, 30_000);
});
