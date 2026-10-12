import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const requireFromWeb = createRequire(new URL('../package.json', import.meta.url));
const requireFromMobile = createRequire(new URL('../../mobile/package.json', import.meta.url));
const ts = requireFromWeb('typescript');
const React = requireFromMobile('react');

// Minimal CommonJS loader for the real source files (controller, gateway, journal).
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
const { CoordinatorConversationController } = load('components/use-coordinator-conversation.ts');
const { createLiveCoordinatorConversationGateway } = load('gateway/coordinator-conversations.ts');
const { createMemoryCoordinatorConversationJournal } = load('gateway/coordinator-conversation-journal.ts');

const goal = { id: 'goal-a', commandKey: 'k', objective: 'Ship it', state: 'captured', linkedWorkstreamId: null, revision: 1 };
const conv = (rev = 1) => ({
  schemaVersion: 3, id: 'c', sessionId: 'root-a', projectId: 'project-a', controlRevision: rev,
  primaryOwnerRoot: true, ownerUserId: 7, commandDedupe: [], goals: [goal], continuations: [],
});
const base = { totalTokenAuthorization: 20000, maxTurns: 1, maxWallTimeSeconds: 90, expiresInSeconds: 900, acknowledgesSoftTotalTokenAuthorization: true };

test('remaining finite purposes send byte-identical prepare-plan bodies', async () => {
  const bodies = [];
  const gw = createLiveCoordinatorConversationGateway('http://local-api', async (_u, init) => {
    bodies.push(JSON.parse(init.body));
    return { status: 500, json: async () => ({}) };
  }, undefined, 'tok');
  const consents = [{ ...base, purpose: 'decompose' }, { ...base, purpose: 'execute', acknowledgesScopedWorkspaceExecution: true }];
  for (const consent of consents) {
    await gw.preparePlan({ sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a', admission: { ...consent, commandKey: 'ck' } }).catch(() => {});
  }
  assert.equal(JSON.stringify(bodies), JSON.stringify(consents.map((consent) => ({
    sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a', admission: { commandKey: 'ck', ...consent },
  }))));
});

test('the controller refuses the retired workflow purpose before the wire', async () => {
  const refused = new CoordinatorConversationController(() => ({
    open: async () => ({ kind: 'replay', conversation: conv() }),
    status: async () => ({ kind: 'status', conversation: conv(), context: null }),
    preparePlan: async () => { throw new Error('must not reach wire'); },
  }), createMemoryCoordinatorConversationJournal());
  const scope = { actorKey: 'user:7', projectId: 'project-a', sessionId: 'root-a' };
  await refused.open(scope);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await refused.preparePlan(scope, 'goal-a', { ...base, purpose: 'workflow' }), false);
});
