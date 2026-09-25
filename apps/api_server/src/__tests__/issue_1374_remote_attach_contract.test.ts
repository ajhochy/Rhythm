import { createHash } from 'node:crypto';
import http from 'node:http';

import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { errorHandler } from '../middleware/error_handler';
import { initializeMobilePairingSchema, MobileDevicesRepository } from '../repositories/mobile_devices_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { createRelayGatewayRouter } from '../routes/relay_gateway_routes';
import { createMobileGatewayRouter } from '../routes/mobile_gateway_routes';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';
import { MobileOpenCodeOwnershipRepository } from '../repositories/mobile_opencode_ownership_repository';
import { resetMobileGatewayRuntimeForTest } from '../services/mobile_gateway_runtime';
import { OpencodeEventHub } from '../services/opencode_event_hub';
import { logger } from '../utils/logger';

let nextHarnessPort = 7431;
const PROJECT = { id: 'project-1374', root: '/private/tmp' };
const SESSION_ID = 'ses_remote_1374';
const DEVICE_TOKEN = 'desktop-device-token-synthetic';

function verifier(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function ownedBy(userId = 1) {
  return {
    isResourceOwnedBy: (kind: string, id: string, owner: number, project: string) => kind === 'session' && id === SESSION_ID && owner === userId && project === PROJECT.id,
    isResourceExplicitlyOwnedBy: (kind: string, id: string, owner: number, project: string) => kind === 'session' && id === SESSION_ID && owner === userId && project === PROJECT.id,
    resolveSessionDirectoryForOwner: (id: string, owner: number, project: string) => id === SESSION_ID && owner === userId && project === PROJECT.id ? PROJECT.root : null,
  } as never;
}

interface OperationRow {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

const operationRows: readonly OperationRow[] = [
  { name: 'session list', method: 'GET', path: '/mobile-gateway/opencode/experimental/session' },
  { name: 'messages', method: 'GET', path: `/mobile-gateway/opencode/session/${SESSION_ID}/message` },
  { name: 'prompt_async', method: 'POST', path: `/mobile-gateway/opencode/session/${SESSION_ID}/prompt_async`, body: { parts: [{ type: 'text', text: 'synthetic prompt' }] } },
  { name: 'permission reply', method: 'POST', path: '/mobile-gateway/opencode/permission/perm_1374/reply', body: { reply: 'once' } },
  { name: 'question reply', method: 'POST', path: '/mobile-gateway/opencode/question/question_1374/reply', body: { answers: [['yes']] } },
  { name: 'abort', method: 'POST', path: `/mobile-gateway/opencode/session/${SESSION_ID}/abort` },
];
const sessionSseRow: OperationRow = {
  name: 'session SSE',
  method: 'GET',
  path: `/mobile-gateway/sessions/${SESSION_ID}/events`,
};

interface RelayContractHarness {
  baseUrl: string;
  sessionToken: string;
  deviceId: string;
  engineRequests: string[];
  rpcRequests: string[];
  hub: OpencodeEventHub;
  repository: MobileDevicesRepository;
  userId: number;
  close(): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function startRelayHarness(ownershipFactory: (userId: number) => any = ownedBy): Promise<RelayContractHarness> {
  const port = nextHarnessPort++;
  if (port > 7439) throw new Error('Remote attach test port block exhausted');
  const db = new Database(':memory:'); runMigrations(db); initializeMobilePairingSchema(db); setDb(db); resetMobileGatewayRuntimeForTest();
  const user = new UsersRepository().create({ name: 'Remote desktop owner', email: 'remote-owner@example.invalid' });
  db.prepare(`INSERT INTO projects (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty, vcs_checked_at, created_at, archived_at) VALUES (?, 'Remote', ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`).run(PROJECT.id, PROJECT.root, '2026-09-24T00:00:00Z');
  db.prepare(`INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, sdk_session_id, owner_user_id, project_id, created_at, updated_at) VALUES ('local-1374', 'Remote session', 'codex', 'idle', ?, ?, ?, ?, ?, ?)`)
    .run(PROJECT.root, SESSION_ID, user.id, PROJECT.id, '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z');
  const session = new SessionsRepository().create(user.id);
  const repository = new MobileDevicesRepository(db);
  repository.upsertBootstrapDevice({ id: 'enrollment-1374', hostId: 'host-1374', userId: user.id, name: 'Primary Mac', tokenVerifier: verifier('enrollment-token'), revokedAt: null, createdAt: '2026-09-24T00:00:00Z' });

  const engineRequests: string[] = []; const rpcRequests: string[] = [];
  const ownership = new MobileOpenCodeOwnershipRepository(db);
  ownership.claimResource('session', SESSION_ID, user.id, PROJECT.id);
  const engineProxy = new MobileOpenCodeProxy({ ownershipRepository: ownership, preparePromptStream: async () => {}, fetchFn: async (input, init) => {
    const url = new URL(String(input)); engineRequests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname === '/session') return Response.json([{ id: SESSION_ID, directory: PROJECT.root }]);
    if (url.pathname === '/session/status') return Response.json({});
    if (url.pathname.includes('/message')) return Response.json([]);
    if (url.pathname === '/permission') return Response.json([{ id: 'perm_1374', sessionID: SESSION_ID }]);
    if (url.pathname === '/question') return Response.json([{ id: 'question_1374', sessionID: SESSION_ID }]);
    return new Response(null, { status: url.pathname.endsWith('/prompt_async') ? 204 : 200, headers: { 'content-type': 'application/json' } });
  }});
  const hub = new OpencodeEventHub(); hub.setLive(true);
  const deviceId = createHash('sha256').update(`cloud-bootstrap\0host-1374\0${user.id}\0Secondary desktop`).digest('hex');
  const uplink = {
    hub,
    onResynced: () => () => {},
    isHostOnline: () => true,
    isMacOnline: () => true,
    getLastUplinkAt: () => '2026-09-24T00:00:00Z',
    getHealth: () => ({ status: 'ok' }),
    sendRpc: async (request: { method: string; path: string; headers: Record<string, string>; bodyB64: string }) => {
      rpcRequests.push(request.path);
      if (request.path === '/mobile-gateway/bootstrap/connect') {
        repository.upsertBootstrapDevice({ id: deviceId, hostId: 'host-1374', userId: user.id, name: 'Secondary desktop', tokenVerifier: verifier(DEVICE_TOKEN), revokedAt: null, createdAt: '2026-09-24T00:00:00Z' });
        return { status: 201, headers: { 'content-type': 'application/json' }, bodyB64: Buffer.from(JSON.stringify({ hostId: 'host-1374', userId: user.id, deviceId, deviceToken: DEVICE_TOKEN })).toString('base64') };
      }
      const response = await fetch(`http://127.0.0.1:${port}/mac${request.path}`, { method: request.method, headers: request.headers, ...(request.bodyB64 ? { body: Buffer.from(request.bodyB64, 'base64') } : {}) });
      return { status: response.status, headers: Object.fromEntries(response.headers), bodyB64: Buffer.from(await response.arrayBuffer()).toString('base64') };
    },
  };
  const app = express(); app.use(express.json());
  app.use('/mac/mobile-gateway', createMobileGatewayRouter({ opencodeProxy: engineProxy }));
  app.use('/relay', createRelayGatewayRouter({ uplink: uplink as never, ownershipRepository: ownershipFactory(user.id), relayPublicUrl: `http://127.0.0.1:${port}`, allowInsecureLoopbackForTests: true })); app.use(errorHandler);
  const server = http.createServer(app); server.listen(port, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const close = async () => { hub.setLive(false); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); resetMobileGatewayRuntimeForTest(); };
  cleanups.push(close);
  return { baseUrl: `http://127.0.0.1:${port}/relay`, sessionToken: session.token, deviceId, engineRequests, rpcRequests, hub, repository, userId: user.id, close };
}

async function connectDesktop(harness: RelayContractHarness): Promise<string> {
  const response = await fetch(`${harness.baseUrl}/mobile-environments/host-1374/connect`, { method: 'POST', headers: { Authorization: `Bearer ${harness.sessionToken}`, 'Content-Type': 'application/json', 'X-Rhythm-Client-Capability': 'remote-attach-desktop-v1' }, body: JSON.stringify({ deviceName: 'Secondary desktop' }) });
  expect(response.status).toBe(201);
  const grant = await response.json() as { deviceToken: string; deviceId: string; capabilities: string[] };
  expect(grant.deviceId).toBe(harness.deviceId);
  expect(grant.capabilities).toContain('remote-attach-desktop-v1');
  return grant.deviceToken;
}

describe('issue #1374 remote attach server contract', () => {
  it('review:relay_gateway_routes.ts:381 converts SSE scope failures and accepts desktop-catalog ownership', async () => {
    let throwing = false;
    const harness = await startRelayHarness(userId => ({
      ...(ownedBy(userId) as unknown as Record<string, unknown>),
      isResourceOwnedBy: () => { if (throwing) throw new Error('sensitive database detail'); return false; },
      isSessionOwnedByDesktopCatalog: (id: string, owner: number, project: string) => id === SESSION_ID && owner === userId && project === PROJECT.id,
    }));
    const token = await connectDesktop(harness);
    for (const path of ['/mobile-gateway/events', sessionSseRow.path]) {
      const response = await fetch(`${harness.baseUrl}${path}`, { headers: { Authorization: `Device ${token}` } });
      expect(response.status, path).toBe(400);
    }
    const controller = new AbortController();
    const desktopCatalog = await fetch(`${harness.baseUrl}${sessionSseRow.path}`, { headers: { Authorization: `Device ${token}`, 'X-Rhythm-Project-ID': PROJECT.id }, signal: controller.signal });
    expect(desktopCatalog.status).toBe(200); controller.abort();
    throwing = true;
    const failed = await fetch(`${harness.baseUrl}${sessionSseRow.path}`, { headers: { Authorization: `Device ${token}`, 'X-Rhythm-Project-ID': PROJECT.id } });
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('sensitive database detail');
  });

  it('1374:remote-attach-server-contract:1 desktop Device grant carries every remote attach operation', async () => {
    const harness = await startRelayHarness(); const token = await connectDesktop(harness);
    for (const row of operationRows) {
      const response = await fetch(`${harness.baseUrl}${row.path}`, { method: row.method, headers: { Authorization: `Device ${token}`, 'X-Rhythm-Project-ID': PROJECT.id, 'X-Rhythm-Client-Capability': 'remote-attach-desktop-v1', ...(row.body ? { 'Content-Type': 'application/json' } : {}) }, ...(row.body ? { body: JSON.stringify(row.body) } : {}) });
      expect(response.status, row.name).toBeLessThan(300);
    }
    const controller = new AbortController();
    const sse = await fetch(`${harness.baseUrl}${sessionSseRow.path}`, { headers: { Authorization: `Device ${token}`, 'X-Rhythm-Project-ID': PROJECT.id }, signal: controller.signal });
    expect(sse.status).toBe(200); controller.abort();
  });

  it('1374:remote-attach-server-contract:2 second-user, revoked, and stale devices fail every ID-addressed row before the engine', async () => {
    const harness = await startRelayHarness(); await connectDesktop(harness);
    const secondToken = 'second-user-device';
    harness.repository.upsertBootstrapDevice({ id: 'second-user', hostId: 'host-1374', userId: harness.userId + 1, name: 'Other user', tokenVerifier: verifier(secondToken), revokedAt: null, createdAt: '2026-09-24T00:00:00Z' });
    const revokedToken = 'revoked-device';
    harness.repository.upsertBootstrapDevice({ id: 'revoked', hostId: 'host-1374', userId: harness.userId, name: 'Revoked', tokenVerifier: verifier(revokedToken), revokedAt: null, createdAt: '2026-09-24T00:00:00Z' });
    harness.repository.revokeDevice('revoked', harness.userId, '2026-09-24T01:00:00Z');
    for (const [label, token] of [['second-user', secondToken], ['revoked', revokedToken], ['stale', 'unknown-stale-token']] as const) {
      const addressedRows = [...operationRows.filter(item => item.path.includes(SESSION_ID) || item.path.includes('perm_') || item.path.includes('question_')), sessionSseRow];
      for (const row of addressedRows) {
        const beforeMutations = harness.engineRequests.filter(item => /POST/.test(item)).length;
        const response = await fetch(`${harness.baseUrl}${row.path}`, { method: row.method, headers: { Authorization: `Device ${token}`, 'X-Rhythm-Project-ID': PROJECT.id, ...(row.body ? { 'Content-Type': 'application/json' } : {}) }, ...(row.body ? { body: JSON.stringify(row.body) } : {}) });
        expect([401, 403, 404], `${label}: ${row.name}`).toContain(response.status);
        expect(harness.engineRequests.filter(item => /POST/.test(item)).length, `${label}: ${row.name}`).toBe(beforeMutations);
      }
    }
  });

  it('1374:remote-attach-server-contract:3 desktop busy prompt_async is rejected while phone queuing is unchanged', async () => {
    const requests: string[] = [];
    const proxy = new MobileOpenCodeProxy({ ownershipRepository: ownedBy(), fetchFn: async input => { const url = new URL(String(input)); requests.push(`${url.pathname}${url.search}`); if (url.pathname === '/session/status') return Response.json({ [SESSION_ID]: { type: 'busy' } }); return new Response(null, { status: 204 }); }, preparePromptStream: async () => {} });
    const response = await proxy.forward({ method: 'POST', path: `/session/${SESSION_ID}/prompt_async`, query: new URLSearchParams(), body: { parts: [{ type: 'text', text: 'busy prompt' }] }, project: PROJECT, userId: 1, remoteAttachDesktop: true });
    expect(response.status).toBe(409);
    expect(JSON.parse(Buffer.from(response.body).toString('utf8'))).toEqual({ error: 'session_busy' });
    expect(requests.filter(path => path.includes('prompt_async'))).toHaveLength(0);
    requests.length = 0;
    const phone = await proxy.forward({ method: 'POST', path: `/session/${SESSION_ID}/prompt_async`, query: new URLSearchParams(), body: { parts: [{ type: 'text', text: 'phone queues' }] }, project: PROJECT, userId: 1 });
    expect(phone.status).toBe(204);
    expect(requests.filter(path => path.includes('/session/status'))).toHaveLength(0);
    expect(requests.filter(path => path.includes('prompt_async'))).toHaveLength(1);
  });

  it('1374:remote-attach-server-contract:3b desktop busy gate treats a missing status entry as idle and only blocks on busy/retry for its own session', async () => {
    // The real engine (opencode_fork session/status.ts) deletes a session's
    // entry from GET /session/status once it goes idle, and get() defaults
    // an absent session to idle. A missing entry must therefore behave like
    // 'idle', not 'busy'.
    const requests: string[] = [];
    let statusBody: Record<string, unknown> = {};
    const proxy = new MobileOpenCodeProxy({ ownershipRepository: ownedBy(), fetchFn: async input => { const url = new URL(String(input)); requests.push(`${url.pathname}${url.search}`); if (url.pathname === '/session/status') return Response.json(statusBody); return new Response(null, { status: 204 }); }, preparePromptStream: async () => {} });
    const send = () => proxy.forward({ method: 'POST', path: `/session/${SESSION_ID}/prompt_async`, query: new URLSearchParams(), body: { parts: [{ type: 'text', text: 'probe' }] }, project: PROJECT, userId: 1, remoteAttachDesktop: true });

    statusBody = {}; // real engine shape for an idle/never-run session
    const idle = await send();
    expect(idle.status).toBe(204);
    expect(requests.filter(path => path.includes('prompt_async'))).toHaveLength(1);

    requests.length = 0;
    statusBody = { [SESSION_ID]: { type: 'retry' } };
    const retry = await send();
    expect(retry.status).toBe(409);
    expect(requests.filter(path => path.includes('prompt_async'))).toHaveLength(0);

    requests.length = 0;
    statusBody = { ses_other_session: { type: 'busy' } };
    const otherSessionBusy = await send();
    expect(otherSessionBusy.status).toBe(204);
    expect(requests.filter(path => path.includes('prompt_async'))).toHaveLength(1);
  });

  it('1374:remote-attach-server-contract:4 repeated client messageID records one user message after a dropped response', async () => {
    const messages = new Map<string, unknown>(); let promptPosts = 0; const forwardedIds: string[] = [];
    const mappings = new Map<string, string>();
    const repository = { ...(ownedBy() as unknown as Record<string, unknown>), resolveOrCreatePromptMessageId: (owner: number, project: string, session: string, client: string, proposed: string) => { const key = `${owner}:${project}:${session}:${client}`; const value = mappings.get(key) ?? proposed; mappings.set(key, value); return value; } } as never;
    const options = { ownershipRepository: repository, fetchFn: async (input: string | URL | Request, init?: RequestInit) => { const url = new URL(String(input)); if (url.pathname.includes('/message/')) { const id = decodeURIComponent(url.pathname.split('/').pop()!); const value = messages.get(id); return value ? Response.json(value) : Response.json({ error: 'missing' }, { status: 404 }); } if (url.pathname.endsWith('/prompt_async') && init?.method === 'POST') { promptPosts += 1; const id = (JSON.parse(String(init.body)) as { messageID: string }).messageID; forwardedIds.push(id); messages.set(id, { info: { id, sessionID: SESSION_ID, role: 'user' }, parts: [] }); if (promptPosts === 1) throw new TypeError('simulated response drop'); return new Response(null, { status: 204 }); } return Response.json([]); }, preparePromptStream: async () => {} };
    const proxy = new MobileOpenCodeProxy(options);
    const input = { method: 'POST', path: `/session/${SESSION_ID}/prompt_async`, query: new URLSearchParams(), body: { messageID: 'msg_client_1374', parts: [{ type: 'text', text: 'retry once' }] }, project: PROJECT, userId: 1 };
    await expect(proxy.forward(input)).rejects.toMatchObject({ code: 'OPENCODE_UNAVAILABLE' });
    const retry = await new MobileOpenCodeProxy(options).forward(input);
    expect(retry.status).toBe(204);
    expect(promptPosts).toBe(1);
    expect(messages.size).toBe(1);
    expect(forwardedIds[0]).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(forwardedIds[0]).not.toBe('msg_client_1374');
  });

  it('1374:remote-attach-server-contract:4b a 409 never reserves an id, so a same-client retry after other activity forwards a fresher id, and a true duplicate is suppressed exactly once', async () => {
    const db = new Database(':memory:'); runMigrations(db); setDb(db);
    const user = new UsersRepository().create({ name: '4b owner', email: '4b-owner@example.invalid' });
    const ownership = new MobileOpenCodeOwnershipRepository(db);
    ownership.claimResource('session', SESSION_ID, user.id, PROJECT.id);
    const messages = new Map<string, unknown>();
    const forwardedIds: string[] = [];
    let promptPosts = 0;
    let statusBody: Record<string, unknown> = { [SESSION_ID]: { type: 'busy' } };
    const proxy = new MobileOpenCodeProxy({
      ownershipRepository: ownership,
      fetchFn: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/session/status') return Response.json(statusBody);
        if (url.pathname.includes('/message/')) {
          const id = decodeURIComponent(url.pathname.split('/').pop()!);
          const value = messages.get(id);
          return value ? Response.json(value) : Response.json({ error: 'missing' }, { status: 404 });
        }
        if (url.pathname.endsWith('/prompt_async') && init?.method === 'POST') {
          promptPosts += 1;
          const id = (JSON.parse(String(init.body)) as { messageID: string }).messageID;
          forwardedIds.push(id);
          messages.set(id, { info: { id, sessionID: SESSION_ID, role: 'user' }, parts: [] });
          return new Response(null, { status: 204 });
        }
        return Response.json([]);
      },
      preparePromptStream: async () => {},
    });
    const send = (messageID: string) => proxy.forward({ method: 'POST', path: `/session/${SESSION_ID}/prompt_async`, query: new URLSearchParams(), body: { messageID, parts: [{ type: 'text', text: 'retry after busy' }] }, project: PROJECT, userId: user.id, remoteAttachDesktop: true });

    // The session is busy: rejected before any id is ever reserved.
    const busy = await send('client-A');
    expect(busy.status).toBe(409);
    expect(promptPosts).toBe(0);

    // A later message completes while client-A was blocked (a running
    // turn's next assistant step, or another client's prompt). Its id is
    // now the high-water mark the engine's prompt loop compares against.
    statusBody = { [SESSION_ID]: { type: 'idle' } };
    await send('client-newer');
    expect(promptPosts).toBe(1);
    const newerId = forwardedIds[0];

    // client-A retries with the SAME client id. Because nothing was
    // reserved during the 409, this mints a fresh id rather than resending
    // one that would sort behind the newer message and never get a reply.
    const retried = await send('client-A');
    expect(retried.status).toBe(204);
    expect(promptPosts).toBe(2);
    const retriedId = forwardedIds[1];
    expect(retriedId > newerId).toBe(true);
    expect(retriedId).not.toBe(newerId);

    // A true duplicate of that retry — the engine already has the message —
    // is suppressed exactly once, with no additional forward.
    const duplicate = await send('client-A');
    expect(duplicate.status).toBe(204);
    expect(promptPosts).toBe(2);
    db.close();
  });

  it('review:mobile_opencode_proxy.ts:1198 scopes client idempotency and preserves ascending engine order', async () => {
    const forwarded: Array<{ userId: number; id: string }> = [];
    const proxy = new MobileOpenCodeProxy({ ownershipRepository: ownedBy(), fetchFn: async (input, init) => { const url = new URL(String(input)); if (url.pathname.includes('/message/')) return new Response(null, { status: 404 }); if (url.pathname.endsWith('/prompt_async')) { const id = (JSON.parse(String(init?.body)) as { messageID: string }).messageID; forwarded.push({ userId: forwarded.length + 1, id }); return new Response(null, { status: 204 }); } return Response.json([]); }, preparePromptStream: async () => {} });
    const make = (userId: number, messageID: string) => proxy.forward({ method: 'POST', path: `/session/${SESSION_ID}/prompt_async`, query: new URLSearchParams(), body: { messageID, parts: [{ type: 'text', text: 'safe' }] }, project: PROJECT, userId });
    await make(1, 'zzzz_non_monotonic_client');
    await expect(make(2, 'zzzz_non_monotonic_client')).rejects.toMatchObject({ statusCode: 404 });
    await make(1, 'aaaa_still_client_chosen');
    expect(forwarded).toHaveLength(2);
    expect(forwarded[0].id).not.toBe(forwarded[1].id);
    expect(forwarded[0].id < forwarded[1].id).toBe(true);
  });

  it('1374:remote-attach-server-contract:5 lifecycle logs are hashed and content-free', async () => {
    const lines: unknown[][] = []; vi.spyOn(logger, 'info').mockImplementation((...args: unknown[]) => { lines.push(args); });
    const proxy = new MobileOpenCodeProxy({ ownershipRepository: ownedBy(), fetchFn: async input => { const path = new URL(String(input)).pathname; if (path === '/session/status') return Response.json({}); return new Response(null, { status: 204 }); }, preparePromptStream: async () => {} });
    const deviceId = 'desktop-device-raw-id'; const promptText = 'PROMPT_TEXT_MUST_NOT_LOG'; const token = 'TOKEN_MUST_NOT_LOG'; const cwd = '/Users/private/secret-project';
    await proxy.forward({ method: 'GET', path: `/session/${SESSION_ID}/message`, query: new URLSearchParams(), project: PROJECT, userId: 1, deviceId } as never);
    await proxy.forward({ method: 'POST', path: `/session/${SESSION_ID}/prompt_async`, query: new URLSearchParams(), body: { parts: [{ type: 'text', text: promptText }] }, project: PROJECT, userId: 1, deviceId } as never);
    await proxy.forward({ method: 'POST', path: `/session/${SESSION_ID}/abort`, query: new URLSearchParams(), project: PROJECT, userId: 1, deviceId } as never);
    const harness = await startRelayHarness(); const relayToken = await connectDesktop(harness);
    await fetch(`${harness.baseUrl}/mobile-gateway/opencode/experimental/session`, { headers: { Authorization: `Device ${relayToken}`, 'X-Rhythm-Project-ID': PROJECT.id } });
    const output = JSON.stringify(lines);
    expect(output).toContain(createHash('sha256').update(deviceId).digest('hex').slice(0, 16));
    expect(output).toContain(SESSION_ID);
    expect(output).toContain(createHash('sha256').update(harness.deviceId).digest('hex').slice(0, 16));
    expect(output).toContain('mirror_authorized');
    expect(output).toContain('connect'); expect(output).toContain('attach'); expect(output).toContain('prompt'); expect(output).toContain('abort');
    expect(output).not.toContain(deviceId); expect(output).not.toContain(promptText); expect(output).not.toContain(token); expect(output).not.toContain(cwd);
  });
});
