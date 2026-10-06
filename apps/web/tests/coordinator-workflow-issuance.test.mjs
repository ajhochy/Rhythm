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

const set = (tree, label, value) => act(async () => {
  tree.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value, checked: value } });
});
const submitBtn = (tree) => tree.root.findByProps({ 'data-testid': 'coordinator-prepare-plan' });
const submit = (tree) => act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
const budgetAck = (tree) => act(async () => {
  tree.root.findAllByType('input').find((i) => i.props.type === 'checkbox' && !i.props['aria-label']).props.onChange({ target: { checked: true } });
});

// Test 1 harness needs the workflow fields hidden by default, so open without touching them.
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

test('workflow is not the default and existing purposes send byte-identical bodies', async () => {
  const consents = [];
  const tree = await openCard((_id, consent) => consents.push(consent));
  const select = tree.root.findByProps({ 'aria-label': 'Managed-work purpose' });
  assert.equal(select.props.value, 'decompose');
  assert.equal(tree.root.findAllByProps({ 'aria-label': 'Acknowledge coding workflow' }).length, 0);
  await budgetAck(tree);
  await submit(tree);
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

test('workflow selected without acknowledgement or reference disables send and issues nothing', async () => {
  const consents = [];
  const tree = await openCard((_id, consent) => consents.push(consent));
  await budgetAck(tree);
  await selectPurpose(tree, 'workflow');
  const ack = () => tree.root.findByProps({ 'aria-label': 'Acknowledge coding workflow' });
  assert.equal(ack().props.checked, false);
  assert.equal(submitBtn(tree).props.disabled, true);
  await set(tree, 'Selected reference ID', 'src-1');
  await set(tree, 'Selected reference version', 'v1');
  assert.equal(submitBtn(tree).props.disabled, true); // reference set, ack still off
  await submit(tree);
  assert.deepEqual(consents, []);
  await act(async () => { tree.unmount(); });
});

test('acknowledged workflow with a reference yields exactly one request with the exact DTO; a pending fence blocks a second', async () => {
  const consents = [];
  const tree = await openCard((_id, consent) => consents.push(consent));
  await budgetAck(tree);
  await selectPurpose(tree, 'workflow');
  await set(tree, 'Selected reference ID', ' src-1 ');
  await set(tree, 'Selected reference version', 'v1');
  await act(async () => { tree.root.findByProps({ 'aria-label': 'Acknowledge coding workflow' }).props.onChange({ target: { checked: true } }); });
  assert.equal(submitBtn(tree).props.disabled, false);
  await submit(tree);
  assert.equal(consents.length, 1);

  const requests = [];
  const controller = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conv() }),
    status: async () => ({ kind: 'status', conversation: conv(), context: null }),
    message: async () => { throw new Error('no'); },
    preparePlan: async (input) => { requests.push(input); throw new Error('response lost'); },
  }), createMemoryCoordinatorConversationJournal());
  const scope = { actorKey: 'user:7', projectId: 'project-a', sessionId: 'root-a' };
  await controller.open(scope);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await controller.preparePlan(scope, 'goal-a', consents[0]), false); // wire failed, attempt pending
  assert.equal(await controller.preparePlan(scope, 'goal-a', consents[0]), false); // fence
  assert.equal(requests.length, 1);

  const { bodies, gw } = wire();
  await gw.preparePlan({ sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a', admission: requests[0].admission }).catch(() => {});
  assert.equal(JSON.stringify(bodies), JSON.stringify([{
    sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a',
    admission: {
      commandKey: requests[0].admission.commandKey, ...base, purpose: 'workflow',
      acknowledgesCodingWorkflowCoverage: true,
      workflowCheck: { kind: 'selected_reference_summary_v1', sourceId: 'src-1', expectedVersion: 'v1' },
    },
  }]));
  // controller refuses an unacknowledged workflow consent outright
  const refused = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conv() }),
    status: async () => ({ kind: 'status', conversation: conv(), context: null }),
    preparePlan: async () => { throw new Error('must not reach wire'); },
  }), createMemoryCoordinatorConversationJournal());
  await refused.open(scope);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await refused.preparePlan(scope, 'goal-a', { ...base, purpose: 'workflow' }), false);
  await act(async () => { tree.unmount(); });
});
