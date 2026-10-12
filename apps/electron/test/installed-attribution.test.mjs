import assert from 'node:assert/strict';
import test from 'node:test';
import { NATIVE_GAP, nativeCronMetadata, nativeTriggerReceipts, pendingMetadata, receipt, redactedOrigin, surface, triggerLane } from './installed-attribution.mjs';
import { routeFor } from './installed-attribution-proxy.mjs';

test('attribution cannot confuse native Hermes, outer schedules, tasks, or labels', () => {
  assert.equal(surface('rhythm://app/index.html#/hermes'), 'outer-rhythm');
  assert.equal(surface('file:///fixture/hermes-desktop/renderer/index.html'), 'embedded-hermes-candidate');
  assert.equal(surface('https://example.invalid/renderer/index.html'), 'unattributed');
  assert.equal(triggerLane('POST', '/api/cron/jobs/synthetic-id/trigger'), 'hermes-native-cron');
  assert.equal(triggerLane('POST', '/agent-schedules/synthetic-id/trigger-now'), 'rhythm-schedule');
  for (const path of ['/tasks/synthetic-id', '/Org Optimize', '/api/cron/jobs/id/trigger?token=secret']) assert.equal(triggerLane('POST', path), null);
  assert.equal(triggerLane('GET', '/api/cron/jobs/id/trigger'), null);
});
test('receipts redact origins and never serialize approval payload or nonce', () => {
  const origin = redactedOrigin('https://user:password@example.invalid/agent-approvals?token=secret');
  assert.match(origin, /^https:\/\/sha256:[a-f0-9]{16}$/);
  assert.equal(origin, redactedOrigin('https://example.invalid/other'));
  const rows = pendingMetadata([
    { id: 'owned', status: 'pending', sessionId: null, decisionNonce: 'secret', preview: 'sensitive' },
    { id: 'unrelated', status: 'pending' },
  ], ['owned']);
  assert.deepEqual(rows, [{ id: 'owned', status: 'pending', sessionId: null }]);
  assert.throws(() => pendingMetadata({ rows: [] }, []), /non-array/);
});
test('partial evidence cannot silently qualify installed cases', () => {
  const out = receipt();
  assert.equal(out.status, 'BLOCKED');
  assert.equal(out.installedQualified, false);
  assert.ok(out.cases.every(c => c.status === 'not-run'));
  assert.deepEqual(out.reportedPendingIds, { status: 'pending', queried: false });
  assert.match(NATIVE_GAP, /^UNVERIFIED:.*main-process fetch/);
});

test('native cron fixture requires an isolated local synthetic script job', () => {
  const owned = {
    profile: 'attribution-20261001-123e4567-e89b-42d3-a456-426614174000',
    connectionId: 'native-attribution-20261001-123e4567-e89b-42d3-a456-426614174000',
    jobId: 'a1b2c3d4e5f6',
    jobName: 'rhythm-native-attribution-20261001-123e4567-e89b-42d3-a456-426614174000',
    backendBase: 'http://127.0.0.1:15487',
    backendPid: 12345,
    proxyBase: 'http://127.0.0.1:15488',
    proxyPid: 12346,
    backendVersion: '0.1.0',
    profileHome: '/private/tmp/rhythm-native-owned/hermes/profiles/attribution-20261001-123e4567-e89b-42d3-a456-426614174000',
    proxyReceiptLog: '/private/tmp/rhythm-native-owned/proxy-receipts.jsonl',
  };
  assert.deepEqual(nativeCronMetadata(owned), owned);
  for (const bad of [
    { ...owned, connectionId: 'operational-remote' },
    { ...owned, profile: 'default' },
    { ...owned, jobName: 'Org Optimize' },
    { ...owned, backendBase: 'http://127.0.0.1:4096' },
    { ...owned, proxyBase: 'http://127.0.0.1:4001' },
    { ...owned, backendVersion: '' },
  ]) assert.throws(() => nativeCronMetadata(bad));
});

test('native backend POST receipts require the exact synthetic job and report actual status', () => {
  const log = [
    JSON.stringify({ method: 'GET', route: 'job-runs', jobId: 'a1b2c3d4e5f6', upstreamStatus: 200 }),
    JSON.stringify({ method: 'POST', route: 'synthetic-trigger', jobId: 'other', upstreamStatus: 200 }),
    JSON.stringify({ method: 'POST', route: 'synthetic-trigger', jobId: 'a1b2c3d4e5f6', upstreamStatus: 409 }),
  ].join('\n');
  assert.deepEqual(nativeTriggerReceipts(log, 'a1b2c3d4e5f6'), [{ status: 409 }]);
  assert.throws(() => nativeTriggerReceipts(log, 'Org Optimize'));
});

test('owned proxy admits only read-only metadata and the exact synthetic trigger', () => {
  const profile = 'attribution-20261001-123e4567-e89b-42d3-a456-426614174000';
  const job = 'a1b2c3d4e5f6';
  assert.deepEqual(routeFor('GET', `/api/health?rhythm_attribution=123e4567-e89b-42d3-a456-426614174000&profile=${profile}`, profile, job),
    { route: 'health', marker: '123e4567-e89b-42d3-a456-426614174000' });
  assert.deepEqual(routeFor('GET', `/api/cron/jobs?profile=${profile}`, profile, job), { route: 'job-inventory' });
  assert.deepEqual(routeFor('GET', `/api/cron/jobs/${job}/runs?limit=20&profile=${profile}`, profile, job), { route: 'job-runs', jobId: job });
  assert.deepEqual(routeFor('POST', `/api/cron/jobs/${job}/trigger?profile=${profile}`, profile, job), { route: 'synthetic-trigger', jobId: job });
  for (const [method, path] of [
    ['POST', '/api/cron/jobs'], ['POST', `/api/cron/jobs/other/trigger?profile=${profile}`],
    ['POST', `/api/cron/jobs/${job}/trigger?profile=default`],
    ['DELETE', `/api/cron/jobs/${job}?profile=${profile}`],
    ['GET', 'http://evil.test/api/status'], ['GET', '//evil.test/api/status'],
  ]) assert.equal(routeFor(method, path, profile, job), null);
});
