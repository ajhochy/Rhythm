import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/gateway/coordinator-conversations.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const gatewayModule = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'),
);

const pendingSource = await readFile(
  new URL('../src/pending-decisions.ts', import.meta.url),
  'utf8',
);
const pendingModule = { exports: {} };
new Function('require', 'module', 'exports', 'fetch', 'AbortSignal', ts.transpileModule(pendingSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText)(
  (id) => {
    if (id === 'react') return { useRef() {}, useState() {}, useSyncExternalStore() {} };
    if (id === './gateway/context') return { useGateway: () => null };
    throw new Error('Unexpected pending-decisions test import: ' + id);
  },
  pendingModule,
  pendingModule.exports,
  async () => ({ ok: true, json: async () => [] }),
  AbortSignal,
);
const pendingDecisions = pendingModule.exports;

const scope = { actorKey: 'local-view-only', sessionId: 'root-a', projectId: 'project-a' };
const conversation = (revision = 1) => ({
  schemaVersion: 1,
  id: 'conversation-a',
  sessionId: 'root-a',
  projectId: 'project-a',
  controlRevision: revision,
  goals: [],
});

const c2Conversation = (revision = 1) => ({
  ...conversation(revision),
  schemaVersion: 3,
  primaryOwnerRoot: true,
  ownerUserId: 7,
  commandDedupe: [],
  goals: [{
    id: 'goal-a',
    commandKey: 'goal-command-a',
    objective: 'Prepare a finite plan',
    state: 'captured',
    linkedWorkstreamId: null,
    revision: 1,
  }],
  continuations: [{
    authorizationId: 'authority-a',
    goalId: 'goal-a',
    workstreamId: 'workstream-a',
    status: 'consumed',
    maxTurns: 2,
    consumedTurns: 1,
    expiresAt: '2026-10-05T01:00:00.000Z',
  }],
});

const plannedWorkstream = () => ({
  workstream: { id: 'workstream-a', state: 'queued' },
  readiness: { available: true },
  jobs: [],
  budget: {},
});

test('coordinator gateway serializes the exact C1 bodies without local actor state', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    return {
      status: 201,
      json: async () => ({ kind: 'created', conversation: conversation() }),
    };
  };
  const gateway = gatewayModule.createLiveCoordinatorConversationGateway('http://local-api/', fetcher, undefined, 'invented-signed-in-token');
  await gateway.open(scope);
  await gateway.message({
    ...scope,
    expectedControlRevision: 1,
    commandKey: 'command-1',
    message: 'Add a workstream: exact body',
  });

  assert.deepEqual(JSON.parse(requests[0].init.body), {
    sessionId: 'root-a',
    projectId: 'project-a',
  });
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    sessionId: 'root-a',
    projectId: 'project-a',
    expectedControlRevision: 1,
    commandKey: 'command-1',
    message: 'Add a workstream: exact body',
  });
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer invented-signed-in-token');
  assert.equal(JSON.stringify(requests).includes('actorKey'), false);
  assert.equal(JSON.stringify(requests.map((request) => JSON.parse(request.init.body))).includes('invented-signed-in-token'), false);
  assert.equal(requests[0].url, 'http://local-api/coordinator-conversations/open');
});

test('coordinator gateway holds locally when no signed-in token is available and does not fetch', async () => {
  let calls = 0;
  const gateway = gatewayModule.createLiveCoordinatorConversationGateway('http://local-api', async () => {
    calls += 1;
    throw new Error('must not fetch anonymously');
  });
  await assert.rejects(
    () => gateway.open(scope),
    (error) => error.name === 'CoordinatorTransportError' && error.status === 401 && error.retryable === false,
  );
  assert.equal(calls, 0);
});

test('SDK-less coordinator roots skip ordinary decision reads, and a stale decision failure is ignored', async () => {
  let permissionCalls = 0;
  const inertGateway = {
    mode: 'live',
    environment: { enginePort: 4001 },
    domains: { permissions: { pending: async () => { permissionCalls += 1; return []; } } },
  };
  await pendingDecisions.rehydrateDecisions(inertGateway, {
    id: 'coordinator-root',
    cwd: '/fixture/coordinator-root',
  });
  assert.equal(permissionCalls, 0);

  let rejectPermission;
  const deferredPermission = new Promise((_resolve, reject) => { rejectPermission = reject; });
  const staleGateway = {
    mode: 'live',
    environment: { enginePort: 4001 },
    domains: { permissions: { pending: () => { permissionCalls += 1; return deferredPermission; } } },
  };
  const controller = new AbortController();
  const staleRead = pendingDecisions.rehydrateDecisions(staleGateway, {
    id: 'previous-sdk-chat',
    sdkSessionId: 'sdk-previous',
    cwd: '/fixture/previous-sdk-chat',
  }, controller.signal);
  assert.equal(permissionCalls, 1);
  controller.abort();
  rejectPermission(new Error('previous chat permission read failed after selection changed'));
  await staleRead;
});

test('coordinator gateway preserves its draft-safe auth hold for a rejected bearer', async () => {
  const gateway = gatewayModule.createLiveCoordinatorConversationGateway(
    'http://local-api',
    async () => ({ status: 401, json: async () => ({ error: 'unauthorized' }) }),
    undefined,
    'invented-expired-token',
  );
  await assert.rejects(
    () => gateway.open(scope),
    (error) => error.name === 'CoordinatorTransportError' && error.status === 401 && error.retryable === false && /draft/i.test(error.message),
  );
});

test('coordinator gateway rejects malformed, cross-chat, and wrong-status envelopes', () => {
  assert.equal(gatewayModule.parseCoordinatorConversationResult(
    { kind: 'created', conversation: { ...conversation(), sessionId: 'other-root' } },
    scope,
    201,
  ), undefined);
  assert.equal(gatewayModule.parseCoordinatorConversationResult(
    { kind: 'created', conversation: conversation() },
    scope,
    200,
  ), undefined);
  assert.equal(gatewayModule.parseCoordinatorConversationResult(
    { kind: 'status', conversation: conversation() },
    scope,
    200,
  ), undefined);
});

test('coordinator gateway bounds a hung request without changing the command body', async () => {
  let observedBody;
  const fetcher = async (_url, init) => {
    observedBody = init.body;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };
  const gateway = gatewayModule.createLiveCoordinatorConversationGateway('http://local-api', fetcher, 1, 'invented-signed-in-token');
  await assert.rejects(
    () => gateway.message({
      ...scope,
      expectedControlRevision: 1,
      commandKey: 'same-command',
      message: 'Add a workstream: keep draft',
    }),
    (error) => error.name === 'CoordinatorTransportError' && /timed out/i.test(error.message),
  );
  assert.deepEqual(JSON.parse(observedBody), {
    sessionId: 'root-a',
    projectId: 'project-a',
    expectedControlRevision: 1,
    commandKey: 'same-command',
    message: 'Add a workstream: keep draft',
  });
});

test('an invalid 201 acknowledgement remains retryable with the exact command', async () => {
  const fetcher = async () => ({
    status: 201,
    json: async () => ({ kind: 'created', conversation: { ...conversation(), sessionId: 'foreign-root' } }),
  });
  const gateway = gatewayModule.createLiveCoordinatorConversationGateway('http://local-api', fetcher, undefined, 'invented-signed-in-token');
  await assert.rejects(
    () => gateway.message({
      ...scope,
      expectedControlRevision: 1,
      commandKey: 'same-command-after-invalid-ack',
      message: 'Add a workstream: retain this command',
    }),
    (error) => error.name === 'CoordinatorTransportError' &&
      error.status === 201 &&
      error.retryable === true,
  );
});

test('C2 resolve and finite managed-work routes enumerate only their published fields', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, body });
    if (url.endsWith('/resolve')) {
      return {
        status: 200,
        json: async () => ({ kind: 'resolved', created: false, sessionId: 'root-a', projectId: 'project-a', conversation: c2Conversation() }),
      };
    }
    if (url.endsWith('/prepare-plan')) {
      return {
        status: 200,
        json: async () => ({ kind: 'planned', conversation: c2Conversation(2), workstream: plannedWorkstream() }),
      };
    }
    return {
      status: 200,
      json: async () => ({ kind: 'continuation_available', conversation: c2Conversation(3), workstreamId: 'workstream-a', remainingTurns: 1 }),
    };
  };
  const gateway = gatewayModule.createLiveCoordinatorConversationGateway('http://local-api', fetcher, undefined, 'invented-signed-in-token');
  const resolved = await gateway.resolve({ projectId: 'project-a' });
  assert.equal(resolved.kind, 'resolved');
  const admission = {
    commandKey: 'finite-command-a',
    totalTokenAuthorization: 20000,
    maxTurns: 2,
    maxWallTimeSeconds: 90,
    expiresInSeconds: 900,
    acknowledgesSoftTotalTokenAuthorization: true,
    purpose: 'decompose',
  };
  const planned = await gateway.preparePlan({
    sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a', admission,
  });
  assert.equal(planned.kind, 'planned');
  const executionAdmission = {
    ...admission,
    commandKey: 'finite-command-execute',
    purpose: 'execute',
    acknowledgesScopedWorkspaceExecution: true,
  };
  const executed = await gateway.preparePlan({
    sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 2, goalId: 'goal-a', admission: executionAdmission,
  });
  assert.equal(executed.kind, 'planned');
  const continuation = await gateway.continuePlan({
    sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 3, goalId: 'goal-a', authorizationId: 'authority-a',
  });
  assert.equal(continuation.kind, 'continuation_available');

  assert.deepEqual(requests.map((request) => request.body), [
    { projectId: 'project-a' },
    {
      sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a', admission,
    },
    {
      sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 2, goalId: 'goal-a', admission: executionAdmission,
    },
    {
      sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 3, goalId: 'goal-a', authorizationId: 'authority-a',
    },
  ]);
  assert.equal(JSON.stringify(requests.map((request) => request.body)).includes('actorKey'), false);
  assert.equal(JSON.stringify(requests.map((request) => request.body)).includes('thinkingBudget'), false);
  assert.equal(new Headers(requests[1].init.headers).get('authorization'), 'Bearer invented-signed-in-token');
});

test('C2 setup retains one idempotency key across a server-returned opaque profile choice', async () => {
  const requests = [];
  const gateway = gatewayModule.createLiveCoordinatorConversationGateway(
    'http://local-api',
    async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (body.profileId === undefined) {
        return { status: 200, json: async () => ({
          kind: 'setup_profile_choice_required', profileChoices: [{ id: 'profile-b', label: 'Profile B' }],
        }) };
      }
      return { status: 201, json: async () => ({
        kind: 'setup_created', sessionId: 'root-a', projectId: 'project-a', profileId: 'profile-b', workspaceGeneration: 1,
        conversation: c2Conversation(),
      }) };
    },
    undefined,
    'invented-signed-in-token',
  );
  assert.deepEqual(await gateway.setup({ commandKey: 'setup-command-a' }), {
    kind: 'setup_profile_choice_required', profileChoices: [{ id: 'profile-b', label: 'Profile B' }],
  });
  assert.equal((await gateway.setup({ commandKey: 'setup-command-a', profileId: 'profile-b' })).kind, 'setup_created');
  assert.deepEqual(requests, [
    { commandKey: 'setup-command-a' },
    { commandKey: 'setup-command-a', profileId: 'profile-b' },
  ]);
  assert.equal(JSON.stringify(requests).match(/actorKey|projectId|model|grant|thinkingBudget/)?.length ?? 0, 0);
  assert.equal(gatewayModule.parseCoordinatorSetupResult({
    kind: 'setup_created', sessionId: 'foreign-root', projectId: 'project-a', profileId: 'profile-b', workspaceGeneration: 1,
    conversation: c2Conversation(),
  }, 201), undefined);
});

test('C2 parsers reject foreign roots, flat planned views, and status envelopes on finite routes', () => {
  assert.equal(gatewayModule.parseCoordinatorResolveResult({
    kind: 'resolved', created: false, sessionId: 'root-a', projectId: 'project-a',
    conversation: { ...c2Conversation(), sessionId: 'foreign-root' },
  }, 200), undefined);
  assert.equal(gatewayModule.parseCoordinatorResolveResult({
    kind: 'resolved', created: false, sessionId: 'root-a', projectId: 'project-a',
    conversation: { ...c2Conversation(), primaryOwnerRoot: false },
  }, 200), undefined);
  assert.equal(gatewayModule.parseCoordinatorPlanResult({
    kind: 'planned', conversation: c2Conversation(), workstream: { id: 'workstream-a', state: 'queued' },
  }, scope, 200), undefined);
  assert.equal(gatewayModule.parseCoordinatorPlanResult({
    kind: 'status', conversation: c2Conversation(), context: {} }, scope, 200), undefined);
});

test('C2 foreground acknowledgement and bounded canonical history stay distinct from fabricated bubbles', async () => {
  const requests = [];
  const canonicalRows = [{
    id: 17,
    sessionId: 'root-a',
    role: 'output',
    rawText: 'A real persisted reply',
    strippedText: 'A real persisted reply',
    createdAt: '2026-10-05T00:00:00.000Z',
    sdkMessageId: 'sdk-message-a',
    parts: [{ type: 'text', text: 'A real persisted reply' }],
    tokens: null,
    cost: null,
  }];
  const gateway = gatewayModule.createLiveCoordinatorConversationGateway(
    'http://local-api',
    async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith('/history')) {
        return { status: 200, json: async () => ({
          kind: 'history', conversation: c2Conversation(), messages: canonicalRows, nextCursor: null, hasMore: false,
        }) };
      }
      return { status: 200, json: async () => ({ kind: 'foreground_accepted', conversation: c2Conversation() }) };
    },
    undefined,
    'invented-signed-in-token',
  );
  const accepted = await gateway.message({
    ...scope, expectedControlRevision: 1, commandKey: 'foreground-command', message: 'Ask Rhythm what to do today',
  });
  const history = await gateway.history({ sessionId: 'root-a', projectId: 'project-a', limit: 50 });
  assert.equal(accepted.kind, 'foreground_accepted');
  assert.deepEqual(history.messages, canonicalRows);
  assert.deepEqual(requests.map((request) => request.body), [
    {
      sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1,
      commandKey: 'foreground-command', message: 'Ask Rhythm what to do today',
    },
    { sessionId: 'root-a', projectId: 'project-a', limit: 50 },
  ]);
  assert.equal(gatewayModule.parseCoordinatorHistoryResult({
    kind: 'history', conversation: c2Conversation(), messages: [{ ...canonicalRows[0], sessionId: 'foreign-root' }], nextCursor: null, hasMore: false,
  }, scope, 200), undefined);
});

// Known conversation schema 4 (installed f77): same top-level DTO as 3; the only addition is server command metadata.
const delegationMetadata = {
  key: 'synthetic-command', intentHash: 'a'.repeat(64), kind: 'delegate_goal', goalId: 'goal-a',
  parentSdkSessionId: 'synthetic-sdk', targetAgentConfigId: 'workflow-orchestrator', state: 'dispatched',
  delegationId: 'synthetic-delegation', childSessionId: 'synthetic-child',
};
const v4Conversation = (overrides = {}) => ({
  ...c2Conversation(),
  schemaVersion: 4,
  commandDedupe: [delegationMetadata],
  createdAt: '2026-10-06T04:00:00.000Z',
  updatedAt: '2026-10-06T04:00:00.000Z',
  ...overrides,
});
const completeContext = () => ({
  timeZone: 'America/Los_Angeles', asOf: '2026-10-06T04:00:00.000Z', today: '2026-10-06', yesterday: '2026-10-05',
  availability: {
    tasks: { state: 'available' }, schedules: { state: 'available' }, workstreams: { state: 'available' },
    receipts: { state: 'available' }, manualActivity: { state: 'not_configured' }, rhythms: { state: 'available' },
  },
  todayTasks: [], waitingForReply: [], doneWithUnknownCompletionDate: [], scheduledPriorities: [], activeWorkstreams: [],
  executionSucceededGoalUnverified: [], staleExecutions: [], verifiedYesterday: [], usageHolds: [], receipts: [],
  coverage: {}, activeRhythms: [], manualActivity: [], manualActivityDependency: null, modelContext: {},
});
const rootIds = { sessionId: 'root-a', projectId: 'project-a' };

test('known schema 4 decodes through every dedicated envelope and keeps schemas 1-3 readable', () => {
  const parse = gatewayModule.parseCoordinatorConversationResult;
  assert.equal(parse({ kind: 'replay', conversation: v4Conversation() }, scope, 200)?.conversation.schemaVersion, 4);
  assert.equal(parse({ kind: 'created', conversation: v4Conversation() }, scope, 201)?.kind, 'created');
  assert.equal(parse({ kind: 'foreground_accepted', conversation: v4Conversation() }, scope, 200)?.kind, 'foreground_accepted');
  assert.equal(parse({ kind: 'status', conversation: v4Conversation(), context: completeContext() }, scope, 200)?.kind, 'status');
  assert.equal(gatewayModule.parseCoordinatorResolveResult({
    kind: 'resolved', created: false, ...rootIds, conversation: v4Conversation(),
  }, 200)?.kind, 'resolved');
  assert.equal(gatewayModule.parseCoordinatorSetupResult({
    kind: 'setup_replay', ...rootIds, profileId: 'profile-a', workspaceGeneration: 1, conversation: v4Conversation(),
  }, 200)?.kind, 'setup_replay');
  assert.equal(gatewayModule.parseCoordinatorHistoryResult({
    kind: 'history', conversation: v4Conversation(), messages: [], nextCursor: null, hasMore: false,
  }, scope, 200)?.kind, 'history');
  assert.equal(gatewayModule.parseCoordinatorPlanResult({
    kind: 'planned', conversation: v4Conversation(), workstream: plannedWorkstream(),
  }, scope, 200)?.kind, 'planned');
  // Nested continuation authority metadata is unrelated to the conversation version.
  assert.equal(parse({ kind: 'replay', conversation: v4Conversation({ continuations: [{ ...c2Conversation().continuations[0], schemaVersion: 5 }] }) }, scope, 200)?.kind, 'replay');
  // Legacy and current-v3 behavior is unchanged.
  assert.equal(parse({ kind: 'replay', conversation: conversation() }, scope, 200)?.kind, 'replay');
  assert.equal(parse({ kind: 'replay', conversation: c2Conversation() }, scope, 200)?.kind, 'replay');
  assert.equal(gatewayModule.parseCoordinatorResolveResult({
    kind: 'resolved', created: false, ...rootIds, conversation: c2Conversation(),
  }, 200)?.kind, 'resolved');
});

test('schema 4 holds on unknown versions, malformed required fields, foreign identity and non-primary dedicated roots', () => {
  const parse = gatewayModule.parseCoordinatorConversationResult;
  const mutations = [
    { schemaVersion: 5 }, { schemaVersion: 99 }, { schemaVersion: '4' }, { schemaVersion: 4.5 },
    { ownerUserId: '7' }, { ownerUserId: 0 }, { ownerUserId: undefined },
    { primaryOwnerRoot: 'true' }, { primaryOwnerRoot: undefined },
    { controlRevision: 0 }, { controlRevision: 1.5 },
    { sessionId: 'foreign-root' }, { projectId: 'foreign-project' },
    { goals: {} }, { commandDedupe: {} }, { commandDedupe: undefined }, { continuations: {} }, { continuations: undefined },
    { createdAt: false }, { createdAt: '' }, { createdAt: 'not a date' }, { updatedAt: undefined },
    // Date.parse-valid but noncanonical: the backend requires new Date(v).toISOString() === v.
    { createdAt: '1' }, { createdAt: 'January 1, 2026' }, { updatedAt: '1' }, { updatedAt: 'January 1, 2026' },
    { createdAt: '2026-10-06T04:00:00Z' }, { updatedAt: '2026-10-06' },
    { commandDedupe: Array.from({ length: 101 }, () => delegationMetadata) },
    { goals: Array.from({ length: 101 }, (_, index) => ({ ...c2Conversation().goals[0], id: `goal-${index}` })) },
    { goals: [{ ...c2Conversation().goals[0], objective: 'x'.repeat(4001) }] },
  ];
  for (const mutation of mutations) {
    assert.equal(parse({ kind: 'replay', conversation: v4Conversation(mutation) }, scope, 200), undefined, JSON.stringify(mutation).slice(0, 80));
  }
  // Dedicated entry never accepts a non-primary v4 root, an unknown version, or legacy 1/2.
  assert.equal(gatewayModule.parseCoordinatorResolveResult({
    kind: 'resolved', created: false, ...rootIds, conversation: v4Conversation({ primaryOwnerRoot: false }),
  }, 200), undefined);
  assert.equal(gatewayModule.parseCoordinatorSetupResult({
    kind: 'setup_created', ...rootIds, profileId: 'profile-a', workspaceGeneration: 1, conversation: v4Conversation({ primaryOwnerRoot: false }),
  }, 201), undefined);
  assert.equal(gatewayModule.parseCoordinatorResolveResult({
    kind: 'resolved', created: false, ...rootIds, conversation: v4Conversation({ schemaVersion: 5 }),
  }, 200), undefined);
  assert.equal(gatewayModule.parseCoordinatorResolveResult({
    kind: 'resolved', created: false, ...rootIds, conversation: conversation(),
  }, 200), undefined);
  // v4 status requires the complete current context, never the relaxed legacy branch.
  const { coverage: _coverage, ...incomplete } = completeContext();
  assert.equal(parse({ kind: 'status', conversation: v4Conversation(), context: incomplete }, scope, 200), undefined);
  assert.equal(parse({ kind: 'status', conversation: v4Conversation(), context: { ...completeContext(), modelContext: null } }, scope, 200), undefined);
  assert.equal(gatewayModule.isDedicatedCoordinatorSchema(4), true);
  assert.equal(gatewayModule.isDedicatedCoordinatorSchema(3), true);
  for (const version of [1, 2, 5, '3', '4', undefined]) assert.equal(gatewayModule.isDedicatedCoordinatorSchema(version), false);
});

test('a schema 4 foreground acknowledgement uses a byte-equivalent request body and no schema field', async () => {
  const bodies = [];
  const gateway = gatewayModule.createLiveCoordinatorConversationGateway('http://local-api', async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { status: 200, json: async () => ({ kind: 'foreground_accepted', conversation: v4Conversation() }) };
  }, undefined, 'invented-signed-in-token');
  const result = await gateway.message({
    ...scope, expectedControlRevision: 1, commandKey: 'v4-command', message: 'Ask Rhythm what to do today',
  });
  assert.equal(result.kind, 'foreground_accepted');
  assert.deepEqual(bodies, [{
    sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1,
    commandKey: 'v4-command', message: 'Ask Rhythm what to do today',
  }]);
});
