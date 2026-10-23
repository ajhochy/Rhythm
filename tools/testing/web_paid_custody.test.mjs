import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createQualificationFixture, readQualificationFixture } from './qualification_fixture.mjs';
import { assertQualificationModelLoan } from '../../apps/electron/src/qualification-model-loan.mjs';
import { assertInvocation, captureSourceHashes, assertSourceHashes, assertLoanWindow, issuePaidLoan,
  captureOwnedRoot, scrubOwnedRoot, assertSameProcess, watchdogReason, runPaidLifecycle,
  processIdentity, processIsAlive, stopExactProcess, watchOwnedChild } from './web_paid_custody.mjs';

const revision = 'a'.repeat(40), sourceSha256 = 'b'.repeat(64);
const identity = { checkoutRoot: '/private/tmp/explicit-test-checkout', sourceRevision: revision, sourceSha256 };
const invocation = { ...identity, caseIds: [91, 92], provider: 'openai' };
function scratch(t) {
  const root = mkdtempSync('/private/tmp/rhythm-web-paid-unit-');
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function syntheticLoan(t, { provider = 'openai', expires = Date.now() + 3_600_000 } = {}) {
  const root = scratch(t);
  const manifestPath = createQualificationFixture(revision, { hermesRuntimeRoot: null, hermesBackendArtifactRoot: null });
  const fixtureRoot = JSON.parse(readFileSync(manifestPath, 'utf8')).fixtureRoot;
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const sourceAccountsPath = join(root, 'accounts.json');
  writeFileSync(sourceAccountsPath, JSON.stringify({ version: 1, defaultAccountId: 'selected', routing: {}, pinned: {},
    accounts: [{ id: 'selected', label: 'synthetic source', access: 'synthetic-access-never-network', refresh: 'synthetic-refresh-must-not-copy',
      expires, status: 'ok', ...(provider === 'openai' ? { chatgptAccountId: 'synthetic-account' } : {}) },
    { id: 'unselected', label: 'synthetic unrelated', access: 'synthetic-unrelated-never-copy', refresh: '', expires, status: 'ok' }] }), { mode: 0o600 });
  const reviewedDecision = { backend: 'openai_decisions', openaiDecisions: { baseUrl: 'https://api.openai.com', model: 'gpt-6-luna' }, remoteDataConsent: true };
  const reviewedGrid = { version: 1, models: [], routing: {} };
  const sourceDecisionPath = join(root, 'decision.json'), sourceGridPath = join(root, 'grid.json');
  writeFileSync(sourceDecisionPath, JSON.stringify({ ...reviewedDecision, openaiDecisions: { ...reviewedDecision.openaiDecisions, apiKey: 'synthetic-decisions-never-network' } }), { mode: 0o600 });
  writeFileSync(sourceGridPath, JSON.stringify(reviewedGrid), { mode: 0o600 });
  return { manifestPath, expectedRevision: revision, provider, selectedAccountId: 'selected',
    sourceAccountsPath, sourceDecisionPath, sourceGridPath, reviewedDecision, reviewedGrid, fixtureRoot, expires };
}

test('custody-01 positive lifecycle builds and validates before issuance; canonical stop precedes scrub', async () => {
  const events = [];
  const adapters = {
    validate: async () => events.push('validate'), build: async () => events.push('build'),
    prepare: async () => { events.push('prepare'); return { owned: true }; },
    issue: async () => { events.push('issue'); return { stopAt: 500 }; },
    start: async () => events.push('start'), run: async () => { events.push('run'); return { exitCode: 0 }; },
    stop: async () => events.push('canonical-down'), scrub: async () => events.push('scrub'),
  };
  const result = await runPaidLifecycle(invocation, adapters);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(events, ['validate', 'build', 'prepare', 'issue', 'start', 'run', 'canonical-down', 'scrub']);
});

test('custody-02 exact checkout, revision, source, case and provider; environment override refused', () => {
  assertInvocation(invocation, identity, {});
  for (const changed of [{ checkoutRoot: '/private/tmp/foreign' }, { sourceRevision: 'c'.repeat(40) }, { sourceSha256: 'd'.repeat(64) },
    { caseIds: [72] }, { caseIds: [110, 91] }, { caseIds: [118], provider: 'openai' }, { provider: 'unknown' }]) {
    assert.throws(() => assertInvocation({ ...invocation, ...changed }, identity, {}), /custody invocation rejected/);
  }
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENCODE_CONFIG_DIR', 'RHYTHM_OPENAI_ACCOUNTS_FILE', 'RHYTHM_SANDBOX_ENGINE_DIR']) {
    assert.throws(() => assertInvocation(invocation, identity, { [key]: 'synthetic-inherited-value' }), /custody environment rejected/);
  }
});

test('custody-03 real provisioner projects one fake account without refresh, with ten minute cap', async t => {
  const options = syntheticLoan(t);
  const result = await issuePaidLoan(options);
  const { manifest } = readQualificationFixture(options.manifestPath, revision);
  const loan = assertQualificationModelLoan(manifest);
  const accountFile = JSON.parse(readFileSync(loan.accountPath, 'utf8'));
  assert.equal(accountFile.accounts.length, 1);
  assert.equal(accountFile.accounts[0].refresh, '');
  assert.equal(accountFile.accounts[0].id, 'qualification-model');
  assert.equal(accountFile.accounts[0].chatgptAccountId, 'synthetic-account');
  assert.equal(result.stopAt, loan.stopAt);
  assertLoanWindow(loan, Date.now());
  assert.ok(loan.stopAt <= loan.issuedAt + 600_000);
  assert.ok(loan.expires - loan.stopAt >= 1_200_000);
  assertSourceHashes(result.sourceHashes);
});

test('custody-03 expired and exactly thirty minute source fail before writing borrowed credentials', async t => {
  const now = Date.now();
  for (const expires of [now - 1, now + 1_800_000]) {
    const options = syntheticLoan(t, { expires });
    await assert.rejects(() => issuePaidLoan({ ...options, now }), /custody loan rejected/);
    assert.equal(existsSync(join(options.fixtureRoot, 'openai-accounts.json')), false);
  }
});

test('custody-03 Anthropic uses real access-only projection and same bounds', async t => {
  const options = syntheticLoan(t, { provider: 'anthropic' });
  const result = await issuePaidLoan(options);
  const { manifest } = readQualificationFixture(options.manifestPath, revision);
  const loan = assertQualificationModelLoan(manifest);
  assert.equal(loan.provider, 'anthropic');
  assert.equal(JSON.parse(readFileSync(loan.accountPath, 'utf8')).accounts[0].refresh, '');
  assert.equal(existsSync(join(options.fixtureRoot, 'decision-router.json')), false);
  assertLoanWindow(loan, Date.now());
  assertSourceHashes(result.sourceHashes);
});

test('custody-04 source bytes and owned inode changes fail closed', t => {
  const root = scratch(t), file = join(root, 'source.json');
  writeFileSync(file, '{"value":"synthetic"}', { mode: 0o600 });
  const snapshot = captureSourceHashes([file]);
  assertSourceHashes(snapshot);
  writeFileSync(file, '{"value":"changed"}');
  assert.throws(() => assertSourceHashes(snapshot), /custody source changed/);
  renameSync(file, `${file}.old`);
  writeFileSync(file, '{"value":"synthetic"}', { mode: 0o600 });
  assert.throws(() => assertSourceHashes(snapshot), /custody source changed/);
});

test('custody-04 real validator rejects account, Decision and Grid tampering', async t => {
  for (const target of ['openai-accounts.json', 'decision-router.json', 'router-grid.json']) {
    const options = syntheticLoan(t);
    await issuePaidLoan(options);
    const { manifest } = readQualificationFixture(options.manifestPath, revision);
    const file = join(options.fixtureRoot, target);
    writeFileSync(file, readFileSync(file, 'utf8') + ' ');
    if (target === 'openai-accounts.json') {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      parsed.accounts[0].access = 'synthetic-tamper';
      writeFileSync(file, JSON.stringify(parsed));
    }
    assert.throws(() => assertQualificationModelLoan(manifest));
  }
});

test('custody-07 deadline uses wall and monotonic time plus parent liveness', () => {
  const state = { now: 1000, monotonicNow: 200, issuedAt: 1000, stopAt: 601000, monotonicStart: 200, parentAlive: true };
  assert.equal(watchdogReason(state), null);
  assert.equal(watchdogReason({ ...state, now: 601000 }), 'deadline');
  assert.equal(watchdogReason({ ...state, now: 500, monotonicNow: 600200 }), 'deadline');
  assert.equal(watchdogReason({ ...state, parentAlive: false }), 'parent-exit');
  for (const loan of [{ issuedAt: 1000, stopAt: 601001, expires: 2000000 },
    { issuedAt: 1000, stopAt: 601000, expires: 1800999 }, { issuedAt: 1001, stopAt: 5000, expires: 2000000 }]) {
    assert.throws(() => assertLoanWindow(loan, 1000), /custody deadline rejected/);
  }
});

test('custody-08 process PID replacement refuses action despite matching executable', () => {
  const owner = { pid: 12345, start: 'synthetic-kernel-start', executable: '/explicit/node', uid: process.getuid() };
  assertSameProcess(owner, { ...owner });
  for (const changed of [{ pid: 12346 }, { start: 'replacement-start' }, { executable: '/foreign/node' }, { uid: -1 }]) {
    assert.throws(() => assertSameProcess(owner, { ...owner, ...changed }), /custody process changed/);
  }
});

test('custody-09 expired success or failure cleanup removes only exact-created root after stop', t => {
  const root = scratch(t), owned = captureOwnedRoot(root);
  writeFileSync(join(root, 'synthetic-secret.json'), '{"access":"synthetic-only"}', { mode: 0o600 });
  assert.throws(() => scrubOwnedRoot(owned, { stopped: false, portsFree: true }), /custody cleanup refused/);
  assert.throws(() => scrubOwnedRoot(owned, { stopped: true, portsFree: false }), /custody cleanup refused/);
  assert.equal(existsSync(root), true);
  scrubOwnedRoot(owned, { stopped: true, portsFree: true });
  assert.equal(existsSync(root), false);
});

test('custody-09 replacement root is retained and startup/test failures still stop before scrub', async t => {
  const root = scratch(t), owned = captureOwnedRoot(root);
  renameSync(root, `${root}.old`); t.after(() => rmSync(`${root}.old`, { recursive: true, force: true }));
  assert.throws(() => scrubOwnedRoot(owned, { stopped: true, portsFree: true }), /custody cleanup refused/);
  for (const phase of ['issue', 'start', 'run']) {
    const events = [];
    const adapters = Object.fromEntries(['validate', 'build', 'prepare', 'issue', 'start', 'run', 'stop', 'scrub'].map(name => [name, async () => {
      events.push(name); if (name === phase) throw new Error('synthetic failure'); return {};
    }]));
    await assert.rejects(() => runPaidLifecycle(invocation, adapters), /custody run failed/);
    assert.deepEqual(events.slice(-2), ['stop', 'scrub']);
  }
});

test('custody-09 failed canonical stop prevents scrub; failed build never issues loan', async () => {
  for (const phase of ['build', 'stop']) {
    const events = [];
    const adapters = Object.fromEntries(['validate', 'build', 'prepare', 'issue', 'start', 'run', 'stop', 'scrub'].map(name => [name, async () => {
      events.push(name); if (name === phase) throw new Error('synthetic failure'); return {};
    }]));
    await assert.rejects(() => runPaidLifecycle(invocation, adapters), /custody (run|cleanup) failed/);
    assert.equal(events.includes('scrub'), false);
    if (phase === 'build') assert.equal(events.includes('issue'), false);
  }
});

test('custody-09 partial prepare retains creator authority for failure cleanup', async t => {
  let captured, stopped = false;
  const root = scratch(t);
  await assert.rejects(() => runPaidLifecycle(invocation, {
    validate: async () => {}, build: async () => {},
    prepare: async () => { captured = captureOwnedRoot(root); throw new Error('synthetic partial preparation'); },
    stop: async context => { assert.equal(context, undefined); stopped = true; },
    scrub: async () => scrubOwnedRoot(captured, { stopped, portsFree: true }),
  }), /custody run failed/);
  assert.equal(existsSync(root), false);
});

async function ownedChild(t) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } });
  const exited = once(child, 'exit');
  await once(child, 'spawn');
  const owner = processIdentity(child.pid);
  t.after(async () => { if (processIsAlive(child.pid)) await stopExactProcess(owner, { graceMs: 300 }); });
  return { owner, exited };
}
test('custody-07 real owned helper child is stopped on deadline without API or network', async t => {
  const child = await ownedChild(t), now = Date.now();
  let stopped;
  const result = await watchOwnedChild({ parent: processIdentity(process.pid), child: child.owner,
    loan: { issuedAt: now, stopAt: now + 150 }, monotonicStart: Number(process.hrtime.bigint() / 1_000_000n) },
  reason => { stopped = reason; }, { pollMs: 20 });
  await child.exited;
  assert.equal(result, 'deadline'); assert.equal(stopped, 'deadline');
  assert.equal(processIsAlive(child.owner.pid), false);
});
test('custody-07 real owned helper child is stopped when its captured parent exits', async t => {
  const parent = await ownedChild(t), child = await ownedChild(t), now = Date.now();
  await stopExactProcess(parent.owner, { graceMs: 300 }); await parent.exited;
  const result = await watchOwnedChild({ parent: parent.owner, child: child.owner,
    loan: { issuedAt: now, stopAt: now + 600_000 }, monotonicStart: Number(process.hrtime.bigint() / 1_000_000n) },
  () => {}, { pollMs: 20 });
  await child.exited;
  assert.equal(result, 'parent-exit'); assert.equal(processIsAlive(child.owner.pid), false);
});
