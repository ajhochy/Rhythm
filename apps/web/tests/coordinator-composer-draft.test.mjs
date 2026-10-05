import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const requireFromWeb = createRequire(new URL('package.json', root));
const requireFromMobile = createRequire(new URL('../mobile/package.json', root));
const ts = requireFromWeb('typescript');
const React = requireFromMobile('react');
const { act, create } = requireFromMobile('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CustomEvent = class {
  constructor(type, options) {
    this.type = type;
    this.detail = options?.detail;
  }
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  setTimeout,
  clearTimeout,
};
globalThis.document = { addEventListener() {}, removeEventListener() {} };

const coordinatorSource = await readFile(new URL('../src/components/use-coordinator-conversation.ts', import.meta.url), 'utf8');
const coordinatorModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(coordinatorSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(
  (id) => id === 'react' ? React : {},
  coordinatorModule,
  coordinatorModule.exports,
);

const composerSource = await readFile(new URL('../src/components/Composer.tsx', import.meta.url), 'utf8');
const composerModule = { exports: {} };
let fixtureState;
const blank = () => {};
const gateway = { domains: { commands: { list: async () => [] } } };
const imports = {
  react: React,
  'react/jsx-runtime': requireFromMobile('react/jsx-runtime'),
  '../composerSeed': { takeComposerSeed: () => undefined },
  '../icons': { Icon: () => null },
  '../gateway/context': { useGateway: () => gateway },
  '../gateway/auth': { useAuthUser: () => ({ user: { id: 1 } }) },
  '../gateway/user-preferences': {
    readLocalUserPreferences: () => ({ sendKey: 'Enter' }),
    sendMessageKeyLabel: () => '',
    matchesSendMessageKey: () => false,
    USER_PREFERENCES_CHANGED_EVENT: 'test:preferences',
  },
  '../sessionState': { isSessionOffline: () => false },
  '../store': { useFixtures: () => fixtureState },
  './FocusDialog': { FocusDialog: () => null },
  '../compressImage': { compressImageFile: async () => null },
  './use-coordinator-conversation': coordinatorModule.exports,
};
new Function('require', 'module', 'exports', ts.transpileModule(composerSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(
  (id) => {
    if (Object.hasOwn(imports, id)) return imports[id];
    throw new Error('Unexpected Composer test import: ' + id);
  },
  composerModule,
  composerModule.exports,
);

const cardSource = await readFile(new URL('../src/components/CoordinatorConversationCard.tsx', import.meta.url), 'utf8');
const cardModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(cardSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(
  (id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return requireFromMobile('react/jsx-runtime');
    if (id.endsWith('.css')) return {};
    throw new Error('Unexpected coordinator card test import: ' + id);
  },
  cardModule,
  cardModule.exports,
);

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function resetFixtures() {
  fixtureState = {
    selected: { id: 'root-a', profileId: 'profile-a', status: 'idle', group: 'active', pendingAttachments: [] },
    profiles: [], models: [], turnOverride: {}, sessionGatewayMode: 'live',
    notify: blank, saveSessionSettings: blank, stageTurnOverride: blank,
    sendInput: blank, sendLiveInput: blank, sendLiveCommand: blank,
    cancelSession: blank, reconnect: blank, updateSession: blank, runShell: blank,
  };
}

test('the rendered desktop composer preserves a newly edited identical draft after a late coordinator acknowledgement', async () => {
  resetFixtures();
  const late = deferred();
  let tree;
  await act(async () => {
    tree = create(React.createElement(composerModule.exports.Composer, {
      coordinator: { active: true, onSend: async () => late.promise },
    }));
  });
  const input = () => tree.root.findByProps({ 'data-testid': 'composer-input' });
  const edit = async (value) => {
    await act(async () => { input().props.onChange({ target: { value } }); });
  };
  await edit('Add a workstream: original');
  await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  await edit('intervening replacement');
  await edit('Add a workstream: original');
  await act(async () => { late.resolve({ accepted: true }); });
  assert.equal(input().props.value, 'Add a workstream: original');
  await act(async () => { tree.unmount(); });
});

test('a ready coordinator root remains composable after an SDK-less restart error and sends only through coordinator admission', async () => {
  resetFixtures();
  const coordinatorMessages = [];
  const ordinarySdkInputs = [];
  fixtureState = {
    ...fixtureState,
    selected: { ...fixtureState.selected, status: 'error', sdkSessionId: undefined },
    sendLiveInput: (...input) => ordinarySdkInputs.push(input),
  };
  let tree;
  await act(async () => {
    tree = create(React.createElement(composerModule.exports.Composer, {
      coordinator: {
        active: true,
        onSend: async (message) => { coordinatorMessages.push(message); return { accepted: true }; },
      },
    }));
  });
  const input = tree.root.findByProps({ 'data-testid': 'composer-input' });
  assert.equal(input.props.disabled, false);
  assert.equal(tree.root.findByProps({ 'data-testid': 'composer-send' }).props.disabled, false);
  assert.equal(tree.root.findByProps({ 'data-testid': 'composer-live-file-input' }).props.disabled, true);
  await act(async () => { input.props.onChange({ target: { value: 'What should I do today?' } }); });
  await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); await Promise.resolve(); });
  assert.deepEqual(coordinatorMessages, ['What should I do today?']);
  assert.deepEqual(ordinarySdkInputs, []);
  await act(async () => { tree.unmount(); });
});

test('an ordinary SDK-less error session remains disabled without coordinator authority', async () => {
  resetFixtures();
  const ordinarySdkInputs = [];
  fixtureState = {
    ...fixtureState,
    selected: { ...fixtureState.selected, status: 'error', sdkSessionId: undefined },
    sendLiveInput: (...input) => ordinarySdkInputs.push(input),
  };
  let tree;
  await act(async () => { tree = create(React.createElement(composerModule.exports.Composer)); });
  assert.equal(tree.root.findByProps({ 'data-testid': 'composer-input' }).props.disabled, true);
  assert.equal(tree.root.findByProps({ 'data-testid': 'composer-send' }).props.disabled, true);
  assert.match(JSON.stringify(tree.toJSON()), /This run has ended/);
  await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); await Promise.resolve(); });
  assert.deepEqual(ordinarySdkInputs, []);
  await act(async () => { tree.unmount(); });
});

test('the rendered desktop coordinator card keeps details collapsed while surfacing holds without opaque workstream IDs', async () => {
  const availability = { state: 'available' };
  const state = {
    enabled: true,
    phase: 'ready',
    conversation: { schemaVersion: 1, id: 'conversation', sessionId: 'root', projectId: 'project', controlRevision: 1, goals: [] },
    context: {
      timeZone: 'America/Los_Angeles', asOf: '2026-10-05T00:00:00Z', today: '2026-10-05', yesterday: '2026-10-04',
      availability: { tasks: availability, schedules: availability, workstreams: availability, receipts: availability, manualActivity: availability },
      todayTasks: [], waitingForReply: [], doneWithUnknownCompletionDate: [], scheduledPriorities: [],
      activeWorkstreams: [{ id: 'opaque-workstream-id', state: 'running' }],
      executionSucceededGoalUnverified: [], staleExecutions: [], verifiedYesterday: [], receipts: [],
      usageHolds: [{ id: 'hold-1', workstreamId: 'opaque-workstream-id', jobId: 'job-1', actualUsage: { state: 'unknown' } }],
    },
  };
  let tree;
  await act(async () => {
    tree = create(React.createElement(cardModule.exports.CoordinatorConversationCard, {
      state, onRefresh: blank, onRetry: blank, onReviewConflict: blank,
      onBeginNewMessageAfterReview: blank, onReturnToNormal: blank, onInspectWorkstream: blank,
    }));
  });
  const details = tree.root.findByType('details');
  assert.equal(details.props.open, false);
  const text = JSON.stringify(tree.toJSON());
  assert.match(text, /Unknown usage — hold needs review/);
  assert.doesNotMatch(text, /opaque-workstream-id/);
  await act(async () => { details.props.onToggle({ currentTarget: { open: true } }); });
  assert.equal(tree.root.findByType('details').props.open, true);
  await act(async () => { tree.unmount(); });
});

test('the rendered desktop coordinator card exposes finite actions only for a schema v3 server root', async () => {
  const goal = {
    id: 'goal-a', commandKey: 'goal-command-a', objective: 'Prepare a finite plan',
    state: 'captured', linkedWorkstreamId: null, revision: 1,
  };
  const shared = {
    enabled: true,
    phase: 'ready',
    conversation: {
      id: 'conversation', sessionId: 'root', projectId: 'project', controlRevision: 1,
      primaryOwnerRoot: true, ownerUserId: 7, commandDedupe: [], goals: [goal],
      continuations: [{
        authorizationId: 'authority-a', goalId: 'goal-a', workstreamId: 'workstream-a',
        status: 'consumed', maxTurns: 2, consumedTurns: 1, expiresAt: '2026-10-05T12:00:00Z',
      }],
    },
  };
  const props = {
    onRefresh: blank, onRetry: blank, onReviewConflict: blank,
    onBeginNewMessageAfterReview: blank, onReturnToNormal: blank, onInspectWorkstream: blank,
    onPreparePlan: blank, onContinuePlan: blank,
  };
  let current;
  await act(async () => {
    current = create(React.createElement(cardModule.exports.CoordinatorConversationCard, {
      ...props,
      state: { ...shared, conversation: { ...shared.conversation, schemaVersion: 3 } },
    }));
  });
  const currentText = JSON.stringify(current.toJSON());
  assert.match(currentText, /Plan this goal/);
  assert.match(currentText, /Continue managed work/);

  let legacy;
  await act(async () => {
    legacy = create(React.createElement(cardModule.exports.CoordinatorConversationCard, {
      ...props,
      state: { ...shared, conversation: { ...shared.conversation, schemaVersion: 2 } },
    }));
  });
  const legacyText = JSON.stringify(legacy.toJSON());
  assert.doesNotMatch(legacyText, /Plan this goal/);
  assert.doesNotMatch(legacyText, /Continue managed work/);
  await act(async () => { current.unmount(); legacy.unmount(); });
});
