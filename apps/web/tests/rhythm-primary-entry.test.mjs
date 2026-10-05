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
const jsxRuntime = requireFromMobile('react/jsx-runtime');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = {
  location: { hash: '#/agents' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  setTimeout, clearTimeout,
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
  getElementById() { return null; }, activeElement: null,
};
globalThis.CustomEvent = class {
  constructor(type, options) { this.type = type; this.detail = options?.detail; }
};

const source = await readFile(new URL('../src/components/AgentsWorkspace.tsx', import.meta.url), 'utf8');
const workspaceModule = { exports: {} };

let fixtureState;
let gateway;
let fixtureRerender;
let selectLiveSessionOverride;
let coordinatorInitialState;
let coordinatorOpenOverride;

function blank() {}
function session(id, projectId, name) {
  return {
    id, projectId, name, profileId: 'profile-a', status: 'idle', group: 'active', cwd: `/fixture/${id}`,
    branch: 'main', dirtyCount: 0, isolateWorktree: false, messages: [], artifacts: [],
    completedAt: undefined, parentId: undefined, connectionState: 'online', pendingAttachments: [],
    permissionMode: 'default', thinkingBudget: '0', fastMode: false, createdAt: '2026-10-05T16:00:00.000Z',
  };
}

const specialistProfileChoices = [
  { id: 'profile-coding-workflow', label: 'Coding Workflow' },
  { id: 'profile-workflow-retrospective', label: 'Workflow Retrospective' },
  { id: 'profile-worship-planning', label: 'Worship Planning' },
  { id: 'profile-worship-production', label: 'Worship Production' },
  { id: 'profile-theological-researcher', label: 'Theological Researcher' },
];

function useFixtures() {
  const [, rerender] = React.useState(0);
  fixtureRerender = rerender;
  return {
    ...fixtureState,
    selectLiveSession: selectLiveSessionOverride ?? (async (id) => {
      fixtureState = { ...fixtureState, selected: fixtureState.sessions.find((item) => item.id === id) };
      rerender((value) => value + 1);
    }),
  };
}

function coordinatorScopeForRootChat(input) {
  if (input.mode !== 'live' || !input.writable || input.parentSessionId || !input.sessionId || !input.projectId) return null;
  return { actorKey: input.actorKey, sessionId: input.sessionId, projectId: input.projectId };
}

function SessionRail({ onOpenRhythm, rhythmOpening }) {
  return React.createElement('button', {
    type: 'button', onClick: onOpenRhythm, disabled: rhythmOpening,
    'data-testid': 'rhythm-primary-entry',
  }, rhythmOpening ? 'Opening Rhythm…' : 'Rhythm');
}

function FocusDialog({ open, children, testId }) {
  return open ? React.createElement('section', { 'data-testid': testId }, children) : null;
}

function Transcript({ coordinatorStatus, coordinatorTranscript }) {
  return React.createElement('div', null, coordinatorStatus,
    coordinatorTranscript?.messages?.map((message) => React.createElement('p', { key: message.id }, message.rawText)));
}

function Composer({ coordinator }) {
  return React.createElement('input', { 'data-testid': 'composer-input', 'data-coordinator-active': coordinator?.active ? 'true' : 'false' });
}

function CoordinatorConversationCard() {
  return React.createElement('section', { 'data-testid': 'coordinator-conversation-card' }, 'Coordination');
}

function coordinatorView(scope, enabled, phase) {
  const conversation = enabled ? {
    schemaVersion: 3,
    primaryOwnerRoot: true,
    sessionId: scope?.sessionId,
    projectId: scope?.projectId,
  } : undefined;
  return {
    enabled,
    phase,
    conversation,
    canonicalHistory: enabled ? {
      conversation, messages: [], hasMore: false,
    } : undefined,
  };
}

function useCoordinatorConversation(scope) {
  const [state, setState] = React.useState(() => coordinatorInitialState ?? coordinatorView(scope, false, 'inactive'));
  const open = React.useCallback(async () => {
    if (!scope) return false;
    gateway.__coordinatorOpenCalls += 1;
    if (coordinatorOpenOverride) return coordinatorOpenOverride({ scope, setState });
    setState(coordinatorView(scope, true, 'ready'));
    return true;
  }, [scope]);
  return {
    state,
    open, refresh: async () => false, retry: async () => false, retryPlan: async () => false,
    preparePlan: async () => false, continuePlan: async () => false, reviewConflict: async () => false,
    beginNewMessageAfterReview: blank, returnToNormal: blank, loadOlderHistory: async () => false,
  };
}

const imports = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  '../icons': { Icon: () => null },
  '../sessionState': {
    isSessionOffline: () => false,
    sessionPresentation: (item) => item.status === 'error'
      ? { tone: 'error', label: 'Error', waiting: false }
      : { tone: 'idle', label: 'Idle', waiting: false },
  },
  '../store': { emptyLiveProfile: () => ({ id: '', label: 'Profile', icon: 'AG' }), useFixtures },
  './Composer': { Composer },
  './FocusDialog': { FocusDialog },
  './Inspector': { Inspector: () => null },
  './Profiles': { ProfileAvatar: () => null },
  './RemoteComputers': { RemoteComputers: () => null },
  './SessionRail': { SessionRail },
  './Splitter': { Splitter: () => null },
  './Transcript': { Transcript, formatCost: () => '$0.00' },
  './WorkstreamsPanel': { WorkstreamsPanel: () => null },
  '../pending-decisions': { usePendingDecisions: () => ({ permissions: new Map(), questions: new Map() }) },
  '../gateway/sessions': {
    mapMessage: (message) => ({ ...message, id: String(message.id) }),
    sessionLabel: (item) => ({ label: item.name, fallback: false }),
    accountOptionLabel: (item) => item.label,
  },
  '../agentNotifications': { emitAgentNotification: blank },
  '../gateway/auth': { useAuthUser: () => ({ user: { id: 4189 } }) },
  '../gateway/context': { useGateway: () => gateway },
  '../gateway/coordinator-conversations': { coordinatorScopeForRootChat },
  './CoordinatorConversationCard': { CoordinatorConversationCard },
  './use-coordinator-conversation': { useCoordinatorConversation },
  '../gateway/user-preferences': {
    matchSwitchSessionKey: () => false, matchesCancelTurnKey: () => false, matchesNewSessionKey: () => false,
    readLocalUserPreferences: () => ({}), USER_PREFERENCES_CHANGED_EVENT: 'test:preferences',
  },
};

new Function('require', 'module', 'exports', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(
  (id) => {
    if (Object.hasOwn(imports, id)) return imports[id];
    throw new Error('Unexpected AgentsWorkspace test import: ' + id);
  },
  workspaceModule,
  workspaceModule.exports,
);

function setup(mode = 'single') {
  selectLiveSessionOverride = undefined;
  coordinatorInitialState = undefined;
  coordinatorOpenOverride = undefined;
  const ordinary = session('ordinary-root', 'project-ordinary', 'Ordinary chat');
  const rhythm = session('rhythm-root', 'project-rhythm', 'Rhythm');
  const calls = { resolve: 0, resolveInputs: [], setup: [], ordinaryPrompt: 0 };
  fixtureState = {
    selected: mode === 'existing' ? rhythm : ordinary, sessions: [ordinary, rhythm], profiles: [{ id: 'profile-a', label: 'Current profile', enabled: true, selectable: true }],
    models: [], accounts: [], openaiAccounts: [], refreshCatalog: async () => {}, sessionGatewayMode: 'live',
    saveSessionSettings: blank, connectionMessage: 'Session loaded', liveSessionError: null, loading: false,
    summarizeSession: async () => false, prepareLiveSession: async () => false, startFreshSession: async () => false,
    reconnectLiveSession: async () => {}, updateSession: blank, archiveSession: blank, resumeSession: blank,
    selectSession: blank, createSession: blank, createLiveSession: async () => '', cancelSession: blank, notify: blank,
    sendInput: () => { calls.ordinaryPrompt += 1; }, sendLiveInput: () => { calls.ordinaryPrompt += 1; },
    resumeGone: null, liveChildView: null, closeLiveChildView: blank,
  };
  gateway = {
    mode: 'live', __coordinatorOpenCalls: 0,
    domains: {
      coordinatorConversations: {
        resolve: async (input) => {
          calls.resolve += 1;
          calls.resolveInputs.push({ ...input });
          if (mode === 'existing') {
            return {
              kind: 'resolved', sessionId: rhythm.id, projectId: rhythm.projectId,
              conversation: { id: 'conversation-rhythm', sessionId: rhythm.id, projectId: rhythm.projectId, primaryOwnerRoot: true, goals: [] },
            };
          }
          return { kind: 'setup_unavailable' };
        },
        setup: async (input) => {
          calls.setup.push({ ...input });
          if (mode === 'multiple' && input.profileId === undefined) {
            return { kind: 'setup_profile_choice_required', profileChoices: specialistProfileChoices };
          }
          if (mode === 'retry' && calls.setup.length === 1) return { kind: 'setup_unavailable' };
          return {
            kind: 'setup_created', sessionId: rhythm.id, projectId: rhythm.projectId, profileId: input.profileId ?? 'profile-a', workspaceGeneration: 1,
            conversation: { schemaVersion: 3, id: 'conversation-rhythm', sessionId: rhythm.id, projectId: rhythm.projectId, controlRevision: 1, primaryOwnerRoot: true, goals: [] },
          };
        },
      },
    },
  };
  return { calls, rhythm };
}

async function settle() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function entry(tree) {
  return tree.root.findByProps({ 'data-testid': 'rhythm-primary-entry' });
}

test('rendered primary entry immediately advances setup, opens only the server-returned root, and does not submit an ordinary prompt', async () => {
  const { calls, rhythm } = setup();
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  assert.equal(calls.resolve, 1);
  assert.equal(calls.setup.length, 1);
  assert.deepEqual(Object.keys(calls.setup[0]).sort(), ['commandKey']);
  assert.equal(fixtureState.selected.id, rhythm.id);
  assert.equal(gateway.__coordinatorOpenCalls, 1);
  assert.equal(calls.ordinaryPrompt, 0);
  assert.equal(tree.root.findByProps({ 'data-testid': 'composer-input' }).props['data-coordinator-active'], 'true');
  await act(async () => { tree.unmount(); });
});

test('rendered primary entry requires the offered profile choice and reuses its stable setup key', async () => {
  const { calls, rhythm } = setup('multiple');
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  const dialog = tree.root.findByProps({ 'data-testid': 'rhythm-setup-dialog' });
  assert.ok(dialog);
  const choiceList = tree.root.findByProps({ 'data-testid': 'rhythm-setup-choice-list' });
  assert.equal(choiceList.props.role, 'group');
  assert.equal(choiceList.findAllByType('button').length, specialistProfileChoices.length);
  assert.ok(tree.root.findByProps({ 'data-testid': 'rhythm-setup-footer' }));
  await act(async () => { tree.root.findByProps({ 'data-testid': 'rhythm-setup-profile-profile-worship-production' }).props.onClick(); await settle(); });
  assert.equal(fixtureState.selected.id, rhythm.id);
  assert.deepEqual(calls.setup.map((input) => input.profileId), [undefined, 'profile-worship-production']);
  assert.equal(calls.setup[0].commandKey, calls.setup[1].commandKey);
  await act(async () => { tree.unmount(); });
});

test('keeping ordinary chat closes setup but reopens the same server-offered profile choices without another setup call', async () => {
  const { calls } = setup('multiple');
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  assert.ok(tree.root.findByProps({ 'data-testid': 'rhythm-setup-dialog' }));
  await act(async () => { tree.root.findByProps({ 'data-testid': 'rhythm-setup-keep-ordinary' }).props.onClick(); await settle(); });
  assert.equal(tree.root.findAllByProps({ 'data-testid': 'rhythm-setup-dialog' }).length, 0);
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  assert.ok(tree.root.findByProps({ 'data-testid': 'rhythm-setup-dialog' }));
  assert.equal(calls.setup.length, 1);
  assert.equal(calls.ordinaryPrompt, 0);
  await act(async () => { tree.unmount(); });
});

test('rendered setup failure is actionable and retries the exact setup key', async () => {
  const { calls, rhythm } = setup('retry');
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  assert.ok(tree.root.findByProps({ 'data-testid': 'rhythm-setup-dialog' }));
  await act(async () => { tree.root.findByProps({ 'data-testid': 'rhythm-setup-retry' }).props.onClick(); await settle(); });
  assert.equal(fixtureState.selected.id, rhythm.id);
  assert.equal(calls.setup.length, 2);
  assert.deepEqual(calls.setup[1], calls.setup[0]);
  await act(async () => { tree.unmount(); });
});

test('synchronous repeated primary-entry clicks admit one resolve/setup operation', async () => {
  const { calls } = setup();
  let release;
  gateway.domains.coordinatorConversations.resolve = () => {
    calls.resolve += 1;
    return new Promise((resolve) => { release = () => resolve({ kind: 'setup_unavailable' }); });
  };
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); entry(tree).props.onClick(); });
  assert.equal(calls.resolve, 1);
  await act(async () => { release(); await settle(); });
  assert.equal(calls.setup.length, 1);
  await act(async () => { tree.unmount(); });
});

test('an already-selected server root still opens the coordinator history and composer', async () => {
  const { calls, rhythm } = setup('existing');
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  assert.equal(calls.resolve, 1);
  assert.equal(calls.setup.length, 0);
  assert.equal(fixtureState.selected.id, rhythm.id);
  assert.equal(gateway.__coordinatorOpenCalls, 1);
  assert.equal(calls.ordinaryPrompt, 0);
  assert.equal(tree.root.findByProps({ 'data-testid': 'composer-input' }).props['data-coordinator-active'], 'true');
  assert.match(String(tree.root.findByProps({ 'data-testid': 'rhythm-primary-status' }).children.join('')), /Rhythm is ready/);
  await act(async () => { tree.unmount(); });
});

test('startup hydration to the exact resolved primary root is not treated as a selection change', async () => {
  const { calls, rhythm } = setup('existing');
  let releaseResolve;
  gateway.domains.coordinatorConversations.resolve = () => {
    calls.resolve += 1;
    return new Promise((resolve) => {
      releaseResolve = () => resolve({
        kind: 'resolved', sessionId: rhythm.id, projectId: rhythm.projectId,
        conversation: { id: 'conversation-rhythm', sessionId: rhythm.id, projectId: rhythm.projectId, primaryOwnerRoot: true, goals: [] },
      });
    });
  };
  // A fresh renderer can paint an unqualified placeholder before the catalog
  // supplies the already server-owned root. The resolve is still in flight.
  fixtureState = { ...fixtureState, selected: session('', '', 'Loading Rhythm') };
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  assert.equal(calls.resolve, 1);
  await act(async () => {
    fixtureState = { ...fixtureState, selected: rhythm };
    fixtureRerender((value) => value + 1);
    await settle();
  });
  await act(async () => { releaseResolve(); await settle(); });
  assert.equal(fixtureState.selected.id, rhythm.id);
  assert.equal(gateway.__coordinatorOpenCalls, 1);
  assert.equal(calls.ordinaryPrompt, 0);
  const status = String(tree.root.findByProps({ 'data-testid': 'rhythm-primary-status' }).children.join(''));
  assert.match(status, /Rhythm is ready/);
  assert.doesNotMatch(status, /selection changed|could not be opened/);
  await act(async () => { tree.unmount(); });
});

test('a ready already-selected root does not start a stale detail navigation or repaint its entry as failed', async () => {
  const { calls, rhythm } = setup('existing');
  let detailCalls = 0;
  selectLiveSessionOverride = async () => {
    detailCalls += 1;
    throw new Error('an already-selected canonical root needs no second detail handoff');
  };
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  assert.equal(detailCalls, 0);
  assert.equal(calls.resolve, 1);
  assert.equal(gateway.__coordinatorOpenCalls, 1);
  const status = String(tree.root.findByProps({ 'data-testid': 'rhythm-primary-status' }).children.join(''));
  assert.match(status, /Rhythm is ready/);
  assert.doesNotMatch(status, /could not be opened|selection changed/);
  await act(async () => { tree.unmount(); });
});

test('an SDK-less current root stays Opening through reconciliation, then returns Ready without a failed entry notice', async () => {
  const { rhythm } = setup('existing');
  rhythm.status = 'error';
  rhythm.sdkSessionId = undefined;
  let releaseReconciliation;
  const reconciliation = new Promise((resolve) => { releaseReconciliation = resolve; });
  coordinatorInitialState = coordinatorView({ sessionId: rhythm.id, projectId: rhythm.projectId }, true, 'ready');
  coordinatorOpenOverride = async ({ scope, setState }) => {
    setState(coordinatorView(scope, true, 'refreshing'));
    await reconciliation;
    setState(coordinatorView(scope, true, 'ready'));
    return true;
  };
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  const headerStatus = tree.root.findAll((node) => typeof node.props.className === 'string' && node.props.className.includes('status-label'))[0];
  assert.match(headerStatus.props.className, /idle/);
  assert.match(String(headerStatus.children.join('')), /Opening/);
  assert.doesNotMatch(String(headerStatus.children.join('')), /Error/);
  const openingNotice = String(tree.root.findByProps({ 'data-testid': 'rhythm-primary-status' }).children.join(''));
  assert.match(openingNotice, /Opening Rhythm/);
  assert.doesNotMatch(openingNotice, /could not be opened|Rhythm is ready/);
  await act(async () => { releaseReconciliation(); await settle(); });
  const settledHeader = tree.root.findAll((node) => typeof node.props.className === 'string' && node.props.className.includes('status-label'))[0];
  assert.match(String(settledHeader.children.join('')), /Ready/);
  const settledNotice = String(tree.root.findByProps({ 'data-testid': 'rhythm-primary-status' }).children.join(''));
  assert.match(settledNotice, /Rhythm is ready/);
  assert.doesNotMatch(settledNotice, /could not be opened/);
  await act(async () => { tree.unmount(); });
});

test('a server-owned primary root remains the opened conversation after changing ordinary project selection', async () => {
  const { calls, rhythm } = setup('existing');
  const other = session('ordinary-other-root', 'project-other', 'Another ordinary chat');
  fixtureState = { ...fixtureState, sessions: [...fixtureState.sessions, other], selected: other };
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  assert.deepEqual(calls.resolveInputs, [{ projectId: 'project-other' }]);
  assert.equal(fixtureState.selected.id, rhythm.id);
  assert.equal(gateway.__coordinatorOpenCalls, 1);
  assert.equal(tree.root.findByProps({ 'data-testid': 'composer-input' }).props['data-coordinator-active'], 'true');
  await act(async () => { tree.unmount(); });
});

test('the temporary empty row while a fresh server root detail loads does not cancel the primary handoff', async () => {
  const { calls, rhythm } = setup();
  let releaseRootDetail;
  const rootDetail = new Promise((resolve) => { releaseRootDetail = resolve; });
  selectLiveSessionOverride = async (id) => {
    assert.equal(id, rhythm.id);
    fixtureState = {
      ...fixtureState,
      sessions: fixtureState.sessions.filter((item) => item.id !== rhythm.id),
      selected: session('', '', 'Loading Rhythm'),
    };
    fixtureRerender((value) => value + 1);
    await rootDetail;
    fixtureState = { ...fixtureState, sessions: [...fixtureState.sessions, rhythm], selected: rhythm };
    fixtureRerender((value) => value + 1);
  };
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  const status = tree.root.findByProps({ 'data-testid': 'rhythm-primary-status' });
  assert.match(String(status.children.join('')), /Setting up|Opening Rhythm/);
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Rhythm selection changed/);
  await act(async () => { releaseRootDetail(); await settle(); });
  assert.equal(fixtureState.selected.id, rhythm.id);
  assert.equal(calls.setup.length, 1);
  assert.equal(gateway.__coordinatorOpenCalls, 1);
  await act(async () => { tree.unmount(); });
});

test('a real third-chat selection during root detail loading fences the late primary handoff', async () => {
  const { calls, rhythm } = setup();
  const other = session('other-root', 'project-other', 'Other chat');
  let releaseRootDetail;
  const rootDetail = new Promise((resolve) => { releaseRootDetail = resolve; });
  selectLiveSessionOverride = async (id) => {
    assert.equal(id, rhythm.id);
    fixtureState = {
      ...fixtureState,
      sessions: fixtureState.sessions.filter((item) => item.id !== rhythm.id),
      selected: session('', '', 'Loading Rhythm'),
    };
    fixtureRerender((value) => value + 1);
    await rootDetail;
    // The detail cache may publish the requested root after the user has
    // selected another chat, but it must not steal the current selection.
    fixtureState = { ...fixtureState, sessions: [...fixtureState.sessions, rhythm] };
    fixtureRerender((value) => value + 1);
  };
  let tree;
  await act(async () => { tree = create(React.createElement(workspaceModule.exports.AgentsWorkspace)); });
  await act(async () => { entry(tree).props.onClick(); await settle(); });
  await act(async () => {
    fixtureState = { ...fixtureState, sessions: [...fixtureState.sessions, other], selected: other };
    fixtureRerender((value) => value + 1);
    await settle();
  });
  assert.match(String(tree.root.findByProps({ 'data-testid': 'rhythm-primary-status' }).children.join('')), /selection changed/);
  await act(async () => { releaseRootDetail(); await settle(); });
  assert.equal(fixtureState.selected.id, other.id);
  assert.equal(calls.setup.length, 1);
  assert.equal(gateway.__coordinatorOpenCalls, 0);
  assert.doesNotMatch(String(tree.root.findByProps({ 'data-testid': 'rhythm-primary-status' }).children.join('')), /Opening Rhythm/);
  await act(async () => { tree.unmount(); });
});
