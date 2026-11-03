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
  assert.equal(input.props.placeholder, 'Message Rhythm about your work…');
  assert.doesNotMatch(input.props.placeholder, /this project/i);
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

test('the Details → Runs panel lists each coding run and goals waiting to start, with no planning form', async () => {
  // Regressions caught: a run without its status/branch/tokens, a started goal
  // listed again as waiting, or the retired "Plan this goal" form coming back.
  const run = (goalId, status, branch, totalTokens, reported) => ({
    goalId, objective: `fix ${goalId}`, repoPath: '/repo', childSessionId: `child-${goalId}`, worktreePath: '/wt', branch,
    status, reported, usage: { totalTokens, inputTokens: 0, outputTokens: 0, cost: 0 },
  });
  const goals = ['a', 'b', 'c'].map((id) => ({ id, commandKey: id, objective: `fix ${id}`, state: 'captured', linkedWorkstreamId: null, revision: 1 }));
  const state = {
    enabled: true, phase: 'ready',
    conversation: { schemaVersion: 4, id: 'conversation', sessionId: 'root', projectId: 'project', controlRevision: 1, primaryOwnerRoot: true, goals },
    runs: [run('a', 'finished', 'opencode/goal-a', 78830, true), run('b', 'needs_you', 'opencode/goal-b', 1200, false)],
  };
  const opened = [];
  let tree;
  await act(async () => {
    tree = create(React.createElement(cardModule.exports.CoordinatorConversationCard, {
      state, onRefresh: blank, onRetry: blank, onReviewConflict: blank,
      onBeginNewMessageAfterReview: blank, onReturnToNormal: blank,
      onOpenRun: (id) => opened.push(id), onCancelRun: async () => true,
    }));
  });
  const text = JSON.stringify(tree.toJSON());
  assert.match(text, /Finished/);
  assert.match(text, /opencode\/goal-a · 78,830 tokens · reported in chat/);
  assert.match(text, /Needs you/);
  assert.match(text, /Waiting to start/);
  assert.equal(tree.root.findByProps({ 'aria-label': 'Goals waiting to start' }).findAllByType('li').length, 1);
  assert.doesNotMatch(text, /Plan this goal/);
  // A waiting run says so and opens its own session; only active runs can be stopped.
  assert.match(text, /Needs you — open to answer/);
  assert.equal(tree.root.findAllByProps({ 'data-testid': 'coordinator-run-stop' }).length, 1);
  await act(async () => { tree.root.findAllByProps({ 'data-testid': 'coordinator-run-open' })[0].props.onClick(); });
  assert.deepEqual(opened, ['child-b']);
  // Stop asks inline (no native dialog) before cancelling.
  const cancelled = [];
  await act(async () => { tree.update(React.createElement(cardModule.exports.CoordinatorConversationCard, {
    state, onRefresh: blank, onRetry: blank, onReviewConflict: blank, onBeginNewMessageAfterReview: blank, onReturnToNormal: blank,
    onOpenRun: blank, onCancelRun: async (goalId) => { cancelled.push(goalId); return true; },
  })); });
  await act(async () => { tree.root.findByProps({ 'data-testid': 'coordinator-run-stop' }).props.onClick(); });
  assert.deepEqual(cancelled, []);
  await act(async () => { tree.root.findByProps({ 'data-testid': 'coordinator-run-stop-confirm' }).props.onClick(); });
  assert.deepEqual(cancelled, ['b']);
  await act(async () => { tree.unmount(); });
});
