import { expect, test } from '@playwright/test';
import { isAllowedRemoteGatewayRequest } from '../../../electron/src/remote-environments.mjs';

const modulePath = '../../src/gateway/remote-sessions.ts';

async function loadRemoteSessions(): Promise<any> {
  try {
    return await import(modulePath);
  } catch {
    return null;
  }
}

function fakeBridge(overrides: Record<string, any> = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown; headers?: Record<string, string> }> = [];
  const bridge = {
    enabled: true,
    calls,
    list: async () => ({ state: 'ok', environments: [{ id: 'host-1', name: 'Rhythm Mac', status: 'online', historyAvailable: true }] }),
    connect: async (environmentId: string) => ({ state: 'connected', environmentId, deviceId: 'device-1' }),
    disconnect: async () => {},
    request: async (request: { method: string; path: string; body?: unknown; headers?: Record<string, string> }) => {
      calls.push(request);
      return { state: 'ok', status: 200, body: '[]' };
    },
    subscribe: async (_sessionId: string, _onChunk: (chunk: string) => void, _onEnd?: () => void) => ({ state: 'ok', unsubscribe: async () => {} }),
    ...overrides,
  };
  return bridge;
}

test('remote sessions gateway module exists', async () => {
  const module = await loadRemoteSessions();
  expect(module, 'apps/web/src/gateway/remote-sessions.ts must exist').not.toBeNull();
});

test('remote-1374-c1: listEnvironments and connect map straight through to the bridge', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  const bridge = fakeBridge();
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  expect(gateway.enabled).toBe(true);
  const environments = await gateway.listEnvironments();
  expect(environments).toEqual([{ id: 'host-1', name: 'Rhythm Mac', status: 'online', historyAvailable: true }]);
  const connected = await gateway.connect('host-1');
  expect(connected).toEqual({ state: 'connected', environmentId: 'host-1', deviceId: 'device-1' });
});

test('remote-1374-c2: a disabled bridge (kill switch off) never calls request and reports disabled', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  const bridge = fakeBridge({ enabled: false });
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  expect(gateway.enabled).toBe(false);
  await expect(gateway.list()).rejects.toMatchObject({ code: 'remote_disabled' });
  expect(bridge.calls).toHaveLength(0);
});

test('remote-1374-c3: list() and detail() use opaque remote ids against the exact allowlisted paths', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  const bridge = fakeBridge({
    request: async (request: any) => {
      bridge.calls.push(request);
      if (request.path === '/mobile-gateway/opencode/experimental/session') {
        return { state: 'ok', status: 200, body: JSON.stringify([{ id: 'ses_remote_1' }]) };
      }
      if (request.path === '/mobile-gateway/opencode/session/ses_remote_1/message') {
        return {
          state: 'ok', status: 200,
          body: JSON.stringify([{ info: { id: 'msg_1', role: 'user', time: { created: 1 } }, parts: [{ id: 'prt_1', type: 'text', text: 'hi' }] }]),
          headers: { 'x-next-cursor': 'cursor-2' },
        };
      }
      return { state: 'ok', status: 200, body: '[]' };
    },
  });
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  const sessions = await gateway.list();
  expect(sessions).toEqual([{ id: 'ses_remote_1' }]);
  const page = await gateway.detail('ses_remote_1');
  expect(page.messages).toHaveLength(1);
  expect(page.messages[0].id).toBe('msg_1');
  expect(page.pageInfo).toEqual({ nextCursor: 'cursor-2', hasMore: true });
});

test('remote-1374-c4: prompts carry a generated client message id and a retry reuses it', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  const bridge = fakeBridge();
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  const first = await gateway.prompt('ses_1', 'hello');
  expect(typeof first.clientMessageId).toBe('string');
  expect(bridge.calls[0].body.messageID).toBe(first.clientMessageId);
  const retry = await gateway.prompt('ses_1', 'hello', first.clientMessageId);
  expect(retry.clientMessageId).toBe(first.clientMessageId);
  expect(bridge.calls[1].body.messageID).toBe(first.clientMessageId);
});

test('remote-1374-c5: cancel aborts the turn via the abort path', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  const bridge = fakeBridge();
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  await gateway.cancel('ses_1');
  expect(bridge.calls).toEqual([{ method: 'POST', path: '/mobile-gateway/opencode/session/ses_1/abort', body: undefined, headers: undefined }]);
});

test('remote-1374-c6: permission and question replies post to their exact paths', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  const bridge = fakeBridge();
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  await gateway.replyPermission('perm_1', 'once');
  await gateway.replyQuestion('question_1', [['yes']]);
  expect(bridge.calls[0]).toMatchObject({ path: '/mobile-gateway/opencode/permission/perm_1/reply', body: { reply: 'once' } });
  expect(bridge.calls[1]).toMatchObject({ path: '/mobile-gateway/opencode/question/question_1/reply', body: { answers: [['yes']] } });
});

test('remote-1374-c7: every unsupported operation rejects as remote_unsupported and makes no bridge call', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  const bridge = fakeBridge();
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  for (const op of ['create', 'hardDelete', 'createWorktree', 'updateProfile', 'browseFiles']) {
    await expect((gateway as any)[op]()).rejects.toMatchObject({ code: 'remote_unsupported' });
  }
  expect(bridge.calls).toHaveLength(0);
});

test('remote-1374-c9: pageOlder sends a real request that the electron allowlist accepts, using before= (not cursor=)', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  const bridge = fakeBridge({
    request: async (request: any) => {
      bridge.calls.push(request);
      if (request.path.startsWith('/mobile-gateway/opencode/session/ses_remote_1/message')) {
        return { state: 'ok', status: 200, body: '[]', headers: { 'x-next-cursor': 'msg_older_1' } };
      }
      return { state: 'ok', status: 200, body: '[]' };
    },
  });
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  await gateway.detail('ses_remote_1');
  await gateway.pageOlder('ses_remote_1', 'msg_20');
  const pageOlderRequest = bridge.calls.at(-1);
  expect(pageOlderRequest.path).toBe('/mobile-gateway/opencode/session/ses_remote_1/message?before=msg_20');
  expect(isAllowedRemoteGatewayRequest(pageOlderRequest.method, pageOlderRequest.path)).toBe(true);
});

test('remote-1374-c10: closing a session socket before subscribe() resolves still unsubscribes exactly once', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  let resolveSubscribe!: (value: { state: string; unsubscribe: () => Promise<void> }) => void;
  const pending = new Promise<{ state: string; unsubscribe: () => Promise<void> }>((resolve) => { resolveSubscribe = resolve; });
  let unsubscribeCalls = 0;
  const bridge = fakeBridge({ subscribe: async () => pending });
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  const socket = gateway.connectSession('ses_1', () => {});
  socket.close(); // races ahead of the in-flight subscribe() IPC round-trip
  resolveSubscribe({ state: 'ok', unsubscribe: async () => { unsubscribeCalls += 1; } });
  await new Promise((resolve) => setImmediate(resolve));
  expect(unsubscribeCalls).toBe(1);
  socket.close(); // idempotent: a second close() must not double-invoke unsubscribe
  await new Promise((resolve) => setImmediate(resolve));
  expect(unsubscribeCalls).toBe(1);
});

test('remote-1374-c11: a session\'s known project id is threaded onto later calls for that session, and omitted when unknown', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  const bridge = fakeBridge({
    request: async (request: any) => {
      bridge.calls.push(request);
      if (request.path === '/mobile-gateway/opencode/experimental/session') {
        return { state: 'ok', status: 200, body: JSON.stringify([{ id: 'ses_remote_1', projectId: 'proj_1' }]) };
      }
      return { state: 'ok', status: 200, body: '[]' };
    },
  });
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  await gateway.list();
  await gateway.detail('ses_remote_1');
  await gateway.prompt('ses_remote_1', 'hi');
  const known = bridge.calls.slice(1);
  for (const call of known) expect(call.headers?.['X-Rhythm-Project-ID']).toBe('proj_1');
  await gateway.cancel('ses_unknown');
  expect(bridge.calls.at(-1).headers?.['X-Rhythm-Project-ID']).toBeUndefined();
});

test('remote-1374-c8: connectSession dedupes messages/parts across a reconnect (fold is idempotent)', async () => {
  const module = await loadRemoteSessions();
  if (!module) return;
  let capturedFeed: ((chunk: string) => void) | undefined;
  let capturedEnd: (() => void) | undefined;
  let subscribeCalls = 0;
  const bridge = fakeBridge({
    subscribe: async (_sessionId: string, onChunk: (chunk: string) => void, onEnd?: () => void) => {
      subscribeCalls += 1;
      capturedFeed = onChunk;
      capturedEnd = onEnd;
      return { state: 'ok', unsubscribe: async () => {} };
    },
  });
  const gateway = module.createLiveRemoteSessionsGateway(bridge);
  const snapshots: any[][] = [];
  const socket = gateway.connectSession('ses_1', (messages: any[]) => snapshots.push(messages));
  const frame = (info: any, parts: any[]) =>
    `event: message\ndata: ${JSON.stringify({ type: 'message.updated', info })}\n\n` +
    parts.map((part) => `event: message\ndata: ${JSON.stringify({ type: 'message.part.updated', part })}\n\n`).join('');
  const messageInfo = { id: 'msg_a', role: 'assistant', time: { created: 1 } };
  const partA = { id: 'prt_a', messageID: 'msg_a', type: 'text', text: 'hello' };
  capturedFeed!(frame(messageInfo, [partA]));
  expect(snapshots.at(-1)).toHaveLength(1);
  expect(snapshots.at(-1)![0].blocks).toHaveLength(1);

  // Connection drops; the gateway reconnects on its own (subscribe is called again).
  capturedEnd!();
  await new Promise((resolve) => setImmediate(resolve));
  expect(subscribeCalls).toBe(2);

  // The relay replays the same two events after reconnect. No duplicate message or part appears.
  capturedFeed!(frame(messageInfo, [partA]));
  expect(snapshots.at(-1)).toHaveLength(1);
  expect(snapshots.at(-1)![0].blocks).toHaveLength(1);
  socket.close();
});
