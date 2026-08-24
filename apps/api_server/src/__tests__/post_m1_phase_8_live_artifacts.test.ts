import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

const bundle = {
  html: '<main id="phase-8">Phase 8</main>',
  css: '#phase-8 { color: navy; }',
  js: 'window.phase8 = true;',
};
const forbiddenDisclosure = /(liveArtifactStorageDir|content hash path|temporary path|ENOENT|EACCES|bearer\s+[a-z0-9._-]+|\/Users\/|\/private\/|\/tmp\/|[A-Z]:\\|\bat\s+\S+\([^)]*:\d+:\d+\))/i;
const storageRoot = path.join(tmpdir(), `post-m1-p8-live-artifacts-${randomUUID()}`);
const defaultStorageRoot = env.liveArtifactStorageDir;
env.liveArtifactStorageDir = storageRoot;

async function body(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

describe('post-M1 Phase 8 live-artifact API contract', () => {
  let db: Database.Database;
  let users: UsersRepository;
  let sessions: SessionsRepository;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    users = new UsersRepository();
    sessions = new SessionsRepository();
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
    db.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    env.liveArtifactStorageDir = defaultStorageRoot;
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function auth(userId: number): Promise<Record<string, string>> {
    const session = await sessions.createAsync(userId);
    return { Authorization: `Bearer ${session.token}` };
  }

  function workspace(ownerUserId: number, members: number[] = []): number {
    const result = db.prepare('INSERT INTO workspaces (name, join_code, created_by) VALUES (?, ?, ?)')
      .run('Phase 8 contract', `phase-8-${Math.random()}`, ownerUserId);
    const workspaceId = Number(result.lastInsertRowid);
    for (const userId of [ownerUserId, ...members]) {
      db.prepare('INSERT INTO workspace_members (workspace_id, user_id) VALUES (?, ?)').run(workspaceId, userId);
    }
    return workspaceId;
  }

  async function createArtifact(
    ownerUserId: number,
    workspaceId: number,
    visibility: 'private' | 'shared' | 'organization' = 'private',
    collaborators: number[] = [],
  ): Promise<{ id: string; currentBundleRevision: number; currentStateRevision: number }> {
    const response = await fetch(`${baseUrl}/live-artifacts`, {
      method: 'POST',
      headers: { ...(await auth(ownerUserId)), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html',
        title: 'Phase 8 stable artifact',
        workspaceId,
        visibility,
        collaborators,
        bundle,
        state: { selectedServiceId: 'service-1' },
      }),
    });
    expect(response.status, JSON.stringify(await response.clone().json().catch(() => null))).toBe(201);
    return response.json() as Promise<{ id: string; currentBundleRevision: number; currentStateRevision: number }>;
  }

  it('post-m1-p8-c2a: preserves non-disclosing private, shared, and organization read authorization', async () => {
    // Regression caught: a collaborator row, workspace membership, or forged ID bypasses the
    // canonical visibility rules; the status matrix or identical 404 payload assertion fails.
    const owner = users.create({ name: 'Owner', email: 'phase8-owner@example.test' });
    const collaborator = users.create({ name: 'Collaborator', email: 'phase8-collaborator@example.test' });
    const member = users.create({ name: 'Member', email: 'phase8-member@example.test' });
    const outsider = users.create({ name: 'Outsider', email: 'phase8-outsider@example.test' });
    const workspaceId = workspace(owner.id, [collaborator.id, member.id]);
    const privateArtifact = await createArtifact(owner.id, workspaceId, 'private');
    const sharedArtifact = await createArtifact(owner.id, workspaceId, 'shared', [collaborator.id]);
    const organizationArtifact = await createArtifact(owner.id, workspaceId, 'organization');
    const headers = {
      owner: await auth(owner.id),
      collaborator: await auth(collaborator.id),
      member: await auth(member.id),
      outsider: await auth(outsider.id),
    };

    expect((await fetch(`${baseUrl}/live-artifacts/${privateArtifact.id}`, { headers: headers.owner })).status).toBe(200);
    expect((await fetch(`${baseUrl}/live-artifacts/${privateArtifact.id}`, { headers: headers.member })).status).toBe(404);
    expect((await fetch(`${baseUrl}/live-artifacts/${sharedArtifact.id}`, { headers: headers.collaborator })).status).toBe(200);
    expect((await fetch(`${baseUrl}/live-artifacts/${sharedArtifact.id}`, { headers: headers.member })).status).toBe(404);
    expect((await fetch(`${baseUrl}/live-artifacts/${organizationArtifact.id}`, { headers: headers.member })).status).toBe(200);
    expect((await fetch(`${baseUrl}/live-artifacts/${organizationArtifact.id}`, { headers: headers.outsider })).status).toBe(404);

    const denied = await Promise.all([
      fetch(`${baseUrl}/live-artifacts/${privateArtifact.id}`, { headers: headers.member }),
      fetch(`${baseUrl}/live-artifacts/00000000-0000-4000-8000-000000000000`, { headers: headers.owner }),
      fetch(`${baseUrl}/live-artifacts/not-a-uuid`, { headers: headers.owner }),
      fetch(`${baseUrl}/live-artifacts/%2e%2e%2fetc%2fpasswd`, { headers: headers.owner }),
    ]);
    const payloads = await Promise.all(denied.map((response) => body(response)));
    expect(denied.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(payloads).toEqual(payloads.map(() => payloads[0]));
  });

  it('post-m1-p8-c2c: state CAS is positive-revision checked, independently incremented, and bounded at 512 KiB', async () => {
    // Regression caught: a stale or oversized state write lands, or a state write advances the
    // bundle counter; the conflict, size, or independent-revision assertion fails.
    const owner = users.create({ name: 'State owner', email: 'phase8-state@example.test' });
    const artifact = await createArtifact(owner.id, workspace(owner.id));
    const headers = { ...(await auth(owner.id)), 'Content-Type': 'application/json' };
    const acceptedState = { payload: 'x'.repeat(512 * 1024 - 20) };
    const accepted = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/state`, {
      method: 'PUT', headers, body: JSON.stringify({ expectedStateRevision: 1, state: acceptedState }),
    });
    expect(accepted.status).toBe(200);
    expect(await body(accepted)).toMatchObject({ currentStateRevision: 2, currentBundleRevision: 1 });

    const stale = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/state`, {
      method: 'PUT', headers, body: JSON.stringify({ expectedStateRevision: 1, state: { stale: true } }),
    });
    expect(stale.status).toBe(409);
    expect(await body(stale)).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'CONFLICT' }),
      currentStateRevision: 2,
    }));

    for (const requestBody of [
      { expectedStateRevision: 0, state: {} },
      { expectedStateRevision: 2, state: { payload: 'x'.repeat(512 * 1024) } },
    ]) {
      expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}/state`, {
        method: 'PUT', headers, body: JSON.stringify(requestBody),
      })).status).toBe(400);
    }
  });

  it('post-m1-p8-c2d: bundle CAS accepts only canonical string fields and advances only currentBundleRevision', async () => {
    // Regression caught: extra or non-string bundle fields reach storage, a stale write lands, or
    // bundle updates advance state; one exact-shape or revision assertion fails.
    const owner = users.create({ name: 'Bundle owner', email: 'phase8-bundle@example.test' });
    const artifact = await createArtifact(owner.id, workspace(owner.id));
    const headers = { ...(await auth(owner.id)), 'Content-Type': 'application/json' };
    const nextBundle = { html: '<main>Revision 2</main>', css: '', js: 'window.revision = 2;' };
    const accepted = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/bundle`, {
      method: 'PUT', headers, body: JSON.stringify({ expectedBundleRevision: 1, bundle: nextBundle }),
    });
    expect(accepted.status).toBe(200);
    expect(await body(accepted)).toMatchObject({ currentBundleRevision: 2, currentStateRevision: 1 });

    const stale = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/bundle`, {
      method: 'PUT', headers, body: JSON.stringify({ expectedBundleRevision: 1, bundle: nextBundle }),
    });
    expect(stale.status).toBe(409);
    expect(await body(stale)).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'CONFLICT' }),
      currentBundleRevision: 2,
    }));

    for (const invalidBundle of [
      { html: '<main />', css: '', js: '', path: '/tmp/forged' },
      { html: '<main />', css: '', js: 3 },
      { html: '<main />', css: '' },
    ]) {
      expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}/bundle`, {
        method: 'PUT', headers, body: JSON.stringify({ expectedBundleRevision: 2, bundle: invalidBundle }),
      })).status).toBe(400);
    }
  });

  it('post-m1-p8-c2e: every artifact response class stays free of storage, token, stack, and absolute-path disclosure', async () => {
    // Regression caught: one success, denial, conflict, tombstone, or storage error serializes an
    // internal path/token/stack; the aggregate disclosure assertion identifies the response class.
    const owner = users.create({ name: 'Disclosure owner', email: 'phase8-disclosure-owner@example.test' });
    const member = users.create({ name: 'Disclosure member', email: 'phase8-disclosure-member@example.test' });
    const workspaceId = workspace(owner.id, [member.id]);
    const artifact = await createArtifact(owner.id, workspaceId, 'shared', [member.id]);
    const ownerHeaders = await auth(owner.id);
    const memberHeaders = await auth(member.id);
    const jsonHeaders = { ...ownerHeaders, 'Content-Type': 'application/json' };
    const responses: Array<{ label: string; response: Response }> = [];
    responses.push({ label: 'list-success', response: await fetch(`${baseUrl}/live-artifacts?type=html`, { headers: ownerHeaders }) });
    responses.push({ label: 'detail-success', response: await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: ownerHeaders }) });
    responses.push({ label: 'render-success', response: await fetch(`${baseUrl}/live-artifacts/${artifact.id}/render`, { headers: ownerHeaders }) });
    responses.push({ label: 'state-success', response: await fetch(`${baseUrl}/live-artifacts/${artifact.id}/state`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ expectedStateRevision: 1, state: { updated: true } }) }) });
    responses.push({ label: 'state-conflict', response: await fetch(`${baseUrl}/live-artifacts/${artifact.id}/state`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ expectedStateRevision: 1, state: { stale: true } }) }) });
    responses.push({ label: 'bundle-success', response: await fetch(`${baseUrl}/live-artifacts/${artifact.id}/bundle`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ expectedBundleRevision: 1, bundle: { ...bundle, js: 'window.phase8 = 2;' } }) }) });
    responses.push({ label: 'sharing-success', response: await fetch(`${baseUrl}/live-artifacts/${artifact.id}/collaborators`, { headers: ownerHeaders }) });
    responses.push({ label: 'sharing-failure', response: await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { method: 'PATCH', headers: { ...memberHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: 'organization' }) }) });
    responses.push({ label: 'delete-success', response: await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { method: 'DELETE', headers: ownerHeaders }) });
    responses.push({ label: 'tombstone', response: await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: memberHeaders }) });

    for (const { label, response } of responses) {
      const serialized = JSON.stringify(await body(response));
      expect(serialized, `${label} disclosed internal data`).not.toMatch(forbiddenDisclosure);
    }
  });
});
