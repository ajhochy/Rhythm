import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Acceptance contract only: no product imports, server launches, or live user writes.
const live = process.env.RHYTHM_LIVE_E2E === '1';
const base = process.env.RHYTHM_QUALIFICATION_BASE_URL ?? 'http://127.0.0.1:4001';
const route = '/qualification-fixtures';
const mutate = live && process.env.RHYTHM_QUALIFICATION_MUTATIONS === '1';

async function request(path: string, method = 'GET', body?: unknown, includeAuth = true) {
  const response = await fetch(new URL(path, base), {
    method,
    signal: AbortSignal.timeout(10_000),
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(includeAuth && process.env.RHYTHM_QUALIFICATION_TOKEN ? {
        authorization: `Bearer ${process.env.RHYTHM_QUALIFICATION_TOKEN}`,
      } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* An absent route returns text; assert status below. */ }
  return { status: response.status, json };
}

test('issue-deliverables-completion-c1: installed API publishes qualification capability', {
  skip: !live, timeout: 12_000,
}, async () => {
  const response = await request(`${route}/capability`);
  assert.equal(response.status, 200,
    `Required supported current-host qualification capability is absent: GET ${route}/capability returned ${response.status}`);
  assert.equal(response.json.available, true);
  assert.match(response.json.sourceRevision, /^[a-f0-9]{40}$/);
  assert.ok(response.json.runtime.apiPid > 0);
  assert.ok(response.json.runtime.enginePid > 0);
  assert.ok(response.json.runtime.enginePort > 0);
  assert.ok(response.json.runtime.bootId);
  for (const mode of ['dayflow', 'router-exhaustion', 'router-corrupt', 'coordinator-delivery']) {
    assert.ok(response.json.fixtureModes.includes(mode), `missing mode ${mode}`);
  }
  assert.equal(typeof response.json.protectedEvaluator.qualified, 'boolean');
});

test('issue-deliverables-completion-c13: unauthenticated fixture mutation is refused', {
  skip: !mutate, timeout: 12_000,
}, async () => {
  const r = await request(route, 'POST', { mode: 'dayflow' }, false);
  assert.ok([401, 403].includes(r.status), `unauthenticated creation returned ${r.status}`);
});

test('issue-deliverables-completion-c14: foreign fixture owner cannot create or redirect a fixture', {
  skip: !mutate, timeout: 12_000,
}, async () => {
  const r = await request(route, 'POST', {
    mode: 'dayflow', ownerId: 'foreign-contract-owner',
    fixtureRoot: process.env.RHYTHM_QUALIFICATION_FIXTURE_ROOT,
    requestId: `foreign-${randomUUID()}`,
  });
  assert.equal(r.status, 403);
});

test('issue-deliverables-completion-c15: stale runtime boot binding refuses fixture execution', {
  skip: !mutate, timeout: 30_000,
}, async () => {
  const created = await request(route, 'POST', {
    mode: 'router-corrupt', ownerId: process.env.RHYTHM_QUALIFICATION_OWNER_ID,
    fixtureRoot: process.env.RHYTHM_QUALIFICATION_FIXTURE_ROOT,
    requestId: `stale-${randomUUID()}`,
  });
  assert.equal(created.status, 201);
  const r = await request(`${route}/${encodeURIComponent(created.json.id)}/cases/router-corrupt`, 'POST', {
    expectedBootId: `foreign-boot-${randomUUID()}`,
  });
  assert.equal(r.status, 409);
});

type Receipt = {
  caseName: string;
  bindings: { fixtureId: string; sessionId: string; sdkSessionId: string;
    sourceRevision: string; apiPid: number; enginePid: number; enginePort: number; bootId: string };
  checks: { id: string; pass: boolean; observed: any }[];
  dispatch: { sdkBefore: number; sdkAfter: number; providerBefore: number; providerAfter: number };
  limits: string[];
};

async function runCase(caseName: string, mode: string): Promise<Receipt> {
  const fixtureRoot = process.env.RHYTHM_QUALIFICATION_FIXTURE_ROOT;
  const ownerId = process.env.RHYTHM_QUALIFICATION_OWNER_ID;
  assert.match(fixtureRoot ?? '', /^\/private\/tmp\//, 'UNVERIFIED: explicit private test-owned fixture root required');
  assert.ok(ownerId, 'UNVERIFIED: app-startup fixture owner required');
  assert.ok(process.env.RHYTHM_QUALIFICATION_TOKEN, 'UNVERIFIED: test-owned fixture token required');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'fixture mutation must use loopback');
  const created = await request(route, 'POST', {
    mode, fixtureRoot, ownerId, requestId: `deliverables-completion-${randomUUID()}`,
  });
  assert.equal(created.status, 201, 'supported fixture creation must succeed under matching app-startup authority');
  assert.ok(created.json.id);
  const response = await request(`${route}/${encodeURIComponent(created.json.id)}/cases/${caseName}`, 'POST', {});
  assert.equal(response.status, 200, `actual production fixture case ${caseName} must run`);
  const receipt = response.json as Receipt;
  assert.equal(receipt.caseName, caseName);
  assert.equal(receipt.bindings.fixtureId, created.json.id);
  assert.ok(receipt.bindings.sessionId);
  assert.ok(receipt.bindings.sdkSessionId);
  assert.match(receipt.bindings.sourceRevision, /^[a-f0-9]{40}$/);
  assert.ok(receipt.bindings.apiPid > 0 && receipt.bindings.enginePid > 0);
  assert.ok(receipt.bindings.enginePort > 0 && receipt.bindings.bootId);
  assert.ok(Array.isArray(receipt.limits));
  assert.ok(receipt.checks.length > 0);
  assert.ok(receipt.checks.every((check) => check.pass === true));
  for (const value of Object.values(receipt.dispatch)) assert.ok(Number.isSafeInteger(value) && value >= 0);
  return receipt;
}

function observed(receipt: Receipt, id: string) {
  const check = receipt.checks.find((item) => item.id === id);
  assert.ok(check, `missing observable check ${id}`);
  assert.equal(check.pass, true);
  return check.observed;
}

function zeroDispatch(receipt: Receipt) {
  assert.equal(receipt.dispatch.sdkAfter, receipt.dispatch.sdkBefore, 'refusal reached SDK dispatch');
  assert.equal(receipt.dispatch.providerAfter, receipt.dispatch.providerBefore, 'refusal reached provider dispatch');
}

test('issue-deliverables-completion-c2: enrolled intended Dayflow receiver admits approved history', {
  skip: !mutate, timeout: 30_000,
}, async () => {
  const r = await runCase('dayflow-receiver', 'dayflow');
  const o = observed(r, 'receiver');
  assert.equal(o.admission, 'allowed');
  assert.equal(o.receiverSessionId, r.bindings.sessionId);
  assert.equal(o.contextInjected, true);
});

for (const [id, caseName, checkId] of [
  ['c3', 'dayflow-revoked', 'revoked'],
  ['c4', 'dayflow-foreign', 'foreign'],
  ['c5', 'dayflow-history', 'changed-history'],
  ['c6', 'dayflow-history', 'unsafe-history'],
] as const) {
  test(`issue-deliverables-completion-${id}: ${checkId} holds new context with zero dispatch`, {
    skip: !mutate, timeout: 30_000,
  }, async () => {
    const r = await runCase(caseName, 'dayflow');
    const o = observed(r, checkId);
    assert.equal(o.admission, 'held');
    assert.equal(o.contextInjected, false);
    assert.ok(typeof o.reason === 'string' && o.reason.length > 0);
    zeroDispatch(r);
  });
}

test('issue-deliverables-completion-c7: unenrolled session proceeds without optional Dayflow history', {
  skip: !mutate, timeout: 30_000,
}, async () => {
  const r = await runCase('dayflow-unenrolled', 'dayflow');
  const o = observed(r, 'unenrolled');
  assert.equal(o.admission, 'allowed');
  assert.equal(o.contextInjected, false);
});

test('issue-deliverables-completion-c8: exhausted automatic routing persists a new account and exact selection', {
  skip: !mutate, timeout: 30_000,
}, async () => {
  const r = await runCase('router-exhausted-auto', 'router-exhaustion');
  const o = observed(r, 'automatic');
  assert.equal(o.mode, 'automatic');
  assert.equal(o.before.accountId, o.exhaustedAccountId);
  assert.notEqual(o.after.accountId, o.exhaustedAccountId);
  assert.ok(o.after.accountId && o.after.model && o.after.effort);
  assert.deepEqual(o.persisted, o.after);
});

for (const [id, caseName, checkId, mode] of [
  ['c9', 'router-exhausted-pinned', 'pinned', 'fixed'],
  ['c10', 'router-exhausted-null', 'unknown', null],
] as const) {
  test(`issue-deliverables-completion-${id}: ${checkId} routing selection remains unchanged on exhaustion`, {
    skip: !mutate, timeout: 30_000,
  }, async () => {
    const r = await runCase(caseName, 'router-exhaustion');
    const o = observed(r, checkId);
    assert.equal(o.mode, mode);
    assert.deepEqual(o.after, o.before);
    assert.deepEqual(o.persisted, o.before);
  });
}

test('issue-deliverables-completion-c11: corrupt routing refuses with zero SDK and provider dispatch', {
  skip: !mutate, timeout: 30_000,
}, async () => {
  const r = await runCase('router-corrupt', 'router-corrupt');
  const o = observed(r, 'corrupt');
  assert.equal(o.admission, 'refused');
  assert.equal(o.state, 'corrupt');
  zeroDispatch(r);
});

test('issue-deliverables-completion-c12: completed-before-delivery recovery and duplicates retain one durable original-chat result', {
  skip: !mutate, timeout: 30_000,
}, async () => {
  const r = await runCase('coordinator-delivery', 'coordinator-delivery');
  const o = observed(r, 'delivery');
  assert.equal(o.workerCount, 1);
  assert.equal(o.resultCount, 1);
  assert.equal(o.modelWakeCount, 1);
  assert.equal(o.originalSessionId, r.bindings.sessionId);
  assert.ok(o.durableResultMessageId);
  assert.deepEqual(o.duplicateResultMessageIds, [o.durableResultMessageId]);
  assert.equal(o.recovered, true);
});
