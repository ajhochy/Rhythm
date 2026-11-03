import { act, render } from '@testing-library/react-native';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { shouldKeepSessionSafetyPoll } from '@/providers/opencode-provider-selectors';
import { mapMobileCoordinatorHistory } from '@/providers/services/coordinator-history-transcript';
import { parseMobileCoordinatorHistoryResult } from '@/providers/services/coordinator-conversations-service';

import { CoordinatorConversationProvider, useCoordinatorConversation } from '@/providers/coordinator-conversation-provider';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

let mockPairedClient = {};
let mockOpencode: Record<string, unknown> = {};
let mockGateway: Record<string, unknown> = {};
const mockListeners = new Set<(event: { projectId: string; sessionId: string }) => void>();
const mockReadListeners = new Set<(read: { projectId: string }) => void>();
const mockChangeListeners = new Set<(change: Record<string, unknown>) => void>();

jest.mock('@/providers/opencode-provider', () => ({ useOpencode: () => mockOpencode }));
jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({ host: { hostId: 'mac-1' }, client: mockPairedClient }),
}));
jest.mock('@/providers/rhythm-account-provider', () => ({ useRhythmAccount: () => ({ user: { id: 7 } }) }));
jest.mock('@/providers/services/coordinator-conversations-service', () => ({
  ...jest.requireActual('@/providers/services/coordinator-conversations-service'),
  createPairedCoordinatorConversationGateway: () => mockGateway,
}));

const PROJECT = 'project-a';
const ROOT = 'local-root-a';
const project = { id: PROJECT, path: PROJECT, label: 'A', source: 'server' as const };

function conversation() {
  return {
    schemaVersion: 3, id: 'conversation-a', sessionId: ROOT, projectId: PROJECT, controlRevision: 1,
    goals: [], primaryOwnerRoot: true, ownerUserId: 7, commandDedupe: [], continuations: [],
  };
}

function row(id: number) {
  return {
    id, sessionId: ROOT, role: 'output', rawText: `reply ${id}`, strippedText: `reply ${id}`,
    createdAt: '2026-10-05T00:00:00.000Z', sdkMessageId: null, parts: [], tokens: null, cost: null,
  };
}

let historyRows = [1];
const calls = { open: 0, status: 0, history: 0, message: 0 };

function installGateway() {
  historyRows = [1];
  Object.assign(calls, { open: 0, status: 0, history: 0, message: 0 });
  mockGateway = {
    resolve: async () => ({ kind: 'resolved', created: false, conversation: conversation(), sessionId: ROOT, projectId: PROJECT }),
    open: async () => { calls.open += 1; return { kind: 'replay', conversation: conversation() }; },
    status: async () => { calls.status += 1; return { kind: 'status', conversation: conversation(), context: {} }; },
    history: async () => {
      calls.history += 1;
      return { kind: 'history', conversation: conversation(), messages: historyRows.map(row), nextCursor: null, hasMore: false };
    },
    message: async () => { calls.message += 1; return { kind: 'status', conversation: conversation(), context: {} }; },
  };
}

function baseOpencode(overrides: Record<string, unknown> = {}) {
  return {
    activeProject: project,
    activeProjectPath: PROJECT,
    activeSession: undefined,
    coordinatorSessionProvenance: undefined,
    currentSessionId: undefined,
    openProjectSessionState: { kind: 'idle' },
    openProjectSession: jest.fn(async () => undefined),
    refreshWorkspaceCatalog: jest.fn(async () => undefined),
    registeredGatewayProjectIds: new Set([PROJECT]),
    selectProject: jest.fn(),
    sessions: [],
    subscribeSessionActivity: (listener: (event: { projectId: string; sessionId: string }) => void) => {
      mockListeners.add(listener);
      return () => mockListeners.delete(listener);
    },
    subscribeProjectReads: (listener: (read: { projectId: string }) => void) => {
      mockReadListeners.add(listener);
      return () => mockReadListeners.delete(listener);
    },
    subscribeCoordinatorChanges: (listener: (change: Record<string, unknown>) => void) => {
      mockChangeListeners.add(listener);
      return () => mockChangeListeners.delete(listener);
    },
    ...overrides,
  };
}

const catalogRoot = { id: 'sdk-root', projectId: PROJECT, rhythm: { localSessionId: ROOT } };
const ordinary = { id: 'sdk-ordinary', projectId: PROJECT };

function catalogOpencode() {
  return baseOpencode({
    activeSession: catalogRoot,
    currentSessionId: 'sdk-root',
    sessions: [catalogRoot, ordinary],
    coordinatorSessionProvenance: {
      actorKey: 'user:7:host:mac-1', localSessionId: ROOT, pairedClient: mockPairedClient,
      projectId: PROJECT, uiSessionId: 'sdk-root',
    },
  });
}

let ctx!: ReturnType<typeof useCoordinatorConversation>;
function Probe() {
  ctx = useCoordinatorConversation();
  return null;
}
const tree = () => createElement(CoordinatorConversationProvider, null, createElement(Probe));

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

async function emit(sessionId: string, projectId = PROJECT) {
  await act(async () => { mockListeners.forEach((listener) => listener({ projectId, sessionId })); });
  await settle();
}

const historyIds = () => ctx.state.canonicalHistory?.messages.map((message) => message.id);

async function openCatalog() {
  mockOpencode = catalogOpencode();
  const screen = render(tree());
  await act(async () => { await ctx.open(); });
  await settle();
  expect(historyIds()).toEqual([1]);
  return screen;
}

async function openInert() {
  mockOpencode = baseOpencode({ currentSessionId: 'sdk-ordinary', activeSession: ordinary, sessions: [ordinary] });
  const screen = render(tree());
  await act(async () => { await ctx.resolvePrimary(); });
  await settle();
  expect(ctx.binding?.source).toBe('server_primary');
  expect(historyIds()).toEqual([1]);
  return screen;
}

beforeEach(() => {
  mockListeners.clear();
  mockReadListeners.clear();
  mockChangeListeners.clear();
  mockPairedClient = {};
  installGateway();
});


// Sol-owned verification only. Controlled promises deliberately ignore abort so
// the actual controller must discard late results rather than trust transport.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const status = () => ({ kind: 'status', conversation: conversation(), context: {} });
const history = (ids: number[]) => ({ kind: 'history', conversation: conversation(), messages: ids.map(row), nextCursor: null, hasMore: false });
async function signalRoot() {
  await act(async () => { mockListeners.forEach((listener) => listener({ projectId: PROJECT, sessionId: 'sdk-root' })); });
}

describe('Sol independent frozen mobile follow-through verification', () => {
  test('deferred burst coalesces, reads canonical rows, and never invokes a write', async () => {
    await openCatalog();
    const first = deferred<ReturnType<typeof status>>();
    const trailing = deferred<ReturnType<typeof status>>();
    const read = jest.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => trailing.promise);
    mockGateway.status = read;
    const beforeHistory = calls.history;
    for (let i = 0; i < 5; i += 1) await signalRoot();
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(status()));
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(calls.history).toBe(beforeHistory);
    historyRows = [1, 2];
    await act(async () => trailing.resolve(status()));
    await settle();
    expect(calls.history).toBe(beforeHistory + 1);
    expect(historyIds()).toEqual([1, 2]);
    expect(calls.message).toBe(0);
    expect(ctx.state.phase).toBe('ready');
    expect(ctx.state.pendingCommand).toBeUndefined();
  });

  test('late status after teardown neither reads history nor retains a subscriber', async () => {
    const screen = await openCatalog();
    const wait = deferred<ReturnType<typeof status>>();
    mockGateway.status = () => wait.promise;
    await signalRoot();
    const beforeHistory = calls.history;
    screen.unmount();
    expect(mockListeners.size).toBe(0);
    await act(async () => wait.resolve(status()));
    await settle();
    expect(calls.history).toBe(beforeHistory);
  });

  test.each(['project', 'root', 'client'] as const)('late status after %s qualification loss cannot publish or read history', async (kind) => {
    const screen = await openCatalog();
    const wait = deferred<ReturnType<typeof status>>();
    mockGateway.status = () => wait.promise;
    await signalRoot();
    const beforeHistory = calls.history;
    if (kind === 'project') mockOpencode = { ...mockOpencode, activeProjectPath: 'project-b' };
    if (kind === 'root') mockOpencode = { ...mockOpencode, currentSessionId: 'sdk-ordinary', activeSession: ordinary };
    if (kind === 'client') mockPairedClient = {}; // Old catalog provenance deliberately retained.
    screen.rerender(tree());
    await settle();
    await act(async () => wait.resolve(status()));
    await settle();
    expect(ctx.state.enabled).toBe(false);
    expect(calls.history).toBe(beforeHistory);
  });

  test('late old-client canonical history cannot install after same-root qualified client replacement', async () => {
    const screen = await openCatalog();
    const oldHistory = deferred<ReturnType<typeof history>>();
    const readOld = jest.fn(() => oldHistory.promise);
    mockGateway.history = readOld;
    await signalRoot();
    await settle();
    expect(readOld).toHaveBeenCalledTimes(1);
    const newOpen = deferred<unknown>();
    mockGateway = { ...mockGateway, open: () => newOpen.promise, history: async () => history([1, 2]) };
    mockPairedClient = {};
    mockOpencode = catalogOpencode(); // New exact client-qualified observation, same actor/project/root.
    screen.rerender(tree());
    await settle();
    await act(async () => oldHistory.resolve(history([1, 99])));
    await settle();
    expect(historyIds()).not.toContain(99);
  });

  test('terminal event during finite planning admission must leave one trailing read after the operation settles', async () => {
    mockOpencode = catalogOpencode();
    const goal = { id: 'goal-a', commandKey: 'goal-command-a', objective: 'Finite plan', state: 'captured', linkedWorkstreamId: null, revision: 1 };
    const withGoal = { ...conversation(), goals: [goal] };
    mockGateway.open = async () => ({ kind: 'replay', conversation: withGoal });
    mockGateway.status = async () => ({ ...status(), conversation: withGoal });
    const admission = deferred<unknown>();
    const prepare = jest.fn(() => admission.promise);
    mockGateway.preparePlan = prepare;
    render(tree());
    await act(async () => { await ctx.open(); });
    await settle();
    let request!: Promise<boolean>;
    await act(async () => {
      request = ctx.preparePlan('goal-a', { totalTokenAuthorization: 20000, maxTurns: 2, maxWallTimeSeconds: 120, expiresInSeconds: 300, purpose: 'decompose', acknowledgesSoftTotalTokenAuthorization: true });
    });
    await settle();
    expect(prepare).toHaveBeenCalledTimes(1);
    historyRows = [1, 2];
    await signalRoot();
    await act(async () => {
      admission.resolve({ kind: 'planned', conversation: withGoal, workstream: { workstream: { id: 'workstream-a', state: 'queued' }, readiness: { available: true }, jobs: [], budget: { actualTokens: 0, authorizedTokens: 20000, holdReason: null } } });
      await request;
    });
    await settle();
    expect(calls.message).toBe(0);
    expect(historyIds()).toEqual([1, 2]);
  });

  test('an inert primary without a catalog row ignores local/unknown SDK events but reads on the typed canonical notification', async () => {
    await openInert();
    historyRows = [1, 2];
    await emit(ROOT);
    await emit('sdk-unknown');
    expect(historyIds()).toEqual([1]); // SDK-shaped events stay negative.
    // Actual production qualifier, then the production fan-out gate (client currency) mirrored.
    const source = readFileSync(resolve(__dirname, '../providers/opencode-provider.tsx'), 'utf8');
    const ast = ts.createSourceFile('provider.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const names = ['parseCoordinatorChangedEvent', 'coordinatorChangedFromEnvelope'];
    const text = names.map((name) => {
      const node = ast.statements.find((value) => ts.isFunctionDeclaration(value) && value.name?.text === name);
      if (!node) throw new Error(`Actual ${name} missing`);
      return node.getText(ast);
    }).join('\n');
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const { coordinatorChangedFromEnvelope } = new Function(js + '; return { coordinatorChangedFromEnvelope };')();
    const payload = { type: 'rhythm.coordinator.changed', id: 'n-1', properties: { projectId: PROJECT, conversationId: 'conversation-a', localSessionId: ROOT } };
    const change = coordinatorChangedFromEnvelope({ directory: PROJECT, payload }, PROJECT, true);
    expect(change).toBeDefined();
    await act(async () => { mockChangeListeners.forEach((listener) => listener({ ...change, pairedClient: mockPairedClient })); });
    await settle();
    expect(historyIds()).toEqual([1, 2]);
    expect(calls.message).toBe(0);
  });

  test('real history parser accepts bound rows and refuses wrong project/root or mixed transcripts', () => {
    const scope = { sessionId: ROOT, projectId: PROJECT };
    expect(parseMobileCoordinatorHistoryResult(history([1, 2]), scope, 200)).toBeDefined();
    expect(parseMobileCoordinatorHistoryResult({ ...history([1]), conversation: { ...conversation(), projectId: 'project-b' } }, scope, 200)).toBeUndefined();
    expect(parseMobileCoordinatorHistoryResult({ ...history([1]), conversation: { ...conversation(), sessionId: 'local-other' } }, scope, 200)).toBeUndefined();
    expect(parseMobileCoordinatorHistoryResult({ ...history([1]), messages: [row(1), { ...row(2), sessionId: 'local-other' }] }, scope, 200)).toBeUndefined();
  });

  test('actual event decoder uses SDK IDs only for its five supported activity shapes', () => {
    const source = readFileSync(resolve(__dirname, '../providers/opencode-provider.tsx'), 'utf8');
    const ast = ts.createSourceFile('provider.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const node = ast.statements.find((value) => ts.isFunctionDeclaration(value) && value.name?.text === 'sessionActivityEventSessionId');
    if (!node) throw new Error('Actual event decoder missing');
    const js = ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const decode = new Function(js + '; return sessionActivityEventSessionId;')();
    for (const type of ['session.status', 'session.idle', 'session.error']) expect(decode({ type, properties: { sessionID: 'sdk-root' } })).toBe('sdk-root');
    expect(decode({ type: 'message.updated', properties: { info: { sessionID: 'sdk-root' } } })).toBe('sdk-root');
    expect(decode({ type: 'session.updated', properties: { info: { id: 'sdk-root' } } })).toBe('sdk-root');
    expect(decode({ type: 'session.created', properties: { info: { id: 'sdk-root' } } })).toBeUndefined();
    expect(decode({ type: 'permission.asked', properties: { sessionID: 'sdk-root' } })).toBeUndefined();
  });

  test('actual existing SSE-down safety callback must refresh the enabled canonical coordinator view', async () => {
    await openCatalog();
    historyRows = [1, 2];
    const source = readFileSync(resolve(__dirname, '../providers/opencode-provider.tsx'), 'utf8');
    const ast = ts.createSourceFile('provider.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer: ts.Node | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' && node.arguments[0]?.getText(ast).includes('const shouldKeepSafetyPoll =')) initializer = node.arguments[0];
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (!initializer) throw new Error('Actual safety effect missing');
    const js = ts.transpileModule('const effect = ' + initializer.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    let tick: (() => void) | undefined;
    const sdkReads = jest.fn(async () => undefined);
    // Mirrors only the production currency gate; the fallback callback itself is the real source.
    const notifyProjectReadCompleted = (projectId: string, readClient: object) => {
      if (readClient === mockPairedClient) mockReadListeners.forEach((listener) => listener({ projectId }));
    };
    const names = ['client', 'notifyProjectReadCompleted', 'connection','activeProjectPath', 'sessionStatuses', 'conversationPhase', 'eventStreamStatus', 'sendingState', 'shouldKeepSessionSafetyPoll', 'setInterval', 'clearInterval', 'settleBackgroundRead', 'refreshSessions', 'refreshPendingInteractions', 'currentSessionId', 'refreshMessages', 'refreshSessionDiff', 'refreshSessionTodos', 'conversationSessionId'];
    const values = [mockPairedClient, notifyProjectReadCompleted, { status: 'connected' },PROJECT, {}, 'off', 'error', { active: false }, shouldKeepSessionSafetyPoll, (callback: () => void) => { tick = callback; return 1; }, () => undefined, (read: () => unknown) => read(), sdkReads, sdkReads, 'sdk-root', sdkReads, sdkReads, sdkReads, undefined];
    const effect = new Function(...names, js + '; return effect;')(...values);
    const cleanup = effect();
    if (!tick) throw new Error('Actual SSE-down fallback did not arm');
    await act(async () => tick?.());
    await settle();
    cleanup();
    expect(sdkReads).toHaveBeenCalled(); // Existing fallback runs; canonical provider never receives invalidation.
    expect(historyIds()).toEqual([1, 2]);
  });

  test('actual ChatView transcript projection never mixes the ordinary origin or different SDK/local root IDs', () => {
    const source = readFileSync(resolve(__dirname, '../components/chat/chat-view.tsx'), 'utf8');
    const ast = ts.createSourceFile('view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer: ts.Node | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useMemo' && node.arguments[0]?.getText(ast).includes('mapMobileCoordinatorHistory(history.messages)')) initializer = node.arguments[0];
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (!initializer) throw new Error('Actual transcript projection missing');
    const js = ts.transpileModule('const project = ' + initializer.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const ordinaryRow = { id: 'ordinary-private-row', createdAt: 0, details: [] };
    const projectTranscript = (uiId: string, projectId: string, enabled = true) => new Function('currentTranscript', 'isTranscriptDisplayMessage', 'coordinator', 'mapMobileCoordinatorHistory', 'currentSessionId', 'activeProjectPath', js + '; return project();')([ordinaryRow], () => true, { state: { enabled, canonicalHistory: history([1]) } }, mapMobileCoordinatorHistory, uiId, projectId);
    expect(projectTranscript('sdk-ordinary', PROJECT).some((entry: { id: string }) => entry.id === ordinaryRow.id)).toBe(false);
    expect(projectTranscript('sdk-root', PROJECT).some((entry: { id: string }) => entry.id === ordinaryRow.id)).toBe(false);
    expect(projectTranscript(ROOT, 'project-b').some((entry: { id: string }) => entry.id === ordinaryRow.id)).toBe(false);
    expect(projectTranscript('sdk-ordinary', PROJECT, false)).toEqual([ordinaryRow]);
  });

});
