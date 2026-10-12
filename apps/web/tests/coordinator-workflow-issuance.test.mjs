import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const requireFromWeb = createRequire(new URL('../package.json', import.meta.url));
const requireFromMobile = createRequire(new URL('../../mobile/package.json', import.meta.url));
const ts = requireFromWeb('typescript');
const React = requireFromMobile('react');
const { act, create } = requireFromMobile('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Minimal CommonJS loader for the real source files (card, controller, gateway, journal).
const cache = new Map();
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports;
  const url = new URL(rel, new URL('../src/', import.meta.url));
  const mod = { exports: {} };
  cache.set(rel, mod);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return requireFromMobile('react/jsx-runtime');
    if (id.endsWith('.css')) return {};
    if (id.startsWith('.')) {
      const parts = (dir + id).split('/');
      const out = [];
      for (const part of parts) { if (part === '..') out.pop(); else if (part !== '.') out.push(part); }
      return load(out.join('/') + '.ts');
    }
    throw new Error('Unexpected import ' + id);
  }, mod, mod.exports);
  return mod.exports;
}
const { CoordinatorConversationCard } = load('components/CoordinatorConversationCard.tsx');
const { CoordinatorConversationController } = load('components/use-coordinator-conversation.ts');
const { createLiveCoordinatorConversationGateway } = load('gateway/coordinator-conversations.ts');
const { createMemoryCoordinatorConversationJournal } = load('gateway/coordinator-conversation-journal.ts');

const blank = () => {};
const goal = { id: 'goal-a', commandKey: 'k', objective: 'Ship it', state: 'captured', linkedWorkstreamId: null, revision: 1 };
const conv = (rev = 1) => ({
  schemaVersion: 3, id: 'c', sessionId: 'root-a', projectId: 'project-a', controlRevision: rev,
  primaryOwnerRoot: true, ownerUserId: 7, commandDedupe: [], goals: [goal], continuations: [],
});
const cardState = { enabled: true, phase: 'ready', conversation: conv() };

const submit = (tree) => act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
const budgetAck = (tree) => act(async () => {
  tree.root.findAllByType('input').find((i) => i.props.type === 'checkbox' && !i.props['aria-label']).props.onChange({ target: { checked: true } });
});

async function openCard(onPreparePlan) {
  let tree;
  await act(async () => {
    tree = create(React.createElement(CoordinatorConversationCard, {
      state: cardState, onRefresh: blank, onRetry: blank, onReviewConflict: blank,
      onBeginNewMessageAfterReview: blank, onReturnToNormal: blank, onInspectWorkstream: blank, onPreparePlan,
    }));
  });
  await act(async () => { tree.root.findByProps({ children: 'Plan this goal' }).props.onClick(); });
  return tree;
}
const selectPurpose = (tree, value) => act(async () => {
  tree.root.findByProps({ 'aria-label': 'Managed-work purpose' }).props.onChange({ target: { value } });
});

function wire(consentList) {
  const bodies = [];
  const gw = createLiveCoordinatorConversationGateway('http://local-api', async (_u, init) => {
    bodies.push(JSON.parse(init.body));
    return { status: 500, json: async () => ({}) };
  }, undefined, 'tok');
  return { bodies, gw };
}
const base = { totalTokenAuthorization: 20000, maxTurns: 1, maxWallTimeSeconds: 90, expiresInSeconds: 900, acknowledgesSoftTotalTokenAuthorization: true };

test('existing purposes send byte-identical bodies', async () => {
  const consents = [];
  const tree = await openCard((_id, consent) => consents.push(consent));
  const select = tree.root.findByProps({ 'aria-label': 'Managed-work purpose' });
  assert.equal(select.props.value, 'decompose');
  await budgetAck(tree);
  await submit(tree);
  // A submitted consent form closes; another start needs the goal reopened.
  assert.equal(tree.root.findAllByProps({ 'data-testid': 'coordinator-prepare-plan' }).length, 0);
  await act(async () => { tree.root.findByProps({ children: 'Plan this goal' }).props.onClick(); });
  await selectPurpose(tree, 'execute');
  await act(async () => {
    tree.root.findAllByType('input').filter((i) => i.props.type === 'checkbox')[1].props.onChange({ target: { checked: true } });
  });
  await submit(tree);
  assert.deepEqual(consents, [
    { ...base, purpose: 'decompose' },
    { ...base, purpose: 'execute', acknowledgesScopedWorkspaceExecution: true },
  ]);
  const { bodies, gw } = wire();
  for (const consent of consents) {
    await gw.preparePlan({ sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a', admission: { ...consent, commandKey: 'ck' } }).catch(() => {});
  }
  const expected = [
    { sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a', admission: { commandKey: 'ck', ...base, purpose: 'decompose' } },
    { sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a', admission: { commandKey: 'ck', ...base, purpose: 'execute', acknowledgesScopedWorkspaceExecution: true } },
  ];
  assert.equal(JSON.stringify(bodies), JSON.stringify(expected));
  await act(async () => { tree.unmount(); });
});

test('the retired workflow purpose is not offered and the controller refuses it', async () => {
  const tree = await openCard(blank);
  const options = tree.root.findByProps({ 'aria-label': 'Managed-work purpose' }).findAllByType('option').map((o) => o.props.value);
  assert.deepEqual(options, ['decompose', 'continue', 'execute']);
  const refused = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conv() }),
    status: async () => ({ kind: 'status', conversation: conv(), context: null }),
    preparePlan: async () => { throw new Error('must not reach wire'); },
  }), createMemoryCoordinatorConversationJournal());
  const scope = { actorKey: 'user:7', projectId: 'project-a', sessionId: 'root-a' };
  await refused.open(scope);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await refused.preparePlan(scope, 'goal-a', { ...base, purpose: 'workflow' }), false);
  await act(async () => { tree.unmount(); });
});

test('an open consent form cannot start again once the goal is linked; finished runs are view-only and honest', async () => {
  const consents = [];
  const tree = await openCard((_id, consent) => consents.push(consent));
  const linked = { ...conv(2), goals: [{ ...goal, state: 'linked', linkedWorkstreamId: 'ws-1' }], continuations: [{ authorizationId: 'a', goalId: 'goal-a', workstreamId: 'ws-1', status: 'consumed', maxTurns: 1, consumedTurns: 1, expiresAt: '2026-10-11T00:00:00.000Z', purpose: 'decompose' }] };
  const props = { onRefresh: blank, onRetry: blank, onReviewConflict: blank, onBeginNewMessageAfterReview: blank, onReturnToNormal: blank, onInspectWorkstream: blank, onPreparePlan: (_id, consent) => consents.push(consent) };
  const running = { workstream: { id: 'ws-1', state: 'running', lastJobId: 'j' }, readiness: { available: true }, jobs: [{ id: 'j', state: 'running' }], budget: { actualTokens: 0, authorizedTokens: 20000 } };
  await act(async () => { tree.update(React.createElement(CoordinatorConversationCard, { ...props, state: { ...cardState, conversation: linked, plannedWorkstream: running } })); });
  // Old card: the form stayed mounted with an enabled Start button after the goal linked.
  assert.equal(tree.root.findAllByProps({ 'data-testid': 'coordinator-prepare-plan' }).length, 0);
  const text = () => JSON.stringify(tree.toJSON());
  assert.match(text(), /Managed run in progress/);
  assert.match(text(), /Read-only planning run/);
  assert.doesNotMatch(text(), /0 actual/);
  const finished = { ...running, workstream: { ...running.workstream, state: 'ready' }, jobs: [{ id: 'j', state: 'succeeded', usage: { totalTokens: 2031 }, application: { status: 'quarantined' } }], budget: { actualTokens: 2031, authorizedTokens: 20000 } };
  await act(async () => { tree.update(React.createElement(CoordinatorConversationCard, { ...props, state: { ...cardState, conversation: linked, plannedWorkstream: finished } })); });
  assert.match(text(), /Finished managed run — view only/);
  assert.match(text(), /2,031 actual tokens/);
  assert.match(text(), /quarantined/);
  assert.equal(consents.length, 0);
  await act(async () => { tree.unmount(); });
});
