import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

interface ProjectResponse {
  id: string;
  name: string;
  cwd: string;
  icon: string | null;
  vcsRoot: string | null;
  vcsBranch: string | null;
  vcsDirty: boolean;
  vcsCheckedAt: string | null;
  createdAt: string;
  archivedAt: string | null;
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

describe('Projects API', () => {
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

  it('POST /projects with a git cwd returns 201 and VCS fields populated', async () => {
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Rhythm', cwd: process.cwd() }),
    });
    expect(res.status).toBe(201);
    const project = (await res.json()) as ProjectResponse;
    expect(project.name).toBe('Rhythm');
    expect(project.cwd).toBe(process.cwd());
    expect(project.vcsRoot).toBeTruthy();
    expect(project.vcsCheckedAt).toBeTruthy();
  });

  it('POST /projects with a non-git cwd returns NULL VCS fields and vcsDirty=false', async () => {
    const dir = tmp('projects-nongit-');
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Plain', cwd: dir }),
    });
    expect(res.status).toBe(201);
    const project = (await res.json()) as ProjectResponse;
    expect(project.vcsRoot).toBeNull();
    expect(project.vcsBranch).toBeNull();
    expect(project.vcsDirty).toBe(false);
    expect(project.vcsCheckedAt).toBeTruthy();
  });

  it('POST /projects rejects a relative path with 400', async () => {
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Rel', cwd: 'relative/path' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /projects lists active projects in created_at DESC order', async () => {
    const a = tmp('proj-a-');
    const b = tmp('proj-b-');
    await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'A', cwd: a }),
    });
    // Ensure distinct created_at timestamps.
    await new Promise((r) => setTimeout(r, 10));
    await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'B', cwd: b }),
    });

    const res = await fetch(`${baseUrl}/projects`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const list = (await res.json()) as ProjectResponse[];
    expect(list.map((p) => p.name)).toEqual(['B', 'A']);
  });

  it('GET /projects excludes archived; ?includeArchived=true includes them', async () => {
    const dir = tmp('proj-archive-');
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Old', cwd: dir }),
    });
    const project = (await createRes.json()) as ProjectResponse;

    await fetch(`${baseUrl}/projects/${project.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ archivedAt: new Date().toISOString() }),
    });

    const defaultList = (await (
      await fetch(`${baseUrl}/projects`, { headers: authHeaders })
    ).json()) as ProjectResponse[];
    expect(defaultList.find((p) => p.id === project.id)).toBeUndefined();

    const fullList = (await (
      await fetch(`${baseUrl}/projects?includeArchived=true`, { headers: authHeaders })
    ).json()) as ProjectResponse[];
    expect(fullList.find((p) => p.id === project.id)).toBeDefined();
  });

  it('PATCH /projects/:id re-probes VCS when cwd changes', async () => {
    const nonGit = tmp('proj-patch-nongit-');
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Switching', cwd: nonGit }),
    });
    const project = (await createRes.json()) as ProjectResponse;
    expect(project.vcsRoot).toBeNull();

    const patchRes = await fetch(`${baseUrl}/projects/${project.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ cwd: process.cwd() }),
    });
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as ProjectResponse;
    expect(updated.cwd).toBe(process.cwd());
    expect(updated.vcsRoot).toBeTruthy();
  });

  it('DELETE /projects/:id removes the row', async () => {
    const dir = tmp('proj-delete-');
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Doomed', cwd: dir }),
    });
    const project = (await createRes.json()) as ProjectResponse;

    const delRes = await fetch(`${baseUrl}/projects/${project.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(delRes.status).toBe(204);

    const getRes = await fetch(`${baseUrl}/projects/${project.id}`, { headers: authHeaders });
    expect(getRes.status).toBe(404);
  });

  it('POST /projects/:id/refresh-vcs updates vcs_checked_at', async () => {
    const dir = tmp('proj-refresh-');
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'R', cwd: dir }),
    });
    const project = (await createRes.json()) as ProjectResponse;
    const originalCheckedAt = project.vcsCheckedAt;

    await new Promise((r) => setTimeout(r, 10));

    const refreshRes = await fetch(`${baseUrl}/projects/${project.id}/refresh-vcs`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = (await refreshRes.json()) as ProjectResponse;
    expect(refreshed.vcsCheckedAt).toBeTruthy();
    expect(refreshed.vcsCheckedAt).not.toBe(originalCheckedAt);
  });
});
