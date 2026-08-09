import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = live ? describe : describe.skip;
const base = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4001';
const dbPath = process.env.RHYTHM_SANDBOX_DB ?? process.env.RHYTHM_LIVE_DB_PATH;
let db: Database.Database;
let token: string;
let workspaceId: number;
let userId: number;

describeLive('live artifact HTTP behavior (AV-02)', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (!dbPath || new URL(base).port === '4001') throw new Error('sandbox DB and non-default live URL are required');
    expect((await fetch(`${base}/health`)).ok).toBe(true);
    db = new Database(dbPath);
    const suffix = randomUUID();
    userId = Number(db.prepare('INSERT INTO users (name,email) VALUES (?,?)').run('AV02 live', `av02-${suffix}@example.test`).lastInsertRowid);
    workspaceId = Number(db.prepare('INSERT INTO workspaces (name,join_code,created_by) VALUES (?,?,?)').run('AV02 live', suffix, userId).lastInsertRowid);
    db.prepare('INSERT INTO workspace_members (workspace_id,user_id) VALUES (?,?)').run(workspaceId, userId);
    token = randomUUID(); db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, userId);
  });
  afterAll(() => { if (db) { db.transaction(() => { db.prepare('DELETE FROM live_artifact_bundle_revisions WHERE artifact_id IN (SELECT id FROM live_artifacts WHERE owner_user_id=?)').run(userId); db.prepare('DELETE FROM live_artifact_state_revisions WHERE artifact_id IN (SELECT id FROM live_artifacts WHERE owner_user_id=?)').run(userId); db.prepare('DELETE FROM live_artifacts WHERE owner_user_id=?').run(userId); db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); db.prepare('DELETE FROM workspace_members WHERE user_id=?').run(userId); db.prepare('DELETE FROM workspaces WHERE id=?').run(workspaceId); db.prepare('DELETE FROM users WHERE id=?').run(userId); })(); db.close(); } });
  it('creates, renders, reads, CAS-updates, and soft-deletes through the running API', async () => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const created = await fetch(`${base}/live-artifacts`, { method: 'POST', headers, body: JSON.stringify({ type: 'html', title: 'Live AV02', workspaceId, bundle: { html: '<main>live</main>', css: 'main{}', js: 'window.live=true' }, state: { scripture: 'John 3:16' } }) });
    expect(created.status).toBe(201); const artifact = await created.json() as { id: string; currentStateRevision: number; currentBundleRevision: number };
    expect((await fetch(`${base}/live-artifacts/${artifact.id}/render`, { headers })).headers.get('content-security-policy')).toContain("default-src 'none'");
    const bundleUpdate = await fetch(`${base}/live-artifacts/${artifact.id}/bundle`, { method: 'PUT', headers, body: JSON.stringify({ expectedBundleRevision: artifact.currentBundleRevision, bundle: { html: '<main>live updated</main>', css: 'main{color:green}', js: 'window.liveUpdated=true' } }) });
    expect(bundleUpdate.status).toBe(200);
    const updatedRender = await fetch(`${base}/live-artifacts/${artifact.id}/render`, { headers });
    expect(updatedRender.status).toBe(200);
    expect(await updatedRender.text()).toContain('window.liveUpdated=true');
    const update = await fetch(`${base}/live-artifacts/${artifact.id}/state`, { method: 'PUT', headers, body: JSON.stringify({ expectedStateRevision: artifact.currentStateRevision, state: { scripture: 'John 3:17' } }) });
    expect(update.status).toBe(200);
    expect((await fetch(`${base}/live-artifacts/${artifact.id}`, { headers })).status).toBe(200);
    expect((await fetch(`${base}/live-artifacts/${artifact.id}`, { method: 'DELETE', headers })).status).toBe(204);
    expect((await fetch(`${base}/live-artifacts/${artifact.id}`, { headers })).status).toBe(410);
  });
  it('enforces revocation and contains missing-file details on the running API', async () => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const collaboratorId = Number(db.prepare('INSERT INTO users (name,email) VALUES (?,?)').run('AV02 collaborator', `av02-collaborator-${randomUUID()}@example.test`).lastInsertRowid);
    const collaboratorToken = randomUUID();
    db.prepare('INSERT INTO workspace_members (workspace_id,user_id) VALUES (?,?)').run(workspaceId, collaboratorId);
    db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(collaboratorToken, collaboratorId);
    const created = await fetch(`${base}/live-artifacts`, { method: 'POST', headers, body: JSON.stringify({ type: 'html', title: 'Revocation probe', workspaceId, visibility: 'shared', bundle: { html: '<main>live</main>', css: 'main{}', js: 'window.live=true' }, state: {} }) });
    const artifact = await created.json() as { id: string };
    await fetch(`${base}/live-artifacts/${artifact.id}/collaborators`, { method: 'POST', headers, body: JSON.stringify({ userId: collaboratorId }) });
    db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(workspaceId, collaboratorId);
    const collaboratorHeaders = { Authorization: `Bearer ${collaboratorToken}` };
    expect((await fetch(`${base}/live-artifacts`, { headers: collaboratorHeaders })).status).toBe(200);
    expect(await (await fetch(`${base}/live-artifacts`, { headers: collaboratorHeaders })).json()).toEqual([]);
    expect((await fetch(`${base}/live-artifacts/${artifact.id}`, { headers: collaboratorHeaders })).status).toBe(404);
    const sandbox = process.env.RHYTHM_SANDBOX_DIR ?? path.join(tmpdir(), 'rhythm-dev-sandbox');
    await rm(path.join(sandbox, 'live-artifacts', artifact.id), { recursive: true, force: true });
    const missing = await fetch(`${base}/live-artifacts/${artifact.id}`, { headers });
    expect(missing.status).toBe(500);
    expect(JSON.stringify(await missing.json())).not.toMatch(/state|bundles|ENOENT|\n\s+at\s/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const log = await readFile(path.join(sandbox, 'api_server.log'), 'utf8');
    expect(log).not.toMatch(new RegExp(`Unhandled GET /live-artifacts/${artifact.id}|/live-artifacts/${artifact.id}/state/|\\n\\s+at\\s`));
    db.prepare('DELETE FROM live_artifact_collaborators WHERE artifact_id=? AND user_id=?').run(artifact.id, collaboratorId);
    db.prepare('DELETE FROM sessions WHERE token=?').run(collaboratorToken);
    db.prepare('DELETE FROM users WHERE id=?').run(collaboratorId);
  });

  it('AV05 reads the viewer PCO fixture only when declared, without token disclosure', async () => {
    const fixtureToken = 'av05-sandbox-fixture-token';
    let authorization: string | undefined;
    const fixture = http.createServer((req, res) => {
      authorization = req.headers.authorization;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'st-live', attributes: { name: 'Live Sunday', token: 'hostile' } }], links: { self: 'https://hostile.test' }, meta: { token: 'hostile' } }));
    });
    await new Promise<void>((resolve) => fixture.listen(4199, '127.0.0.1', resolve));
    const collaboratorId = Number(db.prepare('INSERT INTO users (name,email) VALUES (?,?)').run('AV05 viewer', `av05-viewer-${randomUUID()}@example.test`).lastInsertRowid);
    const collaboratorToken = randomUUID();
    db.prepare('INSERT INTO workspace_members (workspace_id,user_id) VALUES (?,?)').run(workspaceId, collaboratorId);
    db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(collaboratorToken, collaboratorId);
    const now = new Date().toISOString();
    const insertIntegration = db.prepare('INSERT INTO integration_accounts (id,owner_id,provider,external_account_id,email,display_name,status,access_token,refresh_token,scope,token_type,expires_at,last_synced_at,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    insertIntegration.run(randomUUID(), userId, 'planning_center', 'owner-pco', null, null, 'connected', 'owner-token', null, null, 'Bearer', null, null, null, now, now);
    insertIntegration.run(randomUUID(), collaboratorId, 'planning_center', 'viewer-pco', null, null, 'connected', fixtureToken, null, null, 'Bearer', null, null, null, now, now);
    try {
      const ownerHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const viewerHeaders = { Authorization: `Bearer ${collaboratorToken}`, 'Content-Type': 'application/json' };
      const created = await fetch(`${base}/live-artifacts`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ type: 'html', title: 'AV05 live', workspaceId, visibility: 'shared', collaborators: [collaboratorId], declaredCapabilities: ['pco.services.read'], bundle: { html: '<main>live</main>', css: '', js: '' }, state: {} }) });
      expect(created.status).toBe(201); const { id } = await created.json() as { id: string };
      const connected = await fetch(`${base}/live-artifacts/${id}/capabilities/pco.services.read`, { method: 'POST', headers: viewerHeaders, body: JSON.stringify({ operation: 'list_service_types' }) });
      expect(connected.status).toBe(200); const connectedPayload = await connected.json(); expect(connectedPayload).toEqual({ operation: 'list_service_types', data: [{ id: 'st-live', name: 'Live Sunday' }] });
      expect(authorization).toBe(`Bearer ${fixtureToken}`);
      expect(JSON.stringify(connectedPayload)).not.toContain(fixtureToken);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const sandbox = process.env.RHYTHM_SANDBOX_DIR ?? path.join(tmpdir(), 'rhythm-dev-sandbox');
      expect(await readFile(path.join(sandbox, 'api_server.log'), 'utf8')).not.toContain(fixtureToken);
      // Undeclared artifact the viewer CAN read: proves 403 comes from the missing declaration, not
      // from inaccessibility. A private artifact would 404 here and never exercise that branch.
      const undeclared = await fetch(`${base}/live-artifacts`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ type: 'html', title: 'AV05 undeclared', workspaceId, visibility: 'organization', declaredCapabilities: [], bundle: { html: '<main>live</main>', css: '', js: '' }, state: {} }) });
      expect(undeclared.status).toBe(201);
      const undeclaredId = (await undeclared.json() as { id: string }).id;
      expect((await fetch(`${base}/live-artifacts/${undeclaredId}`, { headers: viewerHeaders })).status).toBe(200);
      const undeclaredResponse = await fetch(`${base}/live-artifacts/${undeclaredId}/capabilities/pco.services.read`, { method: 'POST', headers: viewerHeaders, body: JSON.stringify({ operation: 'list_service_types' }) });
      expect(undeclaredResponse.status).toBe(403);
      expect((await undeclaredResponse.json() as { error: { code: string } }).error.code).toBe('capability_not_declared');
      // Inaccessible artifact stays non-disclosing.
      const privateArtifact = await fetch(`${base}/live-artifacts`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ type: 'html', title: 'AV05 private', workspaceId, declaredCapabilities: ['pco.services.read'], bundle: { html: '<main>live</main>', css: '', js: '' }, state: {} }) });
      const privateId = (await privateArtifact.json() as { id: string }).id;
      expect((await fetch(`${base}/live-artifacts/${privateId}/capabilities/pco.services.read`, { method: 'POST', headers: viewerHeaders, body: JSON.stringify({ operation: 'list_service_types' }) })).status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
      db.prepare("DELETE FROM integration_accounts WHERE owner_id IN (?,?) AND provider='planning_center'").run(userId, collaboratorId);
      db.prepare('DELETE FROM live_artifact_collaborators WHERE user_id=?').run(collaboratorId); db.prepare('DELETE FROM sessions WHERE user_id=?').run(collaboratorId); db.prepare('DELETE FROM workspace_members WHERE user_id=?').run(collaboratorId); db.prepare('DELETE FROM users WHERE id=?').run(collaboratorId);
    }
  });
});
