import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { LiveArtifactStorage } from '../services/live_artifact_storage';
import { env } from '../config/env';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

const bundle = { html: '<h1>Calendar</h1><script>evil()</script>', css: 'h1 { color: red }', js: 'window.calendar = true;' };

async function json(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

describe('live artifacts (AV-02)', () => {
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

  afterEach(async () => { await close(); db.close(); await rm(env.liveArtifactStorageDir, { recursive: true, force: true }); });

  async function header(userId: number) {
    const session = await sessions.createAsync(userId);
    return { Authorization: `Bearer ${session.token}` };
  }

  function workspace(ownerId: number, memberIds: number[] = []) {
    const row = db.prepare('INSERT INTO workspaces (name, join_code, created_by) VALUES (?, ?, ?)')
      .run('AV02', `av02-${Math.random()}`, ownerId);
    const id = Number(row.lastInsertRowid);
    for (const userId of [ownerId, ...memberIds]) {
      db.prepare('INSERT INTO workspace_members (workspace_id, user_id) VALUES (?, ?)').run(id, userId);
    }
    return id;
  }

  async function create(ownerId: number, workspaceId: number, visibility = 'private', content = bundle) {
    const response = await fetch(`${baseUrl}/live-artifacts`, {
      method: 'POST', headers: { ...(await header(ownerId)), 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'html', title: 'Worship Calendar', workspaceId, visibility, bundle: content, state: { scripture: 'John 3:16' } }),
    });
    expect(response.status).toBe(201);
    return json(response) as Promise<{ id: string; currentBundleRevision: number; currentStateRevision: number }>;
  }

  it('requires auth and mounts every always-on CRUD route', async () => {
    expect((await fetch(`${baseUrl}/live-artifacts`)).status).toBe(401);
    const owner = users.create({ name: 'Owner', email: 'av02-owner@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    for (const path of ['', `/${artifact.id}`, `/${artifact.id}/render`, `/${artifact.id}/collaborators`]) {
      expect((await fetch(`${baseUrl}/live-artifacts${path}`, { headers: await header(owner.id) })).status).toBe(200);
    }
  });

  it('rejects unauthenticated callers across all live-artifact routes', async () => {
    // Regression: a newly mounted write route must not accidentally bypass requireAuth.
    const id = '00000000-0000-4000-8000-000000000000';
    const routes = [['GET', ''], ['POST', ''], ['GET', `/${id}`], ['GET', `/${id}/render`], ['PATCH', `/${id}`], ['GET', `/${id}/collaborators`], ['POST', `/${id}/collaborators`], ['DELETE', `/${id}/collaborators/1`], ['PUT', `/${id}/bundle`], ['PUT', `/${id}/state`], ['DELETE', `/${id}`]] as const;
    for (const [method, suffix] of routes) expect((await fetch(`${baseUrl}/live-artifacts${suffix}`, { method })).status).toBe(401);
  });

  it('creates only html with public metadata and fixed initial content', async () => {
    const owner = users.create({ name: 'Owner', email: 'av02-shape@example.com' });
    const created = await create(owner.id, workspace(owner.id));
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    const detail = await json(await fetch(`${baseUrl}/live-artifacts/${created.id}`, { headers: await header(owner.id) }));
    expect(detail).toMatchObject({ id: created.id, type: 'html', title: 'Worship Calendar', currentBundleRevision: 1, currentStateRevision: 1 });
    expect(JSON.stringify(detail)).not.toMatch(/storage|path|key/i);
  });

  it('projects updater display names without publishing updater IDs', async () => {
    // Regression: toolbar provenance must not require Flutter to receive an audit ID.
    const owner = users.create({ name: 'Jane Smith', email: 'av06-provenance@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    const detail = await json(await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: await header(owner.id) }));
    expect(detail).toMatchObject({ updatedByDisplayName: 'Jane Smith' });
    expect(detail).not.toHaveProperty('updatedByUserId');
    const listed = await json(await fetch(`${baseUrl}/live-artifacts`, { headers: await header(owner.id) }));
    expect(listed[0]).not.toHaveProperty('updatedByUserId');
  });

  it('keeps immutable server-derived storage and rejects oversized state', async () => {
    const owner = users.create({ name: 'Owner', email: 'av02-storage@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    const response = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/state`, {
      method: 'PUT',
      headers: { ...(await header(owner.id)), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedStateRevision: 1, state: { payload: 'x'.repeat(512 * 1024) } }),
    });
    expect(response.status).toBe(400);
  });

  it('ignores path-shaped state fields and stores only canonical ID/hash paths', async () => {
    // Regression: client-supplied storage-looking fields must not affect canonical state storage.
    const owner = users.create({ name: 'Owner', email: 'av02-canonical-state@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    const state = { scripture: 'John 3:17' };
    const response = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/state`, {
      method: 'PUT', headers: { ...(await header(owner.id)), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedStateRevision: 1, state, path: '../../secret', stateHash: 'attacker', contentHash: 'attacker', id: '../other', filename: 'state.json' }),
    });
    expect(response.status).toBe(200);
    const stateHash = createHash('sha256').update(JSON.stringify(state)).digest('hex');
    // Content is addressed by (artifact, kind, hash) in the database; attacker
    // supplied path/id/filename fields cannot steer where it lands.
    expect(db.prepare('SELECT body FROM live_artifact_contents WHERE artifact_id = ? AND kind = ? AND hash = ?')
      .get(artifact.id, 'state', stateHash)).toEqual({ body: JSON.stringify(state) });
    expect(db.prepare('SELECT COUNT(*) AS count FROM live_artifact_contents WHERE artifact_id != ?').get(artifact.id)).toEqual({ count: 0 });
    expect(existsSync(path.join(env.liveArtifactStorageDir, 'other'))).toBe(false);
  });

  it('stores canonical hashes under fixed paths and keeps deleted content', async () => {
    const owner = users.create({ name: 'Owner', email: 'av02-fixed-storage@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    const state = JSON.stringify({ scripture: 'John 3:16' });
    const stateHash = createHash('sha256').update(state).digest('hex');
    const bundleHash = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
    const stored = (kind: string, hash: string) => db
      .prepare('SELECT body FROM live_artifact_contents WHERE artifact_id = ? AND kind = ? AND hash = ?')
      .get(artifact.id, kind, hash) as { body: string } | undefined;
    expect(JSON.parse(stored('bundle', bundleHash)!.body).html).toBe(bundle.html);
    expect(stored('state', stateHash)!.body).toBe(state);
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { method: 'DELETE', headers: await header(owner.id) })).status).toBe(204);
    // A soft delete keeps content addressable for prior-access tombstone reads.
    expect(stored('bundle', bundleHash)).toBeTruthy();
  });

  it('rejects traversal-shaped route input without disclosure', async () => {
    const owner = users.create({ name: 'Owner', email: 'av02-traversal@example.com' });
    const response = await fetch(`${baseUrl}/live-artifacts/..%2f..%2fetc%2fpasswd`, { headers: await header(owner.id) });
    expect(response.status).toBe(404);
    expect(JSON.stringify(await json(response))).not.toMatch(/etc|passwd|\.{2}|\//);
  });

  it('enforces private/shared/organization visibility and owner-only management', async () => {
    const owner = users.create({ name: 'Owner', email: 'av02-owner-auth@example.com' });
    const collaborator = users.create({ name: 'Collaborator', email: 'av02-collab@example.com' });
    const outsider = users.create({ name: 'Outsider', email: 'av02-out@example.com' });
    const workspaceId = workspace(owner.id, [collaborator.id]);
    const artifact = await create(owner.id, workspaceId, 'shared');
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: await header(collaborator.id) })).status).toBe(404);
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}/collaborators`, { method: 'POST', headers: { ...(await header(owner.id)), 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: collaborator.id }) })).status).toBe(201);
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: await header(collaborator.id) })).status).toBe(200);
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: await header(outsider.id) })).status).toBe(404);
  });

  it('removes a collaborator using the numeric route parameter and rejects non-numeric IDs', async () => {
    // Regression: Express supplies path params as strings; strict integer validation must not leave a revoked grant behind.
    const owner = users.create({ name: 'Owner', email: 'av02-delete-collaborator-owner@example.com' });
    const collaborator = users.create({ name: 'Collaborator', email: 'av02-delete-collaborator-user@example.com' });
    const artifact = await create(owner.id, workspace(owner.id, [collaborator.id]), 'shared');
    const headers = await header(owner.id);
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}/collaborators`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: collaborator.id }) })).status).toBe(201);
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}/collaborators/${collaborator.id}`, { method: 'DELETE', headers })).status).toBe(204);
    expect(await json(await fetch(`${baseUrl}/live-artifacts/${artifact.id}/collaborators`, { headers }))).toEqual([]);
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}/collaborators/not-a-number`, { method: 'DELETE', headers })).status).toBe(400);
  });

  it('AV-03 P1: creates shared artifacts with workspace collaborators visible immediately', async () => {
    // Regression: create silently drops collaborators, leaving the shared artifact unreadable.
    const owner = users.create({ name: 'Owner', email: 'av03-create-owner@example.com' });
    const collaborator = users.create({ name: 'Collaborator', email: 'av03-create-collaborator@example.com' });
    const workspaceId = workspace(owner.id, [collaborator.id]);
    const response = await fetch(`${baseUrl}/live-artifacts`, {
      method: 'POST',
      headers: { ...(await header(owner.id)), 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'html', title: 'Worship Calendar', workspaceId, visibility: 'shared', collaborators: [collaborator.id], bundle, state: { scripture: 'John 3:16' } }),
    });
    expect(response.status).toBe(201);
    const artifact = await json(response) as { id: string };
    expect(await json(await fetch(`${baseUrl}/live-artifacts`, { headers: await header(collaborator.id) }))).toEqual([expect.objectContaining({ id: artifact.id })]);
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: await header(collaborator.id) })).status).toBe(200);
  });

  it('AV-03 P2: rejects invalid and cross-workspace collaborators before publishing any create state', async () => {
    // Regression: storage or initial rows survive when one requested collaborator is invalid.
    const owner = users.create({ name: 'Owner', email: 'av03-atomic-owner@example.com' });
    const member = users.create({ name: 'Member', email: 'av03-atomic-member@example.com' });
    const outsider = users.create({ name: 'Outsider', email: 'av03-atomic-outsider@example.com' });
    const workspaceId = workspace(owner.id, [member.id]);
    for (const collaborators of [[0], [outsider.id]]) {
      const response = await fetch(`${baseUrl}/live-artifacts`, {
        method: 'POST',
        headers: { ...(await header(owner.id)), 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'html', title: 'Worship Calendar', workspaceId, visibility: 'shared', collaborators, bundle, state: { scripture: 'John 3:16' } }),
      });
      expect(response.status).toBe(400);
    }
    for (const table of ['live_artifacts', 'live_artifact_bundle_revisions', 'live_artifact_state_revisions', 'live_artifact_collaborators']) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect(existsSync(env.liveArtifactStorageDir)).toBe(false);
  });

  it('AV-03 P3: preserves default private owner-only create behavior', async () => {
    // Regression: adding create-time sharing changes the default artifact visibility or access.
    const owner = users.create({ name: 'Owner', email: 'av03-default-owner@example.com' });
    const member = users.create({ name: 'Member', email: 'av03-default-member@example.com' });
    const artifact = await create(owner.id, workspace(owner.id, [member.id]));
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: await header(member.id) })).status).toBe(404);
    expect(db.prepare('SELECT visibility FROM live_artifacts WHERE id = ?').get(artifact.id)).toEqual({ visibility: 'private' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM live_artifact_collaborators WHERE artifact_id = ?').get(artifact.id)).toEqual({ count: 0 });
  });

  it('revoked workspace member loses shared list and handler access', async () => {
    // Regression: a collaborator row alone must not survive workspace revocation.
    const owner = users.create({ name: 'Owner', email: 'av02-revoked-owner@example.com' });
    const collaborator = users.create({ name: 'Collaborator', email: 'av02-revoked-collaborator@example.com' });
    const workspaceId = workspace(owner.id, [collaborator.id]);
    const artifact = await create(owner.id, workspaceId, 'shared');
    await fetch(`${baseUrl}/live-artifacts/${artifact.id}/collaborators`, { method: 'POST', headers: { ...(await header(owner.id)), 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: collaborator.id }) });
    db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(workspaceId, collaborator.id);
    const collaboratorHeaders = await header(collaborator.id);
    expect((await json(await fetch(`${baseUrl}/live-artifacts`, { headers: collaboratorHeaders }))).length).toBe(0);
    for (const suffix of ['', '/render', '/state', '/bundle']) {
      const response = await fetch(`${baseUrl}/live-artifacts/${artifact.id}${suffix}`, { method: suffix ? 'PUT' : 'GET', headers: suffix ? { ...collaboratorHeaders, 'Content-Type': 'application/json' } : collaboratorHeaders, body: suffix === '/state' ? JSON.stringify({ expectedStateRevision: 1, state: {} }) : suffix === '/bundle' ? JSON.stringify({ expectedBundleRevision: 1, bundle }) : undefined });
      expect(response.status).toBe(404);
    }
  });

  it('uses independent CAS and has exactly one concurrent state winner', async () => {
    const owner = users.create({ name: 'Owner', email: 'av02-cas@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    const ownerHeaders = await header(owner.id);
    const write = (state: string) => fetch(`${baseUrl}/live-artifacts/${artifact.id}/state`, { method: 'PUT', headers: { ...ownerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedStateRevision: 1, state: { state } }) });
    const statuses = await Promise.all([write('first'), write('second')]).then((responses) => Promise.all(responses.map((response) => response.status)));
    expect(statuses.sort()).toEqual([200, 409]);
  });

  it('advances bundle and state independently with actor audit rows', async () => {
    const owner = users.create({ name: 'Owner', email: 'av02-independent-audit@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    const headers = { ...(await header(owner.id)), 'Content-Type': 'application/json' };
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}/bundle`, { method: 'PUT', headers, body: JSON.stringify({ expectedBundleRevision: 1, bundle: { ...bundle, js: 'window.updated = true;' } }) })).status).toBe(200);
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}/state`, { method: 'PUT', headers, body: JSON.stringify({ expectedStateRevision: 1, state: { scripture: 'John 3:17' } }) })).status).toBe(200);
    const detail = await json(await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: await header(owner.id) }));
    expect(detail).toMatchObject({ currentBundleRevision: 2, currentStateRevision: 2 });
    for (const table of ['live_artifact_bundle_revisions', 'live_artifact_state_revisions']) {
      expect(db.prepare(`SELECT actor_user_id, hash, created_at FROM ${table} WHERE artifact_id = ? AND revision = 2`).get(artifact.id)).toMatchObject({ actor_user_id: owner.id });
    }
  });

  it('atomically publishes updated bundles before advancing the pointer', async () => {
    // Regression: mkdir(destination) must not expose an empty new hash to a successful PUT.
    const owner = users.create({ name: 'Owner', email: 'av02-atomic-update@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    const updatedBundle = { ...bundle, js: 'window.updatedBundle = true;' };
    const response = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/bundle`, { method: 'PUT', headers: { ...(await header(owner.id)), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedBundleRevision: 1, bundle: updatedBundle }) });
    expect(response.status).toBe(200);
    const rendered = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/render`, { headers: await header(owner.id) });
    expect(rendered.status).toBe(200);
    expect(await rendered.text()).toContain(updatedBundle.js);
    const bundleHash = createHash('sha256').update(JSON.stringify(updatedBundle)).digest('hex');
    expect(db.prepare('SELECT body FROM live_artifact_contents WHERE artifact_id = ? AND kind = ? AND hash = ?')
      .get(artifact.id, 'bundle', bundleHash)).toEqual({ body: JSON.stringify(updatedBundle) });
  });

  it('keeps the current bundle pointer unchanged when storage publication fails', async () => {
    const owner = users.create({ name: 'Owner', email: 'av02-publish-failure@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    const before = db.prepare('SELECT current_bundle_revision, current_bundle_hash FROM live_artifacts WHERE id = ?').get(artifact.id);
    const rows = db.prepare('SELECT COUNT(*) AS count FROM live_artifact_bundle_revisions WHERE artifact_id = ?').get(artifact.id) as { count: number };
    // Content persistence fails; the revision pointer must not advance.
    const publish = vi.spyOn(LiveArtifactStorage.prototype, 'publishBundle')
      .mockRejectedValue(new Error('storage unavailable'));
    const response = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/bundle`, { method: 'PUT', headers: { ...(await header(owner.id)), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedBundleRevision: 1, bundle: { ...bundle, js: 'window.neverPublished = true;' } }) });
    expect(response.status).toBe(500);
    expect(db.prepare('SELECT current_bundle_revision, current_bundle_hash FROM live_artifacts WHERE id = ?').get(artifact.id)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS count FROM live_artifact_bundle_revisions WHERE artifact_id = ?').get(artifact.id)).toEqual(rows);
    publish.mockRestore();
  });

  it('republishing identical bundle content stays consistent and renderable', async () => {
    // Replaces a filesystem-era test about empty hash directories and .tmp- dirs:
    // database content storage has no partial directories or temp files to heal.
    const owner = users.create({ name: 'Owner', email: 'av02-empty-destination@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    const updatedBundle = { ...bundle, js: 'window.selfHealed = true;' };
    const bundleHash = createHash('sha256').update(JSON.stringify(updatedBundle)).digest('hex');
    const put = async (expectedBundleRevision: number) => fetch(`${baseUrl}/live-artifacts/${artifact.id}/bundle`, {
      method: 'PUT',
      headers: { ...(await header(owner.id)), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedBundleRevision, bundle: updatedBundle }),
    });
    expect((await put(1)).status).toBe(200);
    expect((await put(2)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS count FROM live_artifact_contents WHERE artifact_id = ? AND kind = ? AND hash = ?')
      .get(artifact.id, 'bundle', bundleHash)).toEqual({ count: 1 });
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}/render`, { headers: await header(owner.id) })).status).toBe(200);
  });

  const parityPolicy = "default-src 'none'; script-src 'unsafe-inline' blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com data:; img-src data: blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; media-src data: blob:; connect-src blob:; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

  it('renders fragment bundles with the exact Claude-parity CSP while preserving sandbox boundaries', async () => {
    // Regression: a nonce CSP or an omitted CDN host makes otherwise valid Claude artifacts fail to render.
    const owner = users.create({ name: 'Owner', email: 'rt-fragment-csp@example.com' });
    const artifact = await create(owner.id, workspace(owner.id), 'private', { ...bundle, html: '<meta http-equiv="refresh" content="0;https://attacker.test"><main>fragment</main>' });
    const response = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/render`, { headers: await header(owner.id) });
    const document = await response.text();
    const headerPolicy = response.headers.get('content-security-policy') ?? '';
    const metaPolicy = document.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1] ?? '';
    expect(headerPolicy).toBe(`sandbox allow-scripts; ${parityPolicy}; frame-ancestors 'none'`);
    expect(metaPolicy).toBe(parityPolicy);
    expect(document).toMatch(/^<!doctype html><html><head>/i);
    expect(document).not.toMatch(/http-equiv="refresh"/i);
    expect(document).not.toMatch(/nonce=/i);
    expect(headerPolicy).not.toContain("'unsafe-eval'");
    expect(document.indexOf('<meta http-equiv="Content-Security-Policy"')).toBeLessThan(document.indexOf('<meta charset'));
  });

  it('allows self-contained bundle scripts to hydrate from blobs without enabling network fetches', async () => {
    // Standalone artifact exporters unpack embedded dependencies into blob URLs,
    // then load them as scripts or read them back before Babel transforms JSX.
    const owner = users.create({ name: 'Owner', email: 'rt-blob-bundle-csp@example.com' });
    const artifact = await create(owner.id, workspace(owner.id), 'private', {
      ...bundle,
      html: '<script>const u=URL.createObjectURL(new Blob(["window.hydrated=true"],{type:"application/javascript"}));fetch(u).then(r=>r.text());const s=document.createElement("script");s.src=u;document.head.appendChild(s);</script>',
    });
    const response = await fetch(`${baseUrl}/live-artifacts/${artifact.id}/render`, { headers: await header(owner.id) });
    const document = await response.text();
    const headerPolicy = response.headers.get('content-security-policy') ?? '';
    const metaPolicy = document.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1] ?? '';
    for (const policy of [headerPolicy, metaPolicy]) {
      expect(policy).toMatch(/script-src [^;]*\bblob:/);
      expect(policy).toContain('connect-src blob:');
      expect(policy).not.toMatch(/connect-src [^;]*https?:/);
    }
    expect(headerPolicy).toContain('sandbox allow-scripts');
    expect(headerPolicy).toContain("frame-ancestors 'none'");
  });

  it('injects full documents without double wrapping and preserves inline artifact blocks', async () => {
    // Regression: wrapping a standalone Claude document discards its head/body semantics or breaks inline style and script execution.
    const owner = users.create({ name: 'Owner', email: 'rt-full-document@example.com' });
    const fullHtml = ' \n<!DOCTYPE html><html lang="en"><body><style>.kept { color: rebeccapurple; }</style><script>window.inlineArtifact = true;</script><main class="kept">Claude</main></body></html>';
    const artifact = await create(owner.id, workspace(owner.id), 'private', { html: fullHtml, css: 'body { margin: 0; }', js: 'window.bundleArtifact = true;' });
    const document = await (await fetch(`${baseUrl}/live-artifacts/${artifact.id}/render`, { headers: await header(owner.id) })).text();
    expect(document.match(/<!doctype/gi)).toHaveLength(1);
    expect(document.match(/<html\b/gi)).toHaveLength(1);
    expect(document).toContain('<style>.kept { color: rebeccapurple; }</style>');
    expect(document).toContain('<script>window.inlineArtifact = true;</script>');
    expect(document).toContain('<style>body { margin: 0; }</style>');
    expect(document).toContain('<script>window.bundleArtifact = true;</script>');
    expect(document.indexOf('<meta http-equiv="Content-Security-Policy"')).toBeLessThan(document.indexOf('<meta charset'));
  });

  it('strips refresh navigation and escapes bundle CSS and JS in fragment and full-document paths', async () => {
    // Regression: a refresh or closing tag from any assembly path can navigate or terminate an injected bundle block.
    const owner = users.create({ name: 'Owner', email: 'rt-escaping@example.com' });
    for (const html of ['<meta http-equiv="refresh" content="0;https://attacker.test"><main>fragment</main>', '<!doctype html><html><body><meta http-equiv="refresh" content="0;https://attacker.test"><main>full</main></body></html>']) {
      const artifact = await create(owner.id, workspace(owner.id), 'private', { html, css: 'x</style><style>y', js: 'x</script><script>y' });
      const document = await (await fetch(`${baseUrl}/live-artifacts/${artifact.id}/render`, { headers: await header(owner.id) })).text();
      expect(document).not.toMatch(/http-equiv="refresh"/i);
      expect(document).toContain('\\3c /style');
      expect(document).toContain('<\\/script>');
    }
  });

  it('installs the immutable bridge bootstrap before stored artifact code', async () => {
    // Regression: stored JS could replace the host callback or forge a response
    // before the runtime has bound a request to its native artifact/user frame.
    const owner = users.create({ name: 'Owner', email: 'av06-render-bootstrap@example.com' });
    const artifact = await create(owner.id, workspace(owner.id), 'private', {
      ...bundle,
      js: 'window.bootstrapOrder = typeof window.rhythm;',
    });
    const document = await (await fetch(`${baseUrl}/live-artifacts/${artifact.id}/render`, { headers: await header(owner.id) })).text();
    expect(document.indexOf('Object.defineProperty(window,"__rhythmHostResponse"')).toBeGreaterThan(-1);
    expect(document.indexOf('Object.defineProperty(window,"__rhythmHostResponse"')).toBeLessThan(document.indexOf('window.bootstrapOrder'));
    expect(document).toContain('configurable:false');
    expect(document).toContain('RhythmBridge.postMessage');
    expect(document).toContain('nonce:n');
  });

  it('missing stored content leaks no path or stack', async () => {
    // Regression: raw node fs errors include the storage layout and stack frames in the shared error log.
    const owner = users.create({ name: 'Owner', email: 'av02-storage-leak@example.com' });
    const artifact = await create(owner.id, workspace(owner.id));
    db.prepare('DELETE FROM live_artifact_contents WHERE artifact_id = ?').run(artifact.id);
    await rm(path.join(env.liveArtifactStorageDir, artifact.id), { recursive: true, force: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: await header(owner.id) });
    const logged = JSON.stringify(error.mock.calls);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await json(response))).not.toMatch(/state|bundles|ENOENT|\n\s+at\s/);
    expect(logged).not.toMatch(/\/state\/|\/bundles\/|\n\s+at\s/);
    expect(error).toHaveBeenCalledWith('[ERROR] live-artifact storage operation failed', { artifactId: artifact.id, kind: 'state', op: 'read', code: 'ENOENT' });
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}/render`, { headers: await header(owner.id) })).status).toBe(500);
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/\/state\/|\/bundles\/|\n\s+at\s/);
    expect(error).toHaveBeenCalledWith('[ERROR] live-artifact storage operation failed', { artifactId: artifact.id, kind: 'bundle', op: 'read', code: 'ENOENT' });
    error.mockRestore();
  });

  it('limits metadata capabilities to owner and the pco read allowlist', async () => {
    const owner = users.create({ name: 'Owner', email: 'av02-cap-owner@example.com' });
    const member = users.create({ name: 'Member', email: 'av02-cap-member@example.com' });
    const artifact = await create(owner.id, workspace(owner.id, [member.id]), 'organization');
    const rejected = await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { method: 'PATCH', headers: { ...(await header(member.id)), 'Content-Type': 'application/json' }, body: JSON.stringify({ declaredCapabilities: ['pco.services.read'] }) });
    expect(rejected.status).toBe(404);
    const allowed = await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { method: 'PATCH', headers: { ...(await header(owner.id)), 'Content-Type': 'application/json' }, body: JSON.stringify({ declaredCapabilities: ['pco.services.read', 'anything.execute'] }) });
    expect(allowed.status).toBe(400);
  });

  it('soft-deletes without disclosing paths, returning a tombstone only to prior access', async () => {
    const owner = users.create({ name: 'Owner', email: 'av02-delete-owner@example.com' });
    const member = users.create({ name: 'Member', email: 'av02-delete-member@example.com' });
    const artifact = await create(owner.id, workspace(owner.id, [member.id]), 'organization');
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: await header(member.id) })).status).toBe(200);
    expect((await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { method: 'DELETE', headers: await header(owner.id) })).status).toBe(204);
    const tombstone = await fetch(`${baseUrl}/live-artifacts/${artifact.id}`, { headers: await header(member.id) });
    expect(tombstone.status).toBe(410);
    expect(JSON.stringify(await json(tombstone))).toContain('artifact_deleted');
  });
});
