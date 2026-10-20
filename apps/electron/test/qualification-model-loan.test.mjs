import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createQualificationFixture, provisionQualificationFixtureModelLoan, readQualificationFixture } from '../../../tools/testing/qualification_fixture.mjs';
import {
  inspectQualificationModelAccounts,
  provisionQualificationModelLoan,
  assertQualificationModelLoan,
  armQualificationModelLoanDeadline,
} from '../src/qualification-model-loan.mjs';

const revision = 'a'.repeat(40);
const hash = (value) => createHash('sha256').update(value).digest('hex');
function setup(t, { expires = Date.now() + 45 * 60_000, status = 'ok', decisionKey = 'private-test-key' } = {}) {
  const sourceRoot = mkdtempSync('/private/tmp/rhythm-loan-source-');
  const manifestPath = createQualificationFixture(revision, { hermesRuntimeRoot: null });
  const fixtureRoot = dirname(manifestPath);
  t.after(() => { rmSync(sourceRoot, { recursive: true, force: true }); rmSync(fixtureRoot, { recursive: true, force: true }); });
  const accountsPath = join(sourceRoot, 'openai-accounts.json');
  const decisionsPath = join(sourceRoot, 'decision-router.json');
  const gridPath = join(sourceRoot, 'router-grid.json');
  const sourceAccount = { id: 'chosen', label: 'Personal', access: 'test-access', refresh: 'operator-refresh-never-copy', expires,
    status, chatgptAccountId: 'test-workspace', email: 'private@example.invalid' };
  const sourceAccounts = { version: 1, accounts: [sourceAccount, { ...sourceAccount, id: 'other', access: 'other-access' }],
    defaultAccountId: 'chosen', routing: { session: 'other' }, pinned: { session: true } };
  const reviewedDecision = { backend: 'openai_decisions', openaiDecisions: { baseUrl: 'https://api.openai.com', model: 'gpt-6-luna' },
    remoteDataConsent: true, features: { model_routing: 'on' }, routing: { engine: 'grid', scope: 'first_prompt' },
    tiers: { mode: 'auto', cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25 }, tierOverrides: {}, excludedModels: [] };
  const sourceDecision = { version: 1, ...reviewedDecision,
    openaiDecisions: { ...reviewedDecision.openaiDecisions, apiKey: decisionKey },
    custom: { apiKey: 'unselected-secret' } };
  const reviewedGrid = { version: '1', reserve_pct: 10, coding_t1_prefer_astra: false, agent_auto_profiles: [],
    classifier: { model: 'gpt-6-luna', tier_thresholds: [0.5, 1, 1.5], can_queue_min_p: 0.5, security_min_p: 0.5, rules_default_tier: 2 },
    models: {}, routing: {}, openrouter_fallback: {}, task_type_overrides: {}, free_mode: { enabled: false } };
  for (const [path, object] of [[accountsPath, sourceAccounts], [decisionsPath, sourceDecision], [gridPath, reviewedGrid]])
    writeFileSync(path, JSON.stringify(object), { mode: 0o600, flag: 'wx' });
  return { manifestPath, fixtureRoot, accountsPath, decisionsPath, gridPath, sourceAccounts, sourceAccount,
    reviewedDecision, reviewedGrid, sourceHashes: [accountsPath, decisionsPath, gridPath].map((p) => hash(readFileSync(p))) };
}

test('model loan is opt-in, selects one account, and never copies refresh or unrelated credentials', (t) => {
  const f = setup(t);
  assert.equal(readQualificationFixture(f.manifestPath, revision).manifest.syntheticActor.modelLoan, undefined);
  const inventory = inspectQualificationModelAccounts(f.accountsPath);
  assert.deepEqual(inventory, { accounts: [
    { id: 'chosen', label: 'Personal', status: 'ok', expires: f.sourceAccount.expires },
    { id: 'other', label: 'Personal', status: 'ok', expires: f.sourceAccount.expires },
  ], defaultAccountId: 'chosen' });
  const loan = provisionQualificationFixtureModelLoan({ manifestPath: f.manifestPath, expectedRevision: revision,
    sourceAccountsPath: f.accountsPath, selectedAccountId: 'chosen', sourceDecisionPath: f.decisionsPath,
    reviewedDecision: f.reviewedDecision, sourceGridPath: f.gridPath, reviewedGrid: f.reviewedGrid });
  assertQualificationModelLoan(readQualificationFixture(f.manifestPath, revision).manifest);
  const account = JSON.parse(readFileSync(join(f.fixtureRoot, 'openai-accounts.json'), 'utf8'));
  const decision = JSON.parse(readFileSync(join(f.fixtureRoot, 'decision-router.json'), 'utf8'));
  assert.equal(account.accounts.length, 1);
  assert.equal(account.accounts[0].id, 'qualification-model');
  assert.equal(account.accounts[0].access, 'test-access');
  assert.equal(account.accounts[0].refresh, '');
  assert.equal(account.accounts[0].chatgptAccountId, 'test-workspace');
  assert.equal(account.accounts[0].email, undefined);
  assert.equal(account.defaultAccountId, 'qualification-model');
  assert.equal(decision.openaiDecisions.apiKey, 'private-test-key');
  assert.equal(decision.custom, undefined);
  assert.ok(loan.stopAt > Date.now() && loan.stopAt <= Date.now() + 10 * 60_000);
  assert.deepEqual([f.accountsPath, f.decisionsPath, f.gridPath].map((p) => hash(readFileSync(p))), f.sourceHashes);
  assert.doesNotMatch(readFileSync(f.manifestPath, 'utf8'), /operator-refresh-never-copy|private-test-key|chosen/);
});

test('model loan fails closed for selector, expiry, key, tampering, and scope drift', (t) => {
  const f = setup(t);
  const args = { manifestPath: f.manifestPath, expectedRevision: revision, readFixture: readQualificationFixture, sourceAccountsPath: f.accountsPath,
    sourceDecisionPath: f.decisionsPath, reviewedDecision: f.reviewedDecision,
    sourceGridPath: f.gridPath, reviewedGrid: f.reviewedGrid };
  assert.throws(() => provisionQualificationModelLoan({ ...args, selectedAccountId: 'absent' }), /unavailable/);
  assert.throws(() => provisionQualificationModelLoan({ ...args, selectedAccountId: 'chosen',
    sourceAccountsPath: join(f.fixtureRoot, 'openai-accounts.json') }), /unavailable/);
  assert.throws(() => provisionQualificationModelLoan({ ...args, selectedAccountId: 'chosen',
    reviewedGrid: { ...f.reviewedGrid, accessToken: 'should-never-copy' } }), /unavailable/);
  assert.throws(() => provisionQualificationModelLoan({ ...args, selectedAccountId: 'chosen',
    reviewedDecision: { ...f.reviewedDecision, remoteDataConsent: false } }), /unavailable/);
  const loan = provisionQualificationModelLoan({ ...args, selectedAccountId: 'chosen' });
  const manifest = readQualificationFixture(f.manifestPath, revision).manifest;
  const accountPath = join(f.fixtureRoot, 'openai-accounts.json');
  const accounts = JSON.parse(readFileSync(accountPath, 'utf8'));
  accounts.routing.newSession = 'qualification-model';
  writeFileSync(accountPath, JSON.stringify(accounts), { mode: 0o600 });
  assert.doesNotThrow(() => assertQualificationModelLoan(manifest));
  accounts.unreviewedToken = 'forbidden';
  writeFileSync(accountPath, JSON.stringify(accounts), { mode: 0o600 });
  assert.throws(() => assertQualificationModelLoan(manifest), /unavailable/);
  delete accounts.unreviewedToken;
  accounts.accounts[0].refresh = 'forbidden';
  writeFileSync(accountPath, JSON.stringify(accounts), { mode: 0o600 });
  assert.throws(() => assertQualificationModelLoan(manifest), /unavailable/);
  accounts.accounts[0].refresh = '';
  writeFileSync(accountPath, JSON.stringify(accounts), { mode: 0o600 });
  chmodSync(accountPath, 0o644);
  assert.throws(() => assertQualificationModelLoan(manifest), /unavailable/);
  chmodSync(accountPath, 0o600);
  assert.throws(() => assertQualificationModelLoan(manifest, { now: loan.stopAt }), /unavailable/);
  assert.throws(() => assertQualificationModelLoan({ ...manifest, syntheticActor: { ...manifest.syntheticActor,
    modelLoan: { ...manifest.syntheticActor.modelLoan, issuedAt: Date.now() + 1000 } } }), /unavailable/);
});

test('model loan rejects expiring account, missing static key, and forged fixture root before writing', (t) => {
  for (const options of [{ expires: Date.now() + 20 * 60_000 }, { decisionKey: '' }]) {
    const f = setup(t, options);
    assert.throws(() => provisionQualificationModelLoan({ manifestPath: f.manifestPath, expectedRevision: revision,
      readFixture: readQualificationFixture, sourceAccountsPath: f.accountsPath, selectedAccountId: 'chosen',
      sourceDecisionPath: f.decisionsPath, reviewedDecision: f.reviewedDecision,
      sourceGridPath: f.gridPath, reviewedGrid: f.reviewedGrid }), /unavailable/);
    assert.equal(readQualificationFixture(f.manifestPath, revision).manifest.syntheticActor.modelLoan, undefined);
  }
  const f = setup(t);
  const forged = JSON.parse(readFileSync(f.manifestPath, 'utf8'));
  forged.fixtureRoot = `${f.fixtureRoot}/../outside`;
  writeFileSync(f.manifestPath, JSON.stringify(forged), { mode: 0o600 });
  assert.throws(() => provisionQualificationModelLoan({ manifestPath: f.manifestPath, expectedRevision: revision,
    readFixture: () => ({ manifest: forged }), sourceAccountsPath: f.accountsPath, selectedAccountId: 'chosen',
    sourceDecisionPath: f.decisionsPath, reviewedDecision: f.reviewedDecision,
    sourceGridPath: f.gridPath, reviewedGrid: f.reviewedGrid }), /unavailable/);
});

test('model loan deadline quits the app at the bound stop time', (t) => {
  const f = setup(t);
  provisionQualificationModelLoan({ manifestPath: f.manifestPath, expectedRevision: revision,
    readFixture: readQualificationFixture,
    sourceAccountsPath: f.accountsPath, selectedAccountId: 'chosen', sourceDecisionPath: f.decisionsPath,
    reviewedDecision: f.reviewedDecision, sourceGridPath: f.gridPath, reviewedGrid: f.reviewedGrid });
  const manifest = readQualificationFixture(f.manifestPath, revision).manifest;
  let callback, delay, quits = 0;
  armQualificationModelLoanDeadline({ manifest, app: { quit() { quits++; } }, setTimer(fn, ms) { callback = fn; delay = ms; return { unref() {} }; } });
  assert.ok(delay > 0 && delay <= 10 * 60_000);
  callback();
  assert.equal(quits, 1);
});
