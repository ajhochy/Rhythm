/**
 * Tests for GET /projects/:id/branches and POST /projects/:id/checkout.
 *
 * Git operations are mocked via vi.doMock('child_process') — the same pattern
 * used in vcs_probe.test.ts. Each test resets modules so mocks are isolated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

interface ProjectResponse {
  id: string;
  name: string;
  cwd: string;
  vcsRoot: string | null;
  vcsBranch: string | null;
  vcsDirty: boolean;
  vcsCheckedAt: string | null;
  createdAt: string;
  archivedAt: string | null;
}

interface BranchesResponse {
  current: string | null;
  local: string[];
  recent: string[];
}

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(cwd: string): void {
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test']);
  git(cwd, ['commit', '--allow-empty', '-q', '-m', 'init']);
}

describe('GET /projects/:id/branches', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;
  const tmpDirs: string[] = [];

  beforeEach(async () => {
    setDb(makeDb());
    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Test', email: 'test@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };

    const { createApp } = await import('../app');
    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () =>
      new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  });

  afterEach(async () => {
    await closeServer();
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tmp(prefix: string): string {
    const d = makeTmpDir(prefix);
    tmpDirs.push(d);
    return d;
  }

  it('returns current branch and local list for a git repo', async () => {
    const dir = tmp('checkout-branches-');
    initRepo(dir);
    // Create a second branch so the list is non-trivial.
    git(dir, ['checkout', '-q', '-b', 'feature/x']);
    git(dir, ['checkout', '-q', 'main']);

    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'BranchTest', cwd: dir }),
    });
    expect(createRes.status).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;

    const branchRes = await fetch(`${baseUrl}/projects/${project.id}/branches`, {
      headers: authHeaders,
    });
    expect(branchRes.status).toBe(200);
    const data = (await branchRes.json()) as BranchesResponse;
    expect(data.current).toBe('main');
    expect(data.local).toContain('main');
    expect(data.local).toContain('feature/x');
    expect(Array.isArray(data.recent)).toBe(true);
  });

  it('returns empty lists for a non-git directory', async () => {
    const dir = tmp('checkout-nongit-');

    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'NonGit', cwd: dir }),
    });
    expect(createRes.status).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;

    const branchRes = await fetch(`${baseUrl}/projects/${project.id}/branches`, {
      headers: authHeaders,
    });
    expect(branchRes.status).toBe(200);
    const data = (await branchRes.json()) as BranchesResponse;
    expect(data.current).toBeNull();
    expect(data.local).toEqual([]);
    expect(data.recent).toEqual([]);
  });

  it('returns 404 for an unknown project id', async () => {
    const res = await fetch(`${baseUrl}/projects/no-such-id/branches`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /projects/:id/checkout', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;
  const tmpDirs: string[] = [];

  beforeEach(async () => {
    setDb(makeDb());
    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Test', email: 'test@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };

    const { createApp } = await import('../app');
    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () =>
      new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  });

  afterEach(async () => {
    await closeServer();
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tmp(prefix: string): string {
    const d = makeTmpDir(prefix);
    tmpDirs.push(d);
    return d;
  }

  it('switches to an existing branch and returns the updated project', async () => {
    const dir = tmp('checkout-switch-');
    initRepo(dir);
    git(dir, ['checkout', '-q', '-b', 'feature/y']);
    git(dir, ['checkout', '-q', 'main']);

    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Checkout', cwd: dir }),
    });
    expect(createRes.status).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;
    expect(project.vcsBranch).toBe('main');

    const checkoutRes = await fetch(`${baseUrl}/projects/${project.id}/checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ branch: 'feature/y' }),
    });
    expect(checkoutRes.status).toBe(200);
    const updated = (await checkoutRes.json()) as ProjectResponse;
    expect(updated.vcsBranch).toBe('feature/y');
  });

  it('creates a new branch with createBranch: true', async () => {
    const dir = tmp('checkout-create-');
    initRepo(dir);

    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'CreateBranch', cwd: dir }),
    });
    const project = (await createRes.json()) as ProjectResponse;

    const checkoutRes = await fetch(`${baseUrl}/projects/${project.id}/checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ branch: 'feature/new', createBranch: true }),
    });
    expect(checkoutRes.status).toBe(200);
    const updated = (await checkoutRes.json()) as ProjectResponse;
    expect(updated.vcsBranch).toBe('feature/new');
  });

  it('returns 409 when git checkout fails (branch does not exist)', async () => {
    const dir = tmp('checkout-fail-');
    initRepo(dir);

    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Fail', cwd: dir }),
    });
    const project = (await createRes.json()) as ProjectResponse;

    const res = await fetch(`${baseUrl}/projects/${project.id}/checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ branch: 'does-not-exist' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('returns 400 when branch field is missing', async () => {
    const dir = tmp('checkout-nobranch-');

    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'NoBranch', cwd: dir }),
    });
    const project = (await createRes.json()) as ProjectResponse;

    const res = await fetch(`${baseUrl}/projects/${project.id}/checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown project id', async () => {
    const res = await fetch(`${baseUrl}/projects/no-such-id/checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ branch: 'main' }),
    });
    expect(res.status).toBe(404);
  });

  it('stashes dirty changes when stash=stash before checkout', async () => {
    const dir = tmp('checkout-stash-');
    initRepo(dir);
    git(dir, ['checkout', '-q', '-b', 'feature/z']);
    git(dir, ['checkout', '-q', 'main']);

    // Create a tracked dirty file.
    const filePath = path.join(dir, 'tracked.txt');
    fs.writeFileSync(filePath, 'initial');
    git(dir, ['add', filePath]);
    git(dir, ['commit', '-q', '-m', 'add tracked']);
    fs.writeFileSync(filePath, 'changed');

    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Stash', cwd: dir }),
    });
    const project = (await createRes.json()) as ProjectResponse;
    expect(project.vcsDirty).toBe(true);

    const checkoutRes = await fetch(`${baseUrl}/projects/${project.id}/checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ branch: 'feature/z', stash: 'stash' }),
    });
    expect(checkoutRes.status).toBe(200);
    const updated = (await checkoutRes.json()) as ProjectResponse;
    expect(updated.vcsBranch).toBe('feature/z');
  });
});
