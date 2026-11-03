import assert from 'node:assert/strict';
import test from 'node:test';

import { managedRunView } from '../src/components/managed-run-view.ts';
import { permissionSupersededByTool } from '../src/components/permission-superseded.ts';

const running = { workstream: { id: 'w', state: 'running', lastJobId: 'j' }, jobs: [{ id: 'j', state: 'running', usage: null }], budget: { actualTokens: 0, authorizedTokens: 20000 } };
const quarantined = {
  workstream: { id: 'w', state: 'ready', stateReason: 'result_quarantined_requires_receipt', lastJobId: 'j' },
  jobs: [{ id: 'j', state: 'succeeded', usage: { totalTokens: 2031 }, application: { status: 'quarantined', reason: 'read_only_result_requires_authoritative_criterion_receipt' } }],
  budget: { actualTokens: 2031, authorizedTokens: 20000 },
};

test('an active run blocks new starts and never reports zero as actual usage', () => {
  const view = managedRunView(running, 'decompose');
  assert.equal(view.active, true);
  assert.equal(view.state, 'Running');
  assert.match(view.usage, /not reported until the worker finishes/);
  assert.doesNotMatch(view.usage, /\b0 actual/);
});

test('a finished quarantined planning run reports real usage, quarantine, and read-only kind', () => {
  const view = managedRunView(quarantined, 'decompose');
  assert.equal(view.active, false);
  assert.match(view.state, /^Finished/);
  assert.match(view.usage, /2,031 actual tokens of 20,000 authorized/);
  assert.match(view.result, /quarantined/i);
  assert.match(view.result, /unverified/);
  assert.match(view.kind, /Read-only planning run/);
  assert.match(view.kind, /not approved coding execution/);
  assert.doesNotMatch(managedRunView(quarantined, 'workflow').kind, /Read-only/);
});

test('an unknown worker outcome stays blocking and asks for review', () => {
  const view = managedRunView({ ...running, workstream: { ...running.workstream, state: 'unknown' }, jobs: [{ id: 'j', state: 'unknown' }] });
  assert.equal(view.active, true);
  assert.equal(view.state, 'Needs review');
});

test('a permission card is superseded only when the same tool completed and none is still in flight', () => {
  const block = (name, status) => ({ tool: { name, status } });
  const ask = { tool: 'bash' };
  assert.equal(permissionSupersededByTool(ask, [{ blocks: [block('bash', 'completed')] }]), true);
  assert.equal(permissionSupersededByTool(ask, [{ blocks: [block('bash', 'completed')] }, { blocks: [block('bash', 'running')] }]), false);
  assert.equal(permissionSupersededByTool(ask, [{ blocks: [block('read', 'completed')] }]), false);
  assert.equal(permissionSupersededByTool(ask, [{ blocks: [block('bash', 'error')] }]), false);
  assert.equal(permissionSupersededByTool({ tool: '' }, [{ blocks: [block('bash', 'completed')] }]), false);
});
