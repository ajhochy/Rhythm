import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../app';
import { env } from '../config/env';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { capabilityRateLimit } from '../controllers/live_artifact_capabilities_controller';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { logger } from '../utils/logger';
import { startTestServer } from './helpers/real_server';

const bundle = { html: '<main>Calendar</main>', css: '', js: '' };
const token = 'av05-fixture-token';
const realNow = capabilityRateLimit.now;
// live_artifacts.test.ts recursively wipes the cwd-relative default storage dir between its own
// tests. Sharing that path makes the two files race under vitest's parallel file execution
// (ENOTEMPTY on rmdir, 500 on a create landing in a directory being removed), so this file owns a
// private root and only ever deletes that.
const storageRoot = path.join(tmpdir(), `av05-live-artifacts-${randomUUID()}`);
const defaultStorageRoot = env.liveArtifactStorageDir;
env.liveArtifactStorageDir = storageRoot;
async function json(response: Response) { const text = await response.text(); return text ? JSON.parse(text) : null; }

describe('live artifact PCO capability (AV-05 contract)', () => {
  let db: Database.Database; let users: UsersRepository; let sessions: SessionsRepository; let accounts: IntegrationAccountsRepository;
  let baseUrl: string; let close: () => Promise<void>; let fixture: http.Server; let fixtureUrl: string; let seenAuthorization: string | undefined; let fixtureStatus = 200; let fixtureCalls = 0;
  beforeEach(async () => {
    db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db); setDb(db);
    fixtureStatus = 200; fixtureCalls = 0; seenAuthorization = undefined;
    capabilityRateLimit.now = realNow; capabilityRateLimit.reset();
    users = new UsersRepository(); sessions = new SessionsRepository(); accounts = new IntegrationAccountsRepository();
    fixture = http.createServer((req, res) => {
      fixtureCalls += 1;
      seenAuthorization = req.headers.authorization;
      if (fixtureStatus !== 200) { res.statusCode = fixtureStatus; res.end('denied'); return; }
      const data = req.url?.includes('/service_types?') ? [{ id: 'st1', attributes: { name: 'Sunday', token: 'hostile', links: { self: 'https://attacker.test' } } }]
        : req.url?.includes('/plans?') ? [{ id: 'p1', attributes: { title: 'Plan', dates: '2026-08-09', meta: { authorization: 'stolen' }, links: { self: 'https://attacker.test' }, sequence: 3 } }]
        : [{ id: 'i1', attributes: { title: 'Song', item_type: 'song', secret: 'nope' } }];
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data, links: { next: 'https://attacker.test' }, meta: { token: 'hostile' } }));
    });
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
    fixtureUrl = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
    process.env.RHYTHM_LIVE_E2E = '1'; process.env.RHYTHM_PCO_LIVE_BASE_URL = fixtureUrl;
    ({ baseUrl, close } = await startTestServer(createApp()));
  });
  afterEach(async () => { capabilityRateLimit.now = realNow; capabilityRateLimit.reset(); vi.restoreAllMocks(); await close(); await new Promise<void>((resolve) => fixture.close(() => resolve())); delete process.env.RHYTHM_LIVE_E2E; delete process.env.RHYTHM_PCO_LIVE_BASE_URL; db.close(); await rm(storageRoot, { recursive: true, force: true }); });
  afterAll(async () => { env.liveArtifactStorageDir = defaultStorageRoot; await rm(storageRoot, { recursive: true, force: true }); });
  async function headers(userId: number) { const session = await sessions.createAsync(userId); return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }; }
  function workspace(ownerId: number, members: number[] = []) { const row = db.prepare('INSERT INTO workspaces (name, join_code, created_by) VALUES (?, ?, ?)').run('AV05', `av05-${Math.random()}`, ownerId); const id = Number(row.lastInsertRowid); for (const userId of [ownerId, ...members]) db.prepare('INSERT INTO workspace_members (workspace_id, user_id) VALUES (?, ?)').run(id, userId); return id; }
  async function artifact(ownerId: number, workspaceId: number, declaredCapabilities: string[] = [], visibility = 'private', collaborators: number[] = []) { const response = await fetch(`${baseUrl}/live-artifacts`, { method: 'POST', headers: await headers(ownerId), body: JSON.stringify({ type: 'html', title: 'Calendar', workspaceId, bundle, state: {}, declaredCapabilities, visibility, collaborators }) }); expect(response.status).toBe(201); return json(response) as Promise<{ id: string }>; }
  async function connect(userId: number, accessToken = token) { await accounts.upsertPlanningCenterAccountAsync({ ownerId: userId, externalAccountId: `pco-${userId}`, email: null, displayName: null, accessToken, refreshToken: null, scope: null, tokenType: 'Bearer', expiresAt: null }); }
  async function read(userId: number, id: string, body: unknown) { return fetch(`${baseUrl}/live-artifacts/${id}/capabilities/pco.services.read`, { method: 'POST', headers: await headers(userId), body: typeof body === 'string' ? body : JSON.stringify(body) }); }

  it('AV05-c1 authenticates the narrow declared capability route', async () => { const owner = users.create({ name: 'Owner', email: 'av05-route@example.test' }); await connect(owner.id); const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id; expect((await fetch(`${baseUrl}/live-artifacts/${id}/capabilities/pco.services.read`, { method: 'POST' })).status).toBe(401); expect((await read(owner.id, id, { operation: 'list_service_types' })).status).toBe(200); });
  it('AV05-c2 applies access, declaration, and tombstone rules', async () => { const owner = users.create({ name: 'Owner', email: 'av05-owner@example.test' }); const viewer = users.create({ name: 'Viewer', email: 'av05-viewer@example.test' }); await connect(viewer.id); const id = (await artifact(owner.id, workspace(owner.id, [viewer.id]), ['pco.services.read'], 'shared', [viewer.id])).id; expect((await read(viewer.id, id, { operation: 'list_service_types' })).status).toBe(200); const hidden = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id; expect((await read(viewer.id, hidden, { operation: 'list_service_types' })).status).toBe(404); const undeclared = (await artifact(owner.id, workspace(owner.id))).id; expect((await read(owner.id, undeclared, { operation: 'list_service_types' })).status).toBe(403); db.prepare('UPDATE live_artifacts SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id); expect((await read(viewer.id, id, { operation: 'list_service_types' })).status).toBe(410); });

  // An organization-visible artifact must be readable by any workspace member on their OWN PCO
  // connection — the owner-only and collaborator-only paths are not the whole AV02 matrix.
  it('AV05-c2 serves organization viewers who are not collaborators and hides it from outsiders', async () => {
    const owner = users.create({ name: 'Owner', email: 'av05-org-owner@example.test' });
    const member = users.create({ name: 'Member', email: 'av05-org-member@example.test' });
    const outsider = users.create({ name: 'Outsider', email: 'av05-org-outsider@example.test' });
    await connect(member.id, 'member-token');
    await connect(outsider.id, 'outsider-token');
    const id = (await artifact(owner.id, workspace(owner.id, [member.id]), ['pco.services.read'], 'organization')).id;
    const memberResponse = await read(member.id, id, { operation: 'list_service_types' });
    expect(memberResponse.status).toBe(200);
    expect(seenAuthorization).toBe('Bearer member-token');
    const outsiderResponse = await read(outsider.id, id, { operation: 'list_service_types' });
    expect(outsiderResponse.status).toBe(404);
    expect((await json(outsiderResponse)).error.code).toBe('NOT_FOUND');
    const undeclared = (await artifact(owner.id, workspace(owner.id, [member.id]), [], 'organization')).id;
    const undeclaredResponse = await read(member.id, undeclared, { operation: 'list_service_types' });
    expect(undeclaredResponse.status).toBe(403);
    expect((await json(undeclaredResponse)).error.code).toBe('capability_not_declared');
  });

  it('AV05-c3 rejects non-allowlisted operations, keys, and malformed identifiers', async () => { const owner = users.create({ name: 'Owner', email: 'av05-schema@example.test' }); const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id; for (const body of [{ operation: 'PATCH' }, { operation: 'list_plans', serviceTypeId: 'st1', filter: 'all' }, { operation: 'list_plans', serviceTypeId: 'st1', filter: 'future', url: 'https://attacker.test' }, { operation: 'list_plan_items', serviceTypeId: '../st1', planId: 'p1' }]) expect((await read(owner.id, id, body)).status).toBe(400); });

  // The schema is a closed allowlist, so every attempt to smuggle an operation, a transport
  // control, or a credential must be rejected BEFORE any upstream call happens.
  const forbiddenOperations: Array<[string, unknown]> = [
    ['unknown read', { operation: 'list_songs' }],
    ['write: create plan', { operation: 'create_plan', serviceTypeId: 'st1' }],
    ['write: update plan item', { operation: 'update_plan_item', serviceTypeId: 'st1', planId: 'p1' }],
    ['write: delete plan item', { operation: 'delete_plan_item', serviceTypeId: 'st1', planId: 'p1' }],
    ['undeclared read outside the allowlist', { operation: 'list_needed_positions', serviceTypeId: 'st1', planId: 'p1' }],
    ['raw http verb', { operation: 'GET' }],
    ['missing operation', {}],
    ['array operation', { operation: ['list_service_types'] }],
    ['null operation', { operation: null }],
    ['array body', []],
  ];
  it.each(forbiddenOperations)('AV05-c3 rejects %s without calling Planning Center', async (_label, body) => {
    const owner = users.create({ name: 'Owner', email: `av05-op-${Math.random()}@example.test` });
    await connect(owner.id);
    const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id;
    const response = await read(owner.id, id, body);
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe('BAD_REQUEST');
    expect(fixtureCalls).toBe(0);
  });

  const forbiddenFields: Array<[string, unknown]> = [
    ['header injection', { operation: 'list_service_types', headers: { Authorization: 'Bearer stolen' } }],
    ['method override', { operation: 'list_service_types', method: 'DELETE' }],
    ['credential passthrough', { operation: 'list_service_types', accessToken: 'stolen' }],
    ['body passthrough', { operation: 'list_service_types', body: { data: { attributes: { title: 'x' } } } }],
    ['arbitrary url', { operation: 'list_service_types', url: 'https://attacker.test' }],
    ['base url override', { operation: 'list_service_types', baseUrl: 'https://attacker.test' }],
    ['path traversal service type', { operation: 'list_plans', serviceTypeId: '../../people/v2/people', filter: 'future' }],
    ['path traversal plan id', { operation: 'list_plan_items', serviceTypeId: 'st1', planId: 'p1/../../..' }],
    ['whitespace in identifier', { operation: 'list_plan_items', serviceTypeId: 'st 1', planId: 'p1' }],
    ['absolute url as identifier', { operation: 'list_plan_items', serviceTypeId: 'https://attacker.test', planId: 'p1' }],
    ['query smuggling in identifier', { operation: 'list_plan_items', serviceTypeId: 'st1?per_page=1&include=x', planId: 'p1' }],
    ['oversize identifier', { operation: 'list_plan_items', serviceTypeId: 'a'.repeat(129), planId: 'p1' }],
    ['empty identifier', { operation: 'list_plan_items', serviceTypeId: '', planId: 'p1' }],
    ['numeric identifier', { operation: 'list_plan_items', serviceTypeId: 1, planId: 'p1' }],
    ['object identifier', { operation: 'list_plan_items', serviceTypeId: { toString: 'st1' }, planId: 'p1' }],
    ['array identifier', { operation: 'list_plan_items', serviceTypeId: ['st1'], planId: 'p1' }],
    ['missing filter', { operation: 'list_plans', serviceTypeId: 'st1' }],
    ['unknown filter', { operation: 'list_plans', serviceTypeId: 'st1', filter: 'all' }],
    ['array filter', { operation: 'list_plans', serviceTypeId: 'st1', filter: ['future'] }],
    ['extra key beside a valid request', { operation: 'list_service_types', extra: true }],
  ];
  it.each(forbiddenFields)('AV05-c3 rejects %s without calling Planning Center', async (_label, body) => {
    const owner = users.create({ name: 'Owner', email: `av05-field-${Math.random()}@example.test` });
    await connect(owner.id);
    const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id;
    expect((await read(owner.id, id, body)).status).toBe(400);
    expect(fixtureCalls).toBe(0);
  });

  it('AV05-c3 rejects non-object and prototype-polluting raw bodies', async () => {
    const owner = users.create({ name: 'Owner', email: 'av05-raw@example.test' });
    await connect(owner.id);
    const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id;
    for (const raw of ['"list_service_types"', '42', 'null', 'not json', '{"operation":"list_service_types","__proto__":{"polluted":true}}']) {
      expect((await read(owner.id, id, raw)).status).toBe(400);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(fixtureCalls).toBe(0);
  });

  it('AV05-c3 rejects an oversized body without calling Planning Center', async () => {
    const owner = users.create({ name: 'Owner', email: 'av05-oversize@example.test' });
    await connect(owner.id);
    const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id;
    const errors = vi.spyOn(logger, 'error');
    // Regression guard: a parser failure must not reflect or log attacker-controlled request bytes.
    const secrets = [
      'Bearer av05-oversize-bearer-fixture',
      'av05-oversize-token-fixture',
      'AV05_OVERSIZED_BODY_MARKER',
      '/state/av05-oversize.json',
      '/bundles/av05-oversize',
      '/private/var/folders/av05-worktree',
      'Error: AV05 injected stack\n    at av05Fixture (fixture.ts:1:1)',
      'currentBundleHash: av05-internal-hash',
    ];
    // Beyond the app-wide 1 MB JSON limit: the exact status belongs to the shared body parser,
    // the contract only requires that oversize input is rejected and never brokered upstream.
    const response = await read(owner.id, id, JSON.stringify({ operation: 'list_service_types', secrets, pad: secrets[2].repeat(50_000) }));
    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fixtureCalls).toBe(0);
    const publicBody = await response.text();
    const capturedLogs = JSON.stringify(errors.mock.calls);
    for (const secret of secrets) {
      expect(publicBody).not.toContain(secret);
      expect(capturedLogs).not.toContain(secret);
    }
  });

  it('AV05-c4 uses the viewer account and retains PCO permission and disconnect errors', async () => { const owner = users.create({ name: 'Owner', email: 'av05-identity@example.test' }); await connect(owner.id, 'viewer-token'); const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id; expect((await read(owner.id, id, { operation: 'list_service_types' })).status).toBe(200); expect(seenAuthorization).toBe('Bearer viewer-token'); fixtureStatus = 403; const response = await read(owner.id, id, { operation: 'list_service_types' }); expect(response.status).toBe(403); expect((await json(response)).error.code).toBe('pco_permission_denied'); db.prepare("DELETE FROM integration_accounts WHERE provider = 'planning_center' AND owner_id = ?").run(owner.id); expect((await read(owner.id, id, { operation: 'list_service_types' })).status).toBe(400); });

  // A disconnected integration must be distinguishable from a rejected request: both are 400,
  // so the machine code is the only thing a client can branch on to prompt "connect Planning Center".
  it('AV05-c4 returns a stable machine code for a disconnected account and never leaks account internals', async () => {
    const owner = users.create({ name: 'Owner', email: 'av05-disconnected@example.test' });
    const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id;
    const disconnected = await read(owner.id, id, { operation: 'list_service_types' });
    expect(disconnected.status).toBe(400);
    const payload = await json(disconnected);
    expect(payload.error.code).toBe('pco_not_connected');
    expect(payload.error.code).not.toBe('BAD_REQUEST');
    expect(fixtureCalls).toBe(0);
    await connect(owner.id, 'schema-token');
    const rejected = await read(owner.id, id, { operation: 'list_plans', serviceTypeId: 'st1', filter: 'all' });
    expect(rejected.status).toBe(400);
    expect((await json(rejected)).error.code).toBe('BAD_REQUEST');
    fixtureStatus = 403;
    const denied = await read(owner.id, id, { operation: 'list_service_types' });
    expect(denied.status).toBe(403);
    const deniedPayload = await json(denied);
    expect(deniedPayload.error.code).toBe('pco_permission_denied');
    expect(JSON.stringify(deniedPayload)).not.toContain('schema-token');
    expect(JSON.stringify(deniedPayload)).not.toContain(fixtureUrl);
  });

  it('AV05-c5 projects hostile upstream payloads to named summaries only', async () => { const owner = users.create({ name: 'Owner', email: 'av05-projection@example.test' }); await connect(owner.id); const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id; const response = await read(owner.id, id, { operation: 'list_service_types' }); expect(response.status).toBe(200); expect(await json(response)).toEqual({ operation: 'list_service_types', data: [{ id: 'st1', name: 'Sunday' }] }); });

  // Each operation gets its own exact-shape assertion: a projection regression on one read must not
  // be masked by another read still being clean.
  it('AV05-c5 strips links, meta, and credential fields from every projected read', async () => {
    const owner = users.create({ name: 'Owner', email: 'av05-projection-all@example.test' });
    await connect(owner.id);
    const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id;
    const serviceTypes = await json(await read(owner.id, id, { operation: 'list_service_types' }));
    const plans = await json(await read(owner.id, id, { operation: 'list_plans', serviceTypeId: 'st1', filter: 'future' }));
    const items = await json(await read(owner.id, id, { operation: 'list_plan_items', serviceTypeId: 'st1', planId: 'p1' }));
    expect(serviceTypes).toEqual({ operation: 'list_service_types', data: [{ id: 'st1', name: 'Sunday' }] });
    expect(plans).toEqual({ operation: 'list_plans', data: [{ id: 'p1', title: 'Plan', dates: '2026-08-09' }] });
    expect(items).toEqual({ operation: 'list_plan_items', data: [{ id: 'i1', title: 'Song', type: 'song' }] });
    const serialized = JSON.stringify([serviceTypes, plans, items]);
    for (const forbidden of ['hostile', 'stolen', 'nope', 'attacker.test', 'links', 'meta', 'authorization', 'Bearer', token, fixtureUrl]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('AV05-c6 returns an integer retryAfter with deterministic window boundaries', async () => {
    let clock = Date.parse('2026-08-09T12:00:00.000Z');
    capabilityRateLimit.now = () => clock;
    const owner = users.create({ name: 'Owner', email: 'av05-rate@example.test' });
    await connect(owner.id);
    const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id;
    for (let index = 0; index < 30; index++) expect((await read(owner.id, id, { operation: 'list_service_types' })).status).toBe(200);
    const first = await json(await read(owner.id, id, { operation: 'list_service_types' }));
    expect(first.error.retryAfter).toBe(60);
    expect(Number.isInteger(first.error.retryAfter)).toBe(true);
    expect(first.error.retryAfter).toBeGreaterThanOrEqual(1);
    expect(first.error.retryAfter).toBeLessThanOrEqual(60);
    clock += 59_001;
    const nearReset = await json(await read(owner.id, id, { operation: 'list_service_types' }));
    expect(nearReset.error.retryAfter).toBe(1);
  });

  // The window is keyed userId:artifactId, so one exhausted pair must not deny a different user or a
  // different artifact — and the window must actually expire and prune, not leak keys forever.
  it('AV05-c6 isolates limiter keys and resets and prunes the window', async () => {
    let clock = Date.parse('2026-08-09T12:00:00.000Z');
    capabilityRateLimit.now = () => clock;
    const owner = users.create({ name: 'Owner', email: 'av05-rate-keys-owner@example.test' });
    const other = users.create({ name: 'Other', email: 'av05-rate-keys-other@example.test' });
    await connect(owner.id); await connect(other.id);
    const workspaceId = workspace(owner.id, [other.id]);
    const first = (await artifact(owner.id, workspaceId, ['pco.services.read'], 'organization')).id;
    const second = (await artifact(owner.id, workspaceId, ['pco.services.read'], 'organization')).id;
    for (let index = 0; index < 30; index++) expect((await read(owner.id, first, { operation: 'list_service_types' })).status).toBe(200);
    expect((await read(owner.id, first, { operation: 'list_service_types' })).status).toBe(429);
    expect((await read(owner.id, second, { operation: 'list_service_types' })).status).toBe(200);
    expect((await read(other.id, first, { operation: 'list_service_types' })).status).toBe(200);
    expect(capabilityRateLimit.size()).toBe(3);
    clock += 59_000;
    expect((await read(owner.id, first, { operation: 'list_service_types' })).status).toBe(429);
    clock += 2_000;
    expect((await read(owner.id, first, { operation: 'list_service_types' })).status).toBe(200);
    expect(capabilityRateLimit.size()).toBe(1);
  });

  it('AV05-c7 supports each read without raw upstream disclosure', async () => { const owner = users.create({ name: 'Owner', email: 'av05-reads@example.test' }); await connect(owner.id); const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id; expect((await read(owner.id, id, { operation: 'list_plans', serviceTypeId: 'st1', filter: 'past' })).status).toBe(200); const response = await read(owner.id, id, { operation: 'list_plan_items', serviceTypeId: 'st1', planId: 'p1' }); expect(await json(response)).toEqual({ operation: 'list_plan_items', data: [{ id: 'i1', title: 'Song', type: 'song' }] }); });

  // The audit record is the only durable trace of a capability call, so assert the emitted fields
  // exactly: enough to answer "who read what, when, and did it work", and nothing else.
  it('AV05-c7 emits the exact five-field audit record for success, 403, accessible 410, and 429', async () => {
    const info = vi.spyOn(logger, 'info');
    const owner = users.create({ name: 'Owner', email: 'av05-audit@example.test' });
    await connect(owner.id, 'audit-token');
    const id = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id;
    const audits = () => info.mock.calls.filter(([message]) => message === 'Live artifact PCO capability completed').map(([, fields]) => fields as Record<string, unknown>);

    expect((await read(owner.id, id, { operation: 'list_plans', serviceTypeId: 'st1', filter: 'future' })).status).toBe(200);
    const success = audits().at(-1)!;
    expect(Object.keys(success).sort()).toEqual(['actorUserId', 'artifactId', 'at', 'operation', 'outcome']);
    expect(success).toMatchObject({ actorUserId: owner.id, artifactId: id, operation: 'list_plans', outcome: 'success' });
    expect(Number.isNaN(Date.parse(success.at as string))).toBe(false);

    const undeclared = (await artifact(owner.id, workspace(owner.id))).id;
    expect((await read(owner.id, undeclared, { operation: 'list_service_types' })).status).toBe(403);
    const denied = audits().at(-1)!;
    expect(Object.keys(denied).sort()).toEqual(['actorUserId', 'artifactId', 'at', 'operation', 'outcome']);
    expect(denied).toMatchObject({ actorUserId: owner.id, artifactId: undeclared, operation: null, outcome: 'failure' });

    const deleted = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id;
    db.prepare('UPDATE live_artifacts SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), deleted);
    expect((await read(owner.id, deleted, { operation: 'list_service_types' })).status).toBe(410);
    const tombstone = audits().at(-1)!;
    expect(Object.keys(tombstone).sort()).toEqual(['actorUserId', 'artifactId', 'at', 'operation', 'outcome']);
    expect(tombstone).toMatchObject({ actorUserId: owner.id, artifactId: deleted, operation: null, outcome: 'failure' });

    let clock = Date.parse('2026-08-09T12:00:00.000Z');
    capabilityRateLimit.now = () => clock;
    const limited = (await artifact(owner.id, workspace(owner.id), ['pco.services.read'])).id;
    for (let index = 0; index < 30; index++) expect((await read(owner.id, limited, { operation: 'list_service_types' })).status).toBe(200);
    expect((await read(owner.id, limited, { operation: 'list_service_types' })).status).toBe(429);
    const rateLimited = audits().at(-1)!;
    expect(Object.keys(rateLimited).sort()).toEqual(['actorUserId', 'artifactId', 'at', 'operation', 'outcome']);
    expect(rateLimited).toMatchObject({ actorUserId: owner.id, artifactId: limited, operation: null, outcome: 'failure' });

    const serialized = JSON.stringify(audits());
    for (const forbidden of ['audit-token', token, fixtureUrl, '/services/v2', 'Bearer', 'accessToken', 'retryAfter', 'message']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
