import { act, render } from '@testing-library/react-native';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { AppState } from 'react-native';

import { MobileCoordinatorConversationController } from '@/providers/coordinator-conversation-controller';
import { createMemoryMobileCoordinatorJournal } from '@/providers/coordinator-conversation-journal';
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
type CoordinatorChange = { projectId: string; conversationId: string; localSessionId: string; pairedClient: object };
const mockChangeListeners = new Set<(change: CoordinatorChange) => void>();

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
    subscribeCoordinatorChanges: (listener: (change: CoordinatorChange) => void) => {
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

describe('delayed canonical coordinator result without prompt or Refresh', () => {
  test('SDK-backed primary: a later event for the exact root reads the terminal result', async () => {
    await openCatalog();
    historyRows = [1, 2];
    await emit('sdk-root');
    expect(historyIds()).toEqual([1, 2]);
    expect(calls.message).toBe(0);
    expect(calls.open).toBe(1);
  });

  test('SDK-backed primary: unrelated session, other project and normal mode never fetch', async () => {
    await openCatalog();
    const before = { ...calls };
    historyRows = [1, 2];
    await emit('sdk-ordinary');
    await emit('sdk-root', 'project-other');
    expect(calls).toEqual(before);
    expect(historyIds()).toEqual([1]);

    act(() => ctx.returnToNormal());
    await settle();
    await emit('sdk-root');
    expect(calls).toEqual(before);
  });

  test('server-primary pointer: only the exact local root row qualifies and no ordinary transcript is read', async () => {
    const screen = await openInert();
    const before = { ...calls };
    historyRows = [1, 2];
    // Known ordinary session and an unknown session are not this root.
    await emit('sdk-ordinary');
    await emit('sdk-unknown');
    expect(calls).toEqual(before);
    expect(historyIds()).toEqual([1]);

    // The paired catalog later exposes the root row; its own event qualifies.
    mockOpencode = { ...(mockOpencode as object), sessions: [ordinary, catalogRoot] };
    screen.rerender(tree());
    await emit('sdk-root');
    expect(historyIds()).toEqual([1, 2]);
    expect(ctx.binding?.source).toBe('server_primary');
    expect(calls.message).toBe(0);
  });

  test('foreground return revalidates an open view but not normal mode', async () => {
    const handlers: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
      handlers.push(handler);
      return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
    }) as never);
    await openInert();
    historyRows = [1, 2];
    await act(async () => { handlers.forEach((handler) => handler('active')); });
    await settle();
    expect(historyIds()).toEqual([1, 2]);

    const before = { ...calls };
    act(() => ctx.returnToNormal());
    await settle();
    await act(async () => { handlers.forEach((handler) => handler('active')); });
    await settle();
    expect(calls).toEqual(before);
    jest.restoreAllMocks();
  });

  test('a burst of qualified events coalesces and never sends a command', async () => {
    await openCatalog();
    historyRows = [1, 2];
    await act(async () => {
      for (let i = 0; i < 5; i += 1) mockListeners.forEach((listener) => listener({ projectId: PROJECT, sessionId: 'sdk-root' }));
    });
    await settle();
    expect(historyIds()).toEqual([1, 2]);
    // One in-flight read plus at most one trailing read.
    expect(calls.history).toBeLessThanOrEqual(3);
    expect(calls.message).toBe(0);
  });
});

describe('client replacement and scoped-operation fences (abort-ignoring transport)', () => {
  const goal = { id: 'goal-a', commandKey: 'goal-command-a', objective: 'Finite plan', state: 'captured', linkedWorkstreamId: null, revision: 1 };
  const consent = {
    totalTokenAuthorization: 20000, maxTurns: 2 as const, maxWallTimeSeconds: 120, expiresInSeconds: 300,
    purpose: 'decompose' as const, acknowledgesSoftTotalTokenAuthorization: true as const,
  };

  async function openWithGoal() {
    mockOpencode = catalogOpencode();
    const withGoal = { ...conversation(), goals: [goal] };
    mockGateway.open = async () => ({ kind: 'replay', conversation: withGoal });
    mockGateway.status = async () => { calls.status += 1; return { kind: 'status', conversation: withGoal, context: {} }; };
    const admission = (() => {
      let resolve!: (value: unknown) => void;
      const promise = new Promise((done) => { resolve = done; });
      return { promise, resolve };
    })();
    mockGateway.preparePlan = jest.fn(() => admission.promise);
    render(tree());
    await act(async () => { await ctx.open(); });
    await settle();
    let request!: Promise<boolean>;
    await act(async () => { request = ctx.preparePlan('goal-a', consent); });
    await settle();
    return { admission, request, withGoal };
  }

  test('late old-client status cannot install after same-root client replacement', async () => {
    // Controller level: the window before any new open() has started, where
    // only the client-generation fence can reject the stale response.
    const scope = { actorKey: 'user:7:host:mac-1', projectId: PROJECT, sessionId: ROOT, uiSessionId: 'sdk-root' };
    let resolveOld!: (value: unknown) => void;
    let armed = false;
    const reads = { history: 0 };
    const controller = new MobileCoordinatorConversationController(() => ({
      open: async () => ({ kind: 'replay', conversation: conversation() }),
      status: () => armed
        ? new Promise((done) => { resolveOld = done; })
        : Promise.resolve({ kind: 'status', conversation: conversation(), context: {} }),
      history: async () => { reads.history += 1; return { kind: 'history', conversation: conversation(), messages: [], nextCursor: null, hasMore: false }; },
      message: async () => { calls.message += 1; return { kind: 'status', conversation: conversation(), context: {} }; },
    }) as never, createMemoryMobileCoordinatorJournal());
    const oldClient = {};
    controller.activate(scope, oldClient);
    await controller.open(scope);
    await settle();
    armed = true;
    controller.activate(scope, oldClient);
    const pendingRead = controller.revalidate(scope);
    // New client object, same actor/project/root/UI scope; nothing reopened yet.
    controller.activate(scope, {});
    const historyBefore = reads.history;
    resolveOld({ kind: 'status', conversation: { ...conversation(), controlRevision: 9 }, context: {} });
    expect(await pendingRead).toBe(false);
    await settle();
    expect(controller.get(scope).conversation?.controlRevision).toBe(1);
    expect(reads.history).toBe(historyBefore);
    expect(calls.message).toBe(0);
    expect(controller.get(scope).enabled).toBe(true);
  });

  test('normal-mode exit during finite admission drops the trailing read', async () => {
    const { admission, request, withGoal } = await openWithGoal();
    const beforeStatus = calls.status;
    const beforeHistory = calls.history;
    await act(async () => { mockListeners.forEach((listener) => listener({ projectId: PROJECT, sessionId: 'sdk-root' })); });
    act(() => ctx.returnToNormal());
    await act(async () => {
      admission.resolve({ kind: 'planned', conversation: withGoal, workstream: { workstream: { id: 'w', state: 'queued' }, readiness: { available: true }, jobs: [], budget: { actualTokens: 0, authorizedTokens: 20000, holdReason: null } } });
      await request;
    });
    await settle();
    expect(calls.status).toBe(beforeStatus);
    expect(calls.history).toBe(beforeHistory);
    expect(calls.message).toBe(0);
  });

  test('several events during one operation queue exactly one trailing read', async () => {
    const { admission, request, withGoal } = await openWithGoal();
    const beforeStatus = calls.status;
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { mockListeners.forEach((listener) => listener({ projectId: PROJECT, sessionId: 'sdk-root' })); });
    }
    expect(calls.status).toBe(beforeStatus);
    await act(async () => {
      admission.resolve({ kind: 'planned', conversation: withGoal, workstream: { workstream: { id: 'w', state: 'queued' }, readiness: { available: true }, jobs: [], budget: { actualTokens: 0, authorizedTokens: 20000, holdReason: null } } });
      await request;
    });
    await settle();
    expect(calls.status).toBe(beforeStatus + 1);
    expect(calls.message).toBe(0);
  });
});

async function signalProjectRead(projectId = PROJECT) {
  await act(async () => { mockReadListeners.forEach((listener) => listener({ projectId })); });
  await settle();
}

describe('SSE-down project-read invalidation (identity-free, read-only)', () => {
  test('a completed project read revalidates an enabled inert view; wrong project, normal mode and unmount do not', async () => {
    const screen = await openInert();
    historyRows = [1, 2];
    await signalProjectRead('project-other');
    expect(historyIds()).toEqual([1]);
    await signalProjectRead();
    expect(historyIds()).toEqual([1, 2]);
    expect(calls.message).toBe(0);
    expect(ctx.binding?.source).toBe('server_primary');

    const before = { ...calls };
    act(() => ctx.returnToNormal());
    await settle();
    await signalProjectRead();
    expect(calls).toEqual(before);
    screen.unmount();
    expect(mockReadListeners.size).toBe(0);
  });

  function fallbackEffect() {
    const file = resolve(process.cwd(), 'providers/opencode-provider.tsx');
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer: ts.Node | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' &&
        node.arguments[0]?.getText(ast).includes('const shouldKeepSafetyPoll =')) initializer = node.arguments[0];
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (!initializer) throw new Error('Actual safety effect missing');
    return ts.transpileModule('const effect = ' + initializer.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  }

  // Runs the ACTUAL production fallback callback; only its dependencies are supplied.
  async function runFallback(refreshSessions: () => Promise<unknown>, afterTick?: (cleanup: () => void) => void) {
    const { shouldKeepSessionSafetyPoll } = jest.requireActual('@/providers/opencode-provider-selectors');
    const notified: [string, unknown][] = [];
    let tick: (() => void) | undefined;
    const noop = async () => undefined;
    const names = ['client', 'notifyProjectReadCompleted', 'connection', 'activeProjectPath', 'sessionStatuses', 'conversationPhase', 'eventStreamStatus', 'sendingState', 'shouldKeepSessionSafetyPoll', 'setInterval', 'clearInterval', 'settleBackgroundRead', 'refreshSessions', 'refreshPendingInteractions', 'currentSessionId', 'refreshMessages', 'refreshSessionDiff', 'refreshSessionTodos', 'conversationSessionId'];
    const client = {};
    const values = [client, (projectId: string, readClient: unknown) => notified.push([projectId, readClient]), { status: 'connected' }, PROJECT, {}, 'off', 'error', { active: false }, shouldKeepSessionSafetyPoll, (callback: () => void) => { tick = callback; return 1; }, () => undefined, (read: () => Promise<unknown>) => { void read().catch(() => undefined); }, refreshSessions, noop, undefined, noop, noop, noop, undefined];
    const cleanup = new Function(...names, fallbackEffect() + '; return effect;')(...values)();
    tick?.();
    afterTick?.(cleanup);
    await settle();
    cleanup();
    return { notified, client };
  }

  test('fallback emits one project-read signal for the current client after a successful session read', async () => {
    const { notified, client } = await runFallback(async () => undefined);
    expect(notified).toEqual([[PROJECT, client]]);
  });

  test('a rejected session read or a cycle cancelled before it settles emits nothing', async () => {
    expect((await runFallback(async () => { throw new Error('offline'); })).notified).toEqual([]);
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    const cancelled = await runFallback(() => held, (cleanup) => { cleanup(); release(); });
    expect(cancelled.notified).toEqual([]);
  });
});

// Production functions are extracted from the real provider source (existing
// convention); the in-component fan-out gate is mirrored below like C4's.
function productionFunctions<T>(names: string[]): T {
  const file = resolve(process.cwd(), 'providers/opencode-provider.tsx');
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = names.map((name) => {
    const node = ast.statements.find((value) => ts.isFunctionDeclaration(value) && value.name?.text === name);
    if (!node) throw new Error(`Production function ${name} is missing`);
    return node.getText(ast);
  });
  const js = ts.transpileModule(found.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(`${js}; return { ${names.join(', ')} };`)() as T;
}

type Envelope = { directory?: string; payload?: unknown };
type Qualified = { projectId: string; conversationId: string; localSessionId: string } | undefined;
const changed = (overrides: Record<string, unknown> = {}, properties: Record<string, unknown> = {}) => ({
  type: 'rhythm.coordinator.changed',
  id: 'notification-1',
  properties: { projectId: PROJECT, conversationId: 'conversation-a', localSessionId: ROOT, ...properties },
  ...overrides,
});

describe('canonical coordinator notification (mobile consumer, source-only)', () => {
  const qualify = () => productionFunctions<{
    coordinatorChangedFromEnvelope: (envelope: Envelope, activeProjectPath: string, paired: boolean) => Qualified;
  }>(['parseCoordinatorChangedEvent', 'coordinatorChangedFromEnvelope']).coordinatorChangedFromEnvelope;

  test('actual qualifier accepts only the exact paired project envelope', () => {
    const q = qualify();
    expect(q({ directory: PROJECT, payload: changed() }, PROJECT, true))
      .toEqual({ projectId: PROJECT, conversationId: 'conversation-a', localSessionId: ROOT });
    // Direct standalone OpenCode connection never qualifies a custom event.
    expect(q({ directory: PROJECT, payload: changed() }, PROJECT, false)).toBeUndefined();
    expect(q({ directory: 'project-other', payload: changed() }, PROJECT, true)).toBeUndefined();
    expect(q({ directory: PROJECT, payload: changed({}, { projectId: 'project-other' }) }, PROJECT, true)).toBeUndefined();
    expect(q({ payload: changed() }, PROJECT, true)).toBeUndefined();
  });

  test.each([
    ['wrong type', changed({ type: 'session.idle' })],
    ['missing id', changed({ id: undefined })],
    ['empty id', changed({ id: '' })],
    ['oversized id', changed({ id: 'x'.repeat(300) })],
    ['non-string id', changed({ id: 7 })],
    ['extra top-level field', changed({ text: 'private body' })],
    ['extra property field', changed({}, { sessionID: 'sdk-root' })],
    ['body-bearing property', changed({}, { controlRevision: 4 })],
    ['missing conversation', changed({}, { conversationId: undefined })],
    ['empty local root', changed({}, { localSessionId: '' })],
    ['non-string project', changed({}, { projectId: 5 })],
    ['array properties', changed({ properties: [] })],
    ['null', null],
    ['string', 'rhythm.coordinator.changed'],
  ])('actual parser rejects %s', (_label, payload) => {
    expect(qualify()({ directory: PROJECT, payload }, PROJECT, true)).toBeUndefined();
  });

  async function deliver(overrides: Partial<CoordinatorChange> = {}) {
    await act(async () => {
      mockChangeListeners.forEach((listener) => listener({
        projectId: PROJECT, conversationId: 'conversation-a', localSessionId: ROOT, pairedClient: mockPairedClient, ...overrides,
      }));
    });
    await settle();
  }

  test('healthy-SSE typed notification updates an inert primary with no SDK catalog row', async () => {
    await openInert();
    expect((mockOpencode as { sessions: { rhythm?: unknown }[] }).sessions.some((s) => s.rhythm)).toBe(false);
    historyRows = [1, 2];
    // Unknown / ordinary SDK events stay negative.
    await emit('sdk-unknown');
    await emit('sdk-ordinary');
    expect(historyIds()).toEqual([1]);
    await deliver();
    expect(historyIds()).toEqual([1, 2]);
    expect(ctx.binding?.source).toBe('server_primary');
    expect(calls.message).toBe(0);
    expect(calls.open).toBe(1);
  });

  test.each([
    ['stale paired client', { pairedClient: {} }],
    ['wrong project', { projectId: 'project-other' }],
    ['wrong local root', { localSessionId: 'local-root-other' }],
    ['wrong conversation', { conversationId: 'conversation-other' }],
  ])('%s does nothing', async (_label, override) => {
    await openInert();
    historyRows = [1, 2];
    const before = { ...calls };
    await deliver(override);
    expect(calls).toEqual(before);
    expect(historyIds()).toEqual([1]);
  });

  test('normal mode and unmount do nothing', async () => {
    const screen = await openInert();
    historyRows = [1, 2];
    act(() => ctx.returnToNormal());
    await settle();
    const before = { ...calls };
    await deliver();
    expect(calls).toEqual(before);
    screen.unmount();
    expect(mockChangeListeners.size).toBe(0);
  });

  test('a notification during finite admission queues one read, sends nothing, and keeps pending state', async () => {
    mockOpencode = catalogOpencode();
    const withGoal = { ...conversation(), goals: [{ id: 'goal-a', commandKey: 'goal-command-a', objective: 'Finite plan', state: 'captured', linkedWorkstreamId: null, revision: 1 }] };
    mockGateway.open = async () => ({ kind: 'replay', conversation: withGoal });
    mockGateway.status = async () => { calls.status += 1; return { kind: 'status', conversation: withGoal, context: {} }; };
    let admit!: (value: unknown) => void;
    mockGateway.preparePlan = jest.fn(() => new Promise((done) => { admit = done; }));
    render(tree());
    await act(async () => { await ctx.open(); });
    await settle();
    let request!: Promise<boolean>;
    await act(async () => {
      request = ctx.preparePlan('goal-a', { totalTokenAuthorization: 20000, maxTurns: 2, maxWallTimeSeconds: 120, expiresInSeconds: 300, purpose: 'decompose', acknowledgesSoftTotalTokenAuthorization: true });
    });
    await settle();
    const before = calls.status;
    historyRows = [1, 2];
    await deliver({ conversationId: 'conversation-a' });
    await deliver();
    expect(calls.status).toBe(before);
    await act(async () => {
      admit({ kind: 'planned', conversation: withGoal, workstream: { workstream: { id: 'w', state: 'queued' }, readiness: { available: true }, jobs: [], budget: { actualTokens: 0, authorizedTokens: 20000, holdReason: null } } });
      await request;
    });
    await settle();
    expect(calls.status).toBe(before + 1);
    expect(historyIds()).toEqual([1, 2]);
    expect(calls.message).toBe(0);
    expect(ctx.state.pendingCommand).toBeUndefined();
  });
});
