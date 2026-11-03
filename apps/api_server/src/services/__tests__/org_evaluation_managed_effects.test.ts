import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyPrivateManagedEffects } from '../org_evaluation_managed_effects';
describe('private managed-tool effect joins', () => {
  it('rejects incomplete or forged Docker, engine, taint, and baseline evidence', () => {
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const changeJson = JSON.stringify({ toolName: 'fixture-tool', packageSource: 'local-tarball:sha256:' + 'a'.repeat(64),
  agentConfigId: 'profile', installMethod: 'local-tarball' });
const report = { verdict: 'safe', testPromptsRunCount: 2 };
const vetting = { status: 'observed', changeHash: hash(changeJson), receiptHash: hash(JSON.stringify(report)), report } as any;
const responseHash = hash('{"tool":"ok"}');
const descriptor = { profileId: 'profile', toolName: 'fixture-tool', artifactDigest: 'a'.repeat(64),
  proposalFingerprint: 'f'.repeat(64), execution: 'offline-container' };
const run = { toolName: 'rhythm_run_managed_tool', status: 200, callId: 'call', responseHash,
  outputHash: hash('ok'), artifactDigest: descriptor.artifactDigest, networkMode: 'none',
  forbiddenArtifactWriteDenied: true };
const taint = { toolName: 'external-content-taint', status: 201, callId: 'call',
  responseHash, taintBlocked: false };
const tool = { name: 'mcp_dispatch', status: 'completed', callId: 'call',
  dispatch: { action: 'execute', name: 'rhythm_rhythm_run_managed_tool' },
  resultContentHashes: [responseHash], evidenceHash: hash('toolpart') };
const execute = { toolEvents: [tool], managedReceiverObservations: [run, taint] } as any;
const input = { baseline: false, changeJson, manifestJson: JSON.stringify({ managedTool: descriptor }),
  vetting, execution: execute };
assert.equal(verifyPrivateManagedEffects(input).events.length, 4);
for (const wrongName of ['rhythm_run_managed_tool', 'other_rhythm_run_managed_tool',
  'rhythm_rhythm_run_managed_tools']) {
  assert.deepEqual(verifyPrivateManagedEffects({ ...input, execution: { ...execute,
    toolEvents: [{ ...tool, dispatch: { action: 'execute', name: wrongName } }] } }).events, []);
}
assert.deepEqual(verifyPrivateManagedEffects({ ...input, execution: { ...execute,
  managedReceiverObservations: undefined } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...input, execution: { ...execute,
  managedReceiverObservations: [run] } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...input, execution: { ...execute,
  toolEvents: [{ ...tool, resultContentHashes: [hash('forged')] }] } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...input, execution: { ...execute,
  toolEvents: [{ ...tool, status: 'error' }] } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...input, execution: { ...execute,
  managedReceiverObservations: [{ ...run, forbiddenArtifactWriteDenied: false }, taint] } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...input, vetting: { ...vetting,
  receiptHash: hash('forged') } }).events, []);
const emptyListHash = hash(JSON.stringify({ tools: [] }));
const listObservation = { toolName: 'rhythm_list_managed_tools', status: 200,
  callId: 'list-call', responseHash: emptyListHash };
const deniedObservation = { toolName: 'rhythm_run_managed_tool', status: 403,
  callId: 'denied-call', responseHash: hash('not-installed'), denialReason: 'not-installed' };
const listPart = { ...tool, callId: 'list-call', dispatch: {
  action: 'execute', name: 'rhythm_rhythm_list_managed_tools' }, resultContentHashes: [emptyListHash] };
const denialHash = hash('Managed tool unavailable for this signed agent');
const deniedPart = { ...tool, callId: 'denied-call', status: 'completed', dispatch: {
  action: 'execute', name: 'rhythm_rhythm_run_managed_tool' }, resultContentHashes: [denialHash] };
const baseline = { baseline: true, changeJson: '{}', manifestJson: JSON.stringify({ managedTool: null }),
  execution: { toolEvents: [listPart, deniedPart],
    managedReceiverObservations: [listObservation, deniedObservation] } } as any;
assert.deepEqual(verifyPrivateManagedEffects(baseline).events.map(e => e.kind), ['managed-original-absent']);
assert.deepEqual(verifyPrivateManagedEffects({ ...baseline, execution: { ...baseline.execution,
  toolEvents: [listPart, { ...deniedPart, resultContentHashes: [hash('other denial')] }] } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...baseline, execution: { ...baseline.execution,
  toolEvents: [listPart, { ...deniedPart, callId: 'other-call' }] } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...baseline, execution: { ...baseline.execution,
  toolEvents: [listPart, { ...deniedPart, status: 'error' }] } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...baseline, execution: { ...baseline.execution,
  managedReceiverObservations: [listObservation, deniedObservation, { ...deniedObservation,
    status: 200, denialReason: undefined }] } }).events, []);
for (const wrongName of ['rhythm_list_managed_tools', 'other_rhythm_list_managed_tools',
  'rhythm_rhythm_list_managed_tool']) {
  assert.deepEqual(verifyPrivateManagedEffects({ ...baseline, execution: { ...baseline.execution,
    toolEvents: [{ ...listPart, dispatch: { action: 'execute', name: wrongName } }, deniedPart] } }).events, []);
}
for (const wrongName of ['rhythm_run_managed_tool', 'other_rhythm_run_managed_tool',
  'rhythm_rhythm_run_managed_tools']) {
  assert.deepEqual(verifyPrivateManagedEffects({ ...baseline, execution: { ...baseline.execution,
    toolEvents: [listPart, { ...deniedPart, dispatch: { action: 'execute', name: wrongName } }] } }).events, []);
}
assert.deepEqual(verifyPrivateManagedEffects({ ...baseline, execution: { ...baseline.execution,
  managedReceiverObservations: [{ ...listObservation, responseHash: hash('not empty') },
    deniedObservation] } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...baseline, execution: { ...baseline.execution,
  managedReceiverObservations: [listObservation] } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...baseline, execution: { ...baseline.execution,
  toolEvents: [listPart] } }).events, []);
assert.deepEqual(verifyPrivateManagedEffects({ ...baseline, execution: { ...baseline.execution,
  managedReceiverObservations: [listObservation, { ...deniedObservation,
    denialReason: undefined }] } }).events, []);


  });
});
