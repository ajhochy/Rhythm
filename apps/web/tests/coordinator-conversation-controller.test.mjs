import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../src/', import.meta.url);
const context = vm.createContext({
  AbortController,
  DOMException,
  Promise,
  Set,
  Map,
  Symbol,
  console,
  crypto: globalThis.crypto,
  clearTimeout,
  setTimeout,
});
const moduleCache = new Map();
const reactExports = ['useCallback', 'useEffect', 'useMemo', 'useRef', 'useState'];
const reactModule = new vm.SyntheticModule(
  reactExports,
  function initializeReactStub() {
    for (const name of reactExports) this.setExport(name, () => {
      throw new Error('React hook ' + name + ' is not available in this controller-only test');
    });
  },
  { context, identifier: 'react' },
);

function sourceUrl(specifier, parent) {
  const resolved = new URL(specifier, parent.identifier);
  return resolved.pathname.endsWith('.ts') ? resolved : new URL(resolved.pathname + '.ts', resolved);
}

async function loadModule(url) {
  const key = url.href;
  const cached = moduleCache.get(key);
  if (cached) return cached;
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = new vm.SourceTextModule(compiled, {
    context,
    identifier: key,
  });
  moduleCache.set(key, module);
  await module.link(async (specifier, parent) => {
    if (specifier === 'react') return reactModule;
    return loadModule(sourceUrl(specifier, parent));
  });
  return module;
}

const controllerModule = await loadModule(new URL('components/use-coordinator-conversation.ts', root));
await controllerModule.evaluate();
const journalModule = await loadModule(new URL('gateway/coordinator-conversation-journal.ts', root));
await journalModule.evaluate();
const transportModule = await loadModule(new URL('gateway/coordinator-conversations.ts', root));
await transportModule.evaluate();

const {
  CoordinatorConversationController,
} = controllerModule.namespace;
const {
  createCoordinatorConversationJournal,
  createMemoryCoordinatorConversationJournal,
} = journalModule.namespace;
const {
  createLiveCoordinatorConversationGateway,
} = transportModule.namespace;

const scope = { actorKey: 'user:7', projectId: 'project-a', sessionId: 'root-a' };
const conversation = (revision = 1, goals = []) => ({
  schemaVersion: 1,
  id: 'conversation-a',
  sessionId: 'root-a',
  projectId: 'project-a',
  controlRevision: revision,
  goals,
});
const contextResult = (revision = 1) => ({
  kind: 'status',
  conversation: conversation(revision),
  context: {
    timeZone: 'America/Los_Angeles',
    asOf: '2026-10-05T00:00:00.000Z',
    today: '2026-10-05',
    yesterday: '2026-10-04',
    availability: {
      tasks: { state: 'available' },
      schedules: { state: 'available' },
      workstreams: { state: 'available' },
      receipts: { state: 'available' },
      manualActivity: { state: 'not_configured' },
    },
    todayTasks: [],
    waitingForReply: [],
    doneWithUnknownCompletionDate: [],
    scheduledPriorities: [],
    activeWorkstreams: [],
    executionSucceededGoalUnverified: [],
    staleExecutions: [],
    verifiedYesterday: [],
    usageHolds: [],
    receipts: [],
  },
});

const c2Conversation = (revision = 1) => ({
  schemaVersion: 3,
  id: 'conversation-a',
  sessionId: 'root-a',
  projectId: 'project-a',
  controlRevision: revision,
  primaryOwnerRoot: true,
  ownerUserId: 7,
  commandDedupe: [],
  goals: [{
    id: 'goal-a', commandKey: 'goal-command-a', objective: 'Prepare a finite plan',
    state: 'captured', linkedWorkstreamId: null, revision: 1,
  }],
  continuations: [],
});

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('a deferred status acknowledgement never acknowledges an unsent desktop message', async () => {
  const pendingStatus = deferred();
  let messageCalls = 0;
  let statusCalls = 0;
  const gateway = {
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => {
      statusCalls += 1;
      return pendingStatus.promise;
    },
    message: async () => {
      messageCalls += 1;
      return { kind: 'created', conversation: conversation(2) };
    },
  };
  const controller = new CoordinatorConversationController(() => gateway, createMemoryCoordinatorConversationJournal());
  controller.activate(scope);
  assert.equal(statusCalls, 0);
  assert.equal(messageCalls, 0);
  await controller.open(scope);
  await settle();
  assert.equal(statusCalls, 1);
  assert.equal(
    (await controller.send(scope, 'Add a workstream: must not borrow status acknowledgement')).accepted,
    false,
  );
  assert.equal(messageCalls, 0);
  pendingStatus.resolve(contextResult());
  await settle();
  assert.equal(controller.get(scope).pendingCommand, undefined);
});

test('retains actual bounded canonical rows after coordinator open without manufacturing an acknowledgement', async () => {
  const historyCalls = [];
  const gateway = {
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(),
    history: async (input) => {
      historyCalls.push(input);
      return {
        kind: 'history',
        conversation: conversation(),
        messages: [{
          id: 12,
          sessionId: scope.sessionId,
          role: 'output',
          rawText: 'Existing canonical reply',
          strippedText: 'Existing canonical reply',
          createdAt: '2026-10-05T00:00:00.000Z',
          sdkMessageId: 'sdk-message-12',
          parts: [],
          tokens: null,
          cost: null,
        }],
        nextCursor: '11',
        hasMore: true,
      };
    },
    message: async () => ({ kind: 'created', conversation: conversation(2) }),
  };
  const controller = new CoordinatorConversationController(() => gateway, createMemoryCoordinatorConversationJournal());

  await controller.open(scope);
  await settle();

  assert.deepEqual(JSON.parse(JSON.stringify(historyCalls)), [{ sessionId: scope.sessionId, projectId: scope.projectId, limit: 50 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.get(scope).canonicalHistory?.messages)), [{
    id: 12,
    sessionId: scope.sessionId,
    role: 'output',
    rawText: 'Existing canonical reply',
    strippedText: 'Existing canonical reply',
    createdAt: '2026-10-05T00:00:00.000Z',
    sdkMessageId: 'sdk-message-12',
    parts: [],
    tokens: null,
    cost: null,
  }]);
  assert.equal(controller.get(scope).canonicalHistory?.hasMore, true);
});

test('merges a real older canonical page by row id without treating control state as history', async () => {
  const calls = [];
  const rows = (id, text) => ({
    id, sessionId: scope.sessionId, role: id % 2 ? 'input' : 'output', rawText: text, strippedText: text,
    createdAt: `2026-10-05T00:00:0${id}.000Z`, sdkMessageId: `sdk-${id}`,
    parts: [{ id: `part-${id}`, type: 'text', text }], tokens: null, cost: null,
  });
  const controller = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(),
    history: async (input) => {
      calls.push(input);
      return input.beforeId === undefined
        ? { kind: 'history', conversation: conversation(), messages: [rows(11, 'current'), rows(12, 'newer')], nextCursor: '11', hasMore: true }
        : { kind: 'history', conversation: conversation(), messages: [rows(9, 'older'), rows(11, 'current')], nextCursor: null, hasMore: false };
    },
    message: async () => ({ kind: 'created', conversation: conversation(2) }),
  }), createMemoryCoordinatorConversationJournal());
  await controller.open(scope);
  await settle();
  assert.equal(await controller.loadOlderHistory(scope), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), { sessionId: scope.sessionId, projectId: scope.projectId, limit: 50, beforeId: 11 });
  assert.deepEqual(JSON.parse(JSON.stringify(controller.get(scope).canonicalHistory?.messages.map((row) => row.id))), [9, 11, 12]);
  assert.equal(controller.get(scope).canonicalHistory?.hasMore, false);
});

test('an account switch aborts an old authenticated coordinator request without publishing it into the new owner view', async () => {
  let aborted = false;
  const gateway = createLiveCoordinatorConversationGateway(
    'http://local-api',
    async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        const error = new Error('aborted after account switch');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    undefined,
    'invented-owner-a-token',
  );
  const controller = new CoordinatorConversationController(
    () => gateway,
    createMemoryCoordinatorConversationJournal(),
  );
  const opening = controller.open(scope);
  await settle();
  const ownerB = { ...scope, actorKey: 'user:8' };
  controller.activate(ownerB);

  assert.equal(aborted, true);
  assert.equal(await opening, false);
  assert.equal(controller.get(scope).enabled, false);
  assert.equal(controller.get(ownerB).enabled, false);
});

test('temporary ineligibility and controller recreation retain one immutable uncertain command', async () => {
  const journal = createMemoryCoordinatorConversationJournal();
  const sent = [];
  let resolveSend = false;
  const makeController = () => new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(),
    message: async (input) => {
      sent.push(input);
      if (!resolveSend) throw new Error('network unavailable');
      return { kind: 'created', conversation: conversation(2) };
    },
  }), journal);
  const first = makeController();
  await first.open(scope);
  await settle();
  assert.equal(
    (await first.send(scope, 'Add a workstream: retain this immutable command')).accepted,
    false,
  );
  const pending = first.get(scope).pendingCommand;
  assert.ok(pending);
  first.activate(null);
  first.activate(scope);
  await first.open(scope);
  await settle();
  assert.deepEqual(first.get(scope).pendingCommand, pending);
  first.returnToNormal(scope);
  first.dispose();

  const recreated = makeController();
  await recreated.open(scope);
  await settle();
  assert.deepEqual(recreated.get(scope).pendingCommand, pending);
  resolveSend = true;
  assert.equal(await recreated.retry(scope), true);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);

  const foreignScope = { ...scope, actorKey: 'user:other' };
  const foreign = makeController();
  foreign.activate(foreignScope);
  assert.equal(foreign.get(foreignScope).enabled, false);
});

test('a malformed successful transport response remains an exact same-command retry in the controller', async () => {
  const requestBodies = [];
  let messageAttempt = 0;
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    requestBodies.push(body);
    if (url.endsWith('/open')) {
      return { status: 201, json: async () => ({ kind: 'created', conversation: conversation() }) };
    }
    if (url.endsWith('/status')) {
      return { status: 200, json: async () => contextResult() };
    }
    if (url.endsWith('/history')) {
      return {
        status: 200,
        json: async () => ({
          kind: 'history', conversation: conversation(), messages: [], nextCursor: null, hasMore: false,
        }),
      };
    }
    messageAttempt += 1;
    if (messageAttempt === 1) {
      return {
        status: 201,
        json: async () => ({ kind: 'created', conversation: { ...conversation(), projectId: 'foreign-project' } }),
      };
    }
    return { status: 201, json: async () => ({ kind: 'created', conversation: conversation(2) }) };
  };
  const gateway = createLiveCoordinatorConversationGateway('http://local-api', fetcher, undefined, 'invented-signed-in-token');
  const controller = new CoordinatorConversationController(
    () => gateway,
    createMemoryCoordinatorConversationJournal(),
  );
  await controller.open(scope);
  await settle();
  assert.equal(
    (await controller.send(scope, 'Add a workstream: uncertain response')).accepted,
    false,
  );
  const pending = controller.get(scope).pendingCommand;
  assert.equal(controller.get(scope).notice?.retryable, true);
  assert.equal(await controller.retry(scope), true);
  const messages = requestBodies.filter((body) => body.message === 'Add a workstream: uncertain response');
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[1], messages[0]);
  assert.equal(controller.get(scope).pendingCommand, undefined);
  assert.equal(messages[0].commandKey, pending.commandKey);
});

test('a bounded timeout retains the same immutable command for a later retry', async () => {
  const messages = [];
  let messageAttempt = 0;
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/open')) {
      return { status: 201, json: async () => ({ kind: 'created', conversation: conversation() }) };
    }
    if (url.endsWith('/status')) {
      return { status: 200, json: async () => contextResult() };
    }
    if (url.endsWith('/history')) {
      return {
        status: 200,
        json: async () => ({
          kind: 'history', conversation: conversation(), messages: [], nextCursor: null, hasMore: false,
        }),
      };
    }
    messages.push(body);
    messageAttempt += 1;
    if (messageAttempt === 1) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
    return { status: 201, json: async () => ({ kind: 'created', conversation: conversation(2) }) };
  };
  const gateway = createLiveCoordinatorConversationGateway('http://local-api', fetcher, 1, 'invented-signed-in-token');
  const controller = new CoordinatorConversationController(
    () => gateway,
    createMemoryCoordinatorConversationJournal(),
  );
  await controller.open(scope);
  await settle();
  assert.equal((await controller.send(scope, 'Add a workstream: retry after timeout')).accepted, false);
  assert.equal(controller.get(scope).notice?.retryable, true);
  assert.equal(await controller.retry(scope), true);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[1], messages[0]);
});

test('finite planning keeps one explicit consent command for an exact retry and never treats it as verification', async () => {
  const attempts = [];
  let call = 0;
  const controller = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: c2Conversation() }),
    status: async () => ({ ...contextResult(), conversation: c2Conversation() }),
    message: async () => { throw new Error('ordinary message must not be used for managed planning'); },
    preparePlan: async (input) => {
      attempts.push(input);
      call += 1;
      if (call === 1) throw new Error('invented interrupted acknowledgement');
      return {
        kind: 'planned',
        conversation: c2Conversation(2),
        workstream: { workstream: { id: 'workstream-a', state: 'queued' }, readiness: { available: true }, jobs: [], budget: {} },
      };
    },
  }), createMemoryCoordinatorConversationJournal());
  await controller.open(scope);
  await settle();
  const consent = {
    totalTokenAuthorization: 20000,
    maxTurns: 2,
    maxWallTimeSeconds: 90,
    expiresInSeconds: 900,
    acknowledgesSoftTotalTokenAuthorization: true,
    purpose: 'decompose',
  };
  assert.equal(await controller.preparePlan(scope, 'goal-a', {
    ...consent,
    purpose: 'execute',
  }), false);
  assert.equal(attempts.length, 0);
  assert.equal(await controller.preparePlan(scope, 'goal-a', consent), false);
  assert.equal(controller.get(scope).pendingPlan?.goalId, 'goal-a');
  assert.equal(controller.get(scope).pendingPlan?.kind, 'prepare');
  assert.equal(controller.get(scope).notice?.retryable, true);
  assert.equal(await controller.retryPlan(scope), true);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal('thinkingBudget' in attempts[0].admission, false);
  assert.match(controller.get(scope).notice?.message ?? '', /not verification/i);
});

test('returning to normal before the queued finite control reaches its wire blocks both plan operations', async () => {
  const consent = {
    totalTokenAuthorization: 20000,
    maxTurns: 2,
    maxWallTimeSeconds: 90,
    expiresInSeconds: 900,
    acknowledgesSoftTotalTokenAuthorization: true,
    purpose: 'decompose',
  };
  for (const operation of ['prepare', 'continue']) {
    const calls = [];
    const planConversation = c2Conversation();
    planConversation.continuations = [{
      authorizationId: 'authority-a', goalId: 'goal-a', workstreamId: 'workstream-a',
      status: 'consumed', maxTurns: 2, consumedTurns: 1, expiresAt: '2026-10-05T01:00:00.000Z',
    }];
    const controller = new CoordinatorConversationController(() => ({
      open: async () => ({ kind: 'replay', conversation: planConversation }),
      status: async () => ({ ...contextResult(), conversation: planConversation }),
      message: async () => { throw new Error('ordinary message must not run'); },
      preparePlan: async () => { calls.push('prepare'); throw new Error('must not reach prepare wire'); },
      continuePlan: async () => { calls.push('continue'); throw new Error('must not reach continue wire'); },
    }), createMemoryCoordinatorConversationJournal());
    await controller.open(scope);
    await settle();
    const pending = operation === 'prepare'
      ? controller.preparePlan(scope, 'goal-a', consent)
      : controller.continuePlan(scope, 'goal-a', 'authority-a');
    controller.returnToNormal(scope);
    assert.equal(await pending, false, operation);
    assert.deepEqual(calls, [], operation);
    assert.equal(controller.get(scope).enabled, false, operation);
    const staleCallback = operation === 'prepare'
      ? controller.preparePlan(scope, 'goal-a', consent)
      : controller.continuePlan(scope, 'goal-a', 'authority-a');
    assert.equal(await staleCallback, false, `${operation} stale callback`);
    assert.deepEqual(calls, [], `${operation} stale callback`);
  }
});

test('only a direct message 409 permits retiring a command after a qualified review', async () => {
  const journal = createMemoryCoordinatorConversationJournal();
  const uncertain = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(2),
    message: async () => { throw new Error('response lost after possible admission'); },
  }), journal);
  await uncertain.open(scope);
  await settle();
  assert.equal((await uncertain.send(scope, 'Add a workstream: immutable uncertain command')).accepted, false);
  const pending = uncertain.get(scope).pendingCommand;
  await uncertain.send(scope, 'Add a workstream: edited local idea');
  await uncertain.reviewConflict(scope);
  assert.equal(uncertain.beginNewMessageAfterReview(scope), false);
  uncertain.dispose();

  const recreated = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(2),
    message: async () => { throw new Error('must not change immutable retry'); },
  }), journal);
  await recreated.open(scope);
  await settle();
  assert.deepEqual(recreated.get(scope).pendingCommand, pending);
  assert.equal(recreated.get(scope).pendingProvenance, 'uncertain');

  const conflictJournal = createMemoryCoordinatorConversationJournal();
  const conflicted = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(3),
    message: async () => ({ kind: 'revision_conflict', conversation: conversation(2) }),
  }), conflictJournal);
  await conflicted.open(scope);
  await settle();
  assert.equal((await conflicted.send(scope, 'Add a workstream: confirmed conflict')).accepted, false);
  assert.equal(conflicted.beginNewMessageAfterReview(scope), false);
  assert.equal(await conflicted.reviewConflict(scope), true);
  assert.equal(conflicted.beginNewMessageAfterReview(scope), true);
});

test('owner-scoped uncertain pointers survive A to B to A and corrupt or unknown journal bytes fail closed', async () => {
  const journal = createMemoryCoordinatorConversationJournal();
  const ownerB = { ...scope, actorKey: 'user:other' };
  const first = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(),
    message: async () => { throw new Error('uncertain'); },
  }), journal);
  await first.open(scope);
  await settle();
  await first.send(scope, 'Add a workstream: retain for owner return');
  const pending = first.get(scope).pendingCommand;
  first.activate(ownerB);
  assert.equal(first.get(ownerB).pendingCommand, undefined);
  first.activate(scope);
  assert.deepEqual(first.get(scope).pendingCommand, pending);
  first.dispose();

  let raw = 'invalid coordinator journal bytes';
  const storage = {
    getItem: () => raw,
    setItem: (_key, value) => { raw = String(value); },
  };
  const corruptJournal = createCoordinatorConversationJournal(storage);
  let messageCalls = 0;
  const blocked = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(),
    message: async () => {
      messageCalls += 1;
      return { kind: 'created', conversation: conversation(2) };
    },
  }), corruptJournal);
  assert.equal(await blocked.open(scope), false);
  assert.equal((await blocked.send(scope, 'Add a workstream: must not reach wire')).accepted, false);
  assert.equal(messageCalls, 0);
  assert.equal(raw, 'invalid coordinator journal bytes');

  const unknownRaw = JSON.stringify({
    [JSON.stringify([scope.actorKey, scope.projectId, scope.sessionId])]: {
      version: 1,
      actorKey: scope.actorKey,
      projectId: scope.projectId,
      sessionId: scope.sessionId,
      viewEnabled: true,
      unrecognizedFutureControl: true,
    },
  });
  let preservedUnknownRaw = unknownRaw;
  const unknownJournal = createCoordinatorConversationJournal({
    getItem: () => preservedUnknownRaw,
    setItem: (_key, value) => { preservedUnknownRaw = String(value); },
  });
  let unknownMessageCalls = 0;
  const unknownBlocked = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(),
    message: async () => {
      unknownMessageCalls += 1;
      return { kind: 'created', conversation: conversation(2) };
    },
  }), unknownJournal);
  assert.equal(await unknownBlocked.open(scope), false);
  assert.equal((await unknownBlocked.send(scope, 'Add a workstream: unknown bytes must not reach wire')).accepted, false);
  assert.equal(unknownMessageCalls, 0);
  assert.equal(preservedUnknownRaw, unknownRaw);
});

test('a missing gateway releases its operation slot when the gateway returns', async () => {
  let gateway;
  let openCalls = 0;
  const controller = new CoordinatorConversationController(() => gateway, createMemoryCoordinatorConversationJournal());
  assert.equal(await controller.open(scope), false);
  gateway = {
    open: async () => {
      openCalls += 1;
      return { kind: 'replay', conversation: conversation() };
    },
    status: async () => contextResult(),
    message: async () => ({ kind: 'created', conversation: conversation(2) }),
  };
  assert.equal(await controller.open(scope), true);
  assert.equal(openCalls, 1);
});

test('a skipped different durable command is not admitted by the desktop controller', async () => {
  const journal = createMemoryCoordinatorConversationJournal();
  const retained = {
    viewEnabled: true,
    pendingCommand: {
      commandKey: 'retained-command',
      expectedControlRevision: 1,
      message: 'Add a workstream: retained immutable command',
    },
    pendingProvenance: 'uncertain',
    pendingState: 'retry',
    writeRevision: 100,
  };
  const attempted = {
    ...retained,
    pendingCommand: {
      commandKey: 'different-command',
      expectedControlRevision: 1,
      message: 'Add a workstream: must not reach wire',
    },
    writeRevision: 1,
  };
  assert.equal(journal.save(scope, retained), true);
  assert.equal(journal.save(scope, attempted), false);
  const stored = journal.load(scope).pendingCommand;
  assert.equal(stored.commandKey, retained.pendingCommand.commandKey);
  assert.equal(stored.expectedControlRevision, retained.pendingCommand.expectedControlRevision);
  assert.equal(stored.message, retained.pendingCommand.message);

  let messageCalls = 0;
  const emptyJournal = createMemoryCoordinatorConversationJournal();
  const controller = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(),
    message: async () => {
      messageCalls += 1;
      return { kind: 'created', conversation: conversation(2) };
    },
  }), emptyJournal);
  await controller.open(scope);
  await settle();
  // Another same-scope controller has retained the command after this view
  // was opened. The attempted write must lose safely and install that pointer.
  assert.equal(emptyJournal.save(scope, retained), true);
  const result = await controller.send(scope, attempted.pendingCommand.message);
  assert.equal(result.accepted, false);
  assert.equal(messageCalls, 0);
  const adopted = controller.get(scope).pendingCommand;
  assert.equal(adopted.commandKey, retained.pendingCommand.commandKey);
  assert.equal(adopted.expectedControlRevision, retained.pendingCommand.expectedControlRevision);
  assert.equal(adopted.message, retained.pendingCommand.message);
});

test('stale view-only refreshes cannot retire another controller’s uncertain command', async () => {
  const journal = createMemoryCoordinatorConversationJournal();
  const wires = [];
  const gateway = {
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => contextResult(),
    message: async (input) => {
      wires.push(input);
      throw new Error('invented uncertain acknowledgement');
    },
  };
  const stale = new CoordinatorConversationController(() => gateway, journal);
  const owner = new CoordinatorConversationController(() => gateway, journal);

  await stale.open(scope);
  await stale.refresh(scope);
  await owner.open(scope);
  for (let index = 0; index < 6; index += 1) await owner.refresh(scope);
  assert.equal(
    (await owner.send(scope, 'Add a workstream: durable command from another controller')).accepted,
    false,
  );
  const original = journal.load(scope).pendingCommand;
  assert.ok(original);

  // The stale controller has no local pending command. Its own ordinary
  // refreshes advance a local view revision, but may not retire the durable
  // pointer it did not acknowledge or reject.
  for (let index = 0; index < 20; index += 1) await stale.refresh(scope);
  assert.deepEqual(journal.load(scope).pendingCommand, original);

  assert.equal(
    (await stale.send(scope, 'Add a workstream: competing stale command')).accepted,
    false,
  );
  assert.equal(wires.length, 1);
  assert.deepEqual(journal.load(scope).pendingCommand, original);
  assert.deepEqual(stale.get(scope).pendingCommand, original);
});
