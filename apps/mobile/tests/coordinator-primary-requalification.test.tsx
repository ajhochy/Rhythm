import { act, render } from '@testing-library/react-native';
import { createElement } from 'react';
import { CoordinatorConversationProvider, useCoordinatorConversation } from '@/providers/coordinator-conversation-provider';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));

let mockPath = '/agents/chat';
let mockAccount: any;
let mockPaired: any;
let mockOpencode: any;
const mockGateways = new Map<object, any>();
jest.mock('expo-router', () => ({ usePathname: () => mockPath }));
jest.mock('@/providers/opencode-provider', () => ({ useOpencode: () => mockOpencode }));
jest.mock('@/providers/paired-host-provider', () => ({ usePairedHost: () => mockPaired }));
jest.mock('@/providers/rhythm-account-provider', () => ({ useRhythmAccount: () => mockAccount }));
jest.mock('@/providers/coordinator-conversation-journal', () => ({
  ...jest.requireActual('@/providers/coordinator-conversation-journal'),
  createMobileCoordinatorJournal: () => jest.requireActual('@/providers/coordinator-conversation-journal').createMemoryMobileCoordinatorJournal(),
}));
jest.mock('@/providers/services/coordinator-conversations-service', () => ({
  ...jest.requireActual('@/providers/services/coordinator-conversations-service'),
  createPairedCoordinatorConversationGateway: (client: object) => mockGateways.get(client),
}));
const PROJECT = 'project-a';
const ROOT = 'local-root-a';
function conversation(revision = 1) {
  return { schemaVersion: 3, id: 'conversation-a', sessionId: ROOT, projectId: PROJECT,
    controlRevision: revision, goals: [], primaryOwnerRoot: true, ownerUserId: 7, commandDedupe: [], continuations: [] };
}
function resolved(revision = 1) {
  return { kind: 'resolved', created: false, conversation: conversation(revision), sessionId: ROOT, projectId: PROJECT };
}
function gateway(revision = 1) {
  return {
    resolve: jest.fn(async (_scope?: { projectId?: string }) => resolved(revision)),
    open: jest.fn(async () => ({ kind: 'replay', conversation: conversation(revision) })),
    status: jest.fn(async () => ({ kind: 'status', conversation: conversation(revision), context: {} })),
    history: jest.fn(async () => ({ kind: 'history', conversation: conversation(revision), messages: [{
      id: revision, sessionId: ROOT, role: 'output', rawText: 'canonical ' + revision, strippedText: 'canonical ' + revision,
      createdAt: '2026-10-06T06:00:00.000Z', sdkMessageId: null, parts: [], tokens: null, cost: null,
    }], nextCursor: null, hasMore: false })),
    setup: jest.fn(), message: jest.fn(), goals: jest.fn(), preparePlan: jest.fn(), continuePlan: jest.fn(),
  };
}
function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { release = resolve; });
  return { promise, release };
}
let ctx!: ReturnType<typeof useCoordinatorConversation>;
function Probe() { ctx = useCoordinatorConversation(); return null; }
const tree = () => createElement(CoordinatorConversationProvider, null, createElement(Probe));
async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
function noWrites(g: ReturnType<typeof gateway>) {
  for (const operation of ['setup', 'message', 'goals', 'preparePlan', 'continuePlan'] as const) expect(g[operation]).not.toHaveBeenCalled();
  expect(mockOpencode.openProjectSession).not.toHaveBeenCalled();
  expect(mockOpencode.selectProject).not.toHaveBeenCalled();
}
beforeEach(() => {
  mockPath = '/agents/chat'; mockGateways.clear(); mockAccount = { user: { id: 7 } };
  mockPaired = { state: 'connected', host: { rhythmUserId: 7, hostId: 'mac-1', deviceId: 'device-1' }, client: {} };
  const ordinary = { id: 'sdk-ordinary', projectId: PROJECT, title: 'Ordinary chat' };
  mockOpencode = {
    activeProject: { id: PROJECT, path: PROJECT, label: 'A', source: 'server' }, activeProjectPath: PROJECT,
    activeSession: ordinary, currentSessionId: ordinary.id, sessions: [ordinary],
    connection: { status: 'connected' }, isHydrated: true, openProjectSessionState: { kind: 'idle' },
    registeredGatewayProjectIds: new Set([PROJECT]), coordinatorSessionProvenance: undefined,
    openProjectSession: jest.fn(), selectProject: jest.fn(), refreshWorkspaceCatalog: jest.fn(async () => undefined),
    subscribeCoordinatorChanges: () => () => undefined, subscribeProjectReads: () => () => undefined,
    subscribeSessionActivity: () => () => undefined,
  };
  mockGateways.set(mockPaired.client, gateway());
});
async function openPrimary() {
  const A = mockGateways.get(mockPaired.client) as ReturnType<typeof gateway>;
  const screen = render(tree());
  await act(async () => { await ctx.resolvePrimary(); }); await settle();
  expect(ctx.binding?.source).toBe('server_primary'); expect(ctx.state.enabled).toBe(true);
  expect(ctx.state.canonicalHistory?.messages.map((m) => m.id)).toEqual([1]);
  return { screen, A };
}
function installB() {
  const B = gateway(2); mockPaired = { ...mockPaired, client: {} }; mockGateways.set(mockPaired.client, B); return B;
}

test('connected-to-connected A→B restores exact primary through fresh B reads, no root creation or prompt', async () => {
  const { screen, A } = await openPrimary(); const B = installB();
  screen.rerender(tree()); await settle();
  expect(B.resolve).toHaveBeenCalledTimes(1); expect(B.resolve.mock.calls[0][0]).toEqual({ projectId: PROJECT });
  expect(ctx.binding?.sessionId).toBe(ROOT); expect(ctx.state.conversation?.controlRevision).toBe(2);
  expect(ctx.state.canonicalHistory?.messages.map((m) => m.id)).toEqual([2]);
  expect(mockOpencode.refreshWorkspaceCatalog).toHaveBeenCalledTimes(2); noWrites(A); noWrites(B);
});

test('Back to Agents with unchanged project/session permanently revokes intent before later client replacement', async () => {
  const { screen } = await openPrimary(); mockPath = '/agents'; screen.rerender(tree()); await settle();
  const B = installB(); screen.rerender(tree()); await settle();
  mockPath = '/agents/chat'; screen.rerender(tree()); await settle();
  expect(B.resolve).not.toHaveBeenCalled(); expect(B.open).not.toHaveBeenCalled(); expect(ctx.binding).toBeUndefined(); noWrites(B);
});

test('old A status completion cannot publish after B canonical history is accepted', async () => {
  const { screen, A } = await openPrimary(); const late = deferred<any>(); A.status.mockImplementation(() => late.promise);
  let old!: Promise<boolean>; await act(async () => { old = ctx.refresh(); }); await settle();
  const B = installB(); screen.rerender(tree()); await settle();
  await act(async () => { late.release({ kind: 'status', conversation: conversation(999), context: {} }); await old; }); await settle();
  expect(ctx.state.conversation?.controlRevision).toBe(2); expect(ctx.state.canonicalHistory?.messages.map((m) => m.id)).toEqual([2]); noWrites(B);
});

test.each(['return-normal', 'route-exit-and-return', 'different-session', 'different-project'])('%s while B resolve is pending prevents any late primary acceptance', async (action) => {
  const { screen } = await openPrimary(); const B = installB(); const held = deferred<any>(); B.resolve.mockImplementation(() => held.promise);
  screen.rerender(tree()); await settle(); expect(B.resolve).toHaveBeenCalledTimes(1); expect(ctx.binding).toBeUndefined();
  if (action === 'return-normal') act(() => ctx.returnToNormal());
  if (action === 'route-exit-and-return') { mockPath = '/agents'; screen.rerender(tree()); await settle(); mockPath = '/agents/chat'; screen.rerender(tree()); }
  if (action === 'different-session') { mockOpencode = { ...mockOpencode, currentSessionId: 'sdk-other' }; screen.rerender(tree()); }
  if (action === 'different-project') { mockOpencode = { ...mockOpencode, activeProjectPath: 'project-other' }; screen.rerender(tree()); }
  await act(async () => { held.release(resolved(2)); }); await settle();
  expect(ctx.binding).toBeUndefined(); expect(ctx.state.enabled).toBe(false); expect(B.open).not.toHaveBeenCalled(); noWrites(B);
});

test.each(['account', 'host', 'device'])('%s mismatch on B does not restore the old primary', async (field) => {
  const { screen } = await openPrimary(); const B = installB();
  if (field === 'account') mockAccount = { user: { id: 8 } };
  if (field === 'host') mockPaired.host = { ...mockPaired.host, hostId: 'mac-2' };
  if (field === 'device') mockPaired.host = { ...mockPaired.host, deviceId: 'device-2' };
  screen.rerender(tree()); await settle(); expect(B.resolve).not.toHaveBeenCalled(); expect(ctx.binding).toBeUndefined(); noWrites(B);
});

test.each(['different-root', 'missing-root', 'resolve-error'])('%s from B stays unavailable without automatic retry', async (failure) => {
  const { screen } = await openPrimary(); const B = installB();
  B.resolve.mockImplementation(async () => {
    if (failure === 'resolve-error') throw new Error('unavailable');
    if (failure === 'missing-root') return { kind: 'unavailable' } as any;
    return { ...resolved(2), sessionId: 'different-root', conversation: { ...conversation(2), sessionId: 'different-root' } };
  });
  screen.rerender(tree()); await settle(); screen.rerender(tree()); await settle();
  expect(B.resolve).toHaveBeenCalledTimes(1); expect(B.open).not.toHaveBeenCalled(); expect(ctx.binding).toBeUndefined(); noWrites(B);
});

test('temporary project/session absence on the same chat route never grants a binding and waits for fresh exact scope', async () => {
  const { screen } = await openPrimary(); const B = installB(); const scoped = mockOpencode;
  mockOpencode = { ...scoped, activeProjectPath: undefined, activeProject: undefined, currentSessionId: undefined,
    registeredGatewayProjectIds: new Set(), connection: { status: 'connecting' } };
  screen.rerender(tree()); await settle(); expect(ctx.binding).toBeUndefined(); expect(B.resolve).not.toHaveBeenCalled();
  mockOpencode = scoped; screen.rerender(tree()); await settle();
  expect(B.resolve).toHaveBeenCalledTimes(1); expect(ctx.state.canonicalHistory?.messages.map((m) => m.id)).toEqual([2]); noWrites(B);
});
