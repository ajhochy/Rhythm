#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const evidencePath = resolve(
  root,
  process.env.RHYTHM_ISSUE_1175_EVIDENCE ??
    'docs/ai/evidence/issue-1175-release.json',
);
const SHA = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function command(binary, args) {
  return execFileSync(binary, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function git(...args) {
  return command('git', args);
}

async function loadEvidence() {
  try {
    return JSON.parse(await readFile(evidencePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Issue #1175 release evidence is missing or invalid at ${evidencePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function sha256File(relativePath) {
  const content = await readFile(resolve(root, relativePath));
  return createHash('sha256').update(content).digest('hex');
}

async function assertDurableRecord(
  record,
  label,
  testedHeadSha,
  expectedStatus = 'pass',
) {
  assert.equal(
    record?.status,
    expectedStatus,
    `${label} must be ${expectedStatus}`,
  );
  assert.equal(
    record?.headSha,
    testedHeadSha,
    `${label} must identify the exact tested source head`,
  );
  assert.equal(record?.exitCode, 0, `${label} must record exit code 0`);
  assert.ok(
    typeof record?.command === 'string' && record.command.trim(),
    `${label} must record the exact command`,
  );
  assert.match(
    record?.logPath ?? '',
    /^docs\/ai\/evidence\/logs\/[^/]+\.log$/,
    `${label} must point to a committed evidence log`,
  );
  assert.match(record?.logSha256 ?? '', /^[0-9a-f]{64}$/);
  assert.equal(
    await sha256File(record.logPath),
    record.logSha256,
    `${label} log hash must match its durable contents`,
  );
}

async function assertArtifact(artifact, label) {
  assert.ok(
    typeof artifact?.path === 'string' && artifact.path.trim(),
    `${label} must record its output path`,
  );
  assert.match(artifact?.sha256 ?? '', /^[0-9a-f]{64}$/);
  assert.equal(
    await sha256File(artifact.path),
    artifact.sha256,
    `${label} artifact hash must match the produced binary`,
  );
}

function actualPullRequest() {
  return JSON.parse(
    command('gh', [
      'pr',
      'view',
      '1165',
      '--json',
      'number,state,isDraft,mergedAt,headRefOid,statusCheckRollup,url',
    ]),
  );
}

function assertNoCredentialValues(evidence) {
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(
    serialized,
    /(?:expo_token|deviceToken|sessionToken|authorization|private[_ -]?key|password|secret)["']?\s*[:=]\s*["'][^"']+/i,
    'release evidence must not contain credential values',
  );
}

test('issue-1175-c1: bounded GitNexus aggregate scope is durably tied to the tested head', async () => {
  // Regression caught: a hand-authored changedFiles boolean can claim a clean
  // impact review without identifying the command, immutable source SHA, or
  // report bytes that were actually reviewed.
  const evidence = await loadEvidence();
  assert.equal(evidence.schemaVersion, 2);
  assert.match(evidence.testedHeadSha ?? '', SHA);
  assert.equal(evidence.gitnexus?.baseRef, 'main');
  assert.equal(evidence.gitnexus?.headSha, evidence.testedHeadSha);
  assert.equal(evidence.gitnexus?.unexpectedFlows, 0);
  assert.ok(
    Number.isSafeInteger(evidence.gitnexus?.changedFiles) &&
      evidence.gitnexus.changedFiles > 0,
    'GitNexus evidence must record the aggregate changed-file count',
  );
  await assertDurableRecord(
    evidence.gitnexus,
    'GitNexus compare-to-main',
    evidence.testedHeadSha,
  );
});

test('issue-1175-c2: independent review closure is backed by its immutable report', async () => {
  // Regression caught: evidence says "independent: true" while the reviewed
  // SHA differs from the release and unresolved Important findings remain in
  // an unreferenced reviewer transcript.
  const evidence = await loadEvidence();
  assert.equal(evidence.review?.independent, true);
  assert.equal(evidence.review?.unresolvedCritical, 0);
  assert.equal(evidence.review?.unresolvedImportant, 0);
  assert.equal(evidence.review?.headSha, evidence.testedHeadSha);
  await assertDurableRecord(
    evidence.review,
    'independent whole-branch review',
    evidence.testedHeadSha,
  );
});

test('issue-1175-c3: every cumulative gate records exact command, head, exit code, and log hash', async () => {
  // Regression caught: pass booleans survive even when a command ran against
  // another commit, failed later in the output, or has no durable output.
  const evidence = await loadEvidence();
  const requiredGates = [
    'api',
    'flutter',
    'mobile-static',
    'mobile-contract',
    'browser-e2e',
    'accessibility',
    'security',
    'secret-scan',
  ];
  for (const name of requiredGates) {
    const matches = evidence.gates?.filter((entry) => entry.name === name) ?? [];
    assert.equal(matches.length, 1, `${name} must have exactly one gate record`);
    await assertDurableRecord(
      matches[0],
      `${name} gate`,
      evidence.testedHeadSha,
    );
  }
});

test('issue-1175-c4: exact sandbox launcher and listener snapshots prove isolation', async () => {
  // Regression caught: sandbox:true can be recorded after manually launching
  // another port or after replacing the app's existing 4001/4096 listeners.
  const evidence = await loadEvidence();
  assert.equal(evidence.sandbox?.launcher, 'tools/dev/sandbox.sh');
  assert.equal(evidence.sandbox?.apiPort, 4098);
  assert.equal(evidence.sandbox?.enginePort, 4097);
  assert.deepEqual(
    evidence.sandbox?.listenersAfter?.port4001,
    evidence.sandbox?.listenersBefore?.port4001,
    'listener 4001 identity must be unchanged',
  );
  assert.deepEqual(
    evidence.sandbox?.listenersAfter?.port4096,
    evidence.sandbox?.listenersBefore?.port4096,
    'listener 4096 identity must be unchanged',
  );
  assert.match(
    evidence.sandbox?.command ?? '',
    /(?:^|\s)tools\/dev\/sandbox\.sh up(?:\s|$)/,
  );
  await assertDurableRecord(
    evidence.sandbox,
    'real API/engine sandbox',
    evidence.testedHeadSha,
  );
});

test('issue-1175-c5: signed physical-device matrix is tied to the tested build without a UDID', async () => {
  // Regression caught: a simulator run or an unsigned/stale binary is recorded
  // as a physical smoke, or a real device identifier is committed as proof.
  const evidence = await loadEvidence();
  const physicalChecks = [
    'pairing',
    'failure-isolation',
    'chat-sse',
    'pty',
    'approvals',
    'all-tools',
    'revocation',
    'background-recovery',
  ];
  assert.match(evidence.developmentBuild?.buildId ?? '', SAFE_ID);
  assert.equal(evidence.developmentBuild?.signed, true);
  assert.equal(evidence.developmentBuild?.headSha, evidence.testedHeadSha);
  assert.ok(evidence.developmentBuild?.command);
  await assertArtifact(
    evidence.developmentBuild?.artifact,
    'signed development build',
  );
  assert.equal(evidence.physicalDevice?.status, 'pass');
  assert.equal(evidence.physicalDevice?.headSha, evidence.testedHeadSha);
  assert.match(
    evidence.physicalDevice?.deviceLabel ?? '',
    /^(?:iPhone|iPad)[A-Za-z0-9 ()+.-]*$/,
    'physical-device evidence must use only a non-sensitive model label',
  );
  assert.equal(
    'deviceId' in (evidence.physicalDevice ?? {}),
    false,
    'physical-device evidence must never commit a UDID',
  );
  assert.equal(
    'udid' in (evidence.physicalDevice ?? {}),
    false,
    'physical-device evidence must never commit a UDID alias',
  );
  for (const check of physicalChecks) {
    assert.equal(
      evidence.physicalDevice?.checks?.[check],
      'pass',
      `physical-device ${check} must pass`,
    );
  }
  await assertDurableRecord(
    evidence.physicalDevice,
    'physical-device smoke matrix',
    evidence.testedHeadSha,
  );
  assertNoCredentialValues(evidence);
});

test('issue-1175-c6: production archive and TestFlight submission have source and artifact provenance', async () => {
  // Regression caught: complete booleans are copied from an unrelated EAS/Xcode
  // build or an old TestFlight upload without proving the source commit or IPA.
  const evidence = await loadEvidence();
  assert.match(evidence.productionBuild?.buildId ?? '', SAFE_ID);
  assert.equal(evidence.productionBuild?.status, 'complete');
  assert.equal(evidence.productionBuild?.headSha, evidence.testedHeadSha);
  assert.ok(evidence.productionBuild?.command);
  assert.equal(evidence.productionBuild?.configuration, 'Release');
  await assertArtifact(
    evidence.productionBuild?.artifact,
    'production iOS build',
  );
  assert.match(evidence.testflight?.submissionId ?? '', SAFE_ID);
  assert.equal(evidence.testflight?.status, 'complete');
  assert.equal(evidence.testflight?.headSha, evidence.testedHeadSha);
  assert.equal(
    evidence.testflight?.artifactSha256,
    evidence.productionBuild?.artifact?.sha256,
    'TestFlight must receive the exact production artifact',
  );
  assert.ok(evidence.testflight?.command);
  assert.ok(evidence.testflight?.buildNumber);
  await assertDurableRecord(
    evidence.testflight,
    'TestFlight submission',
    evidence.testedHeadSha,
    'complete',
  );
  assertNoCredentialValues(evidence);
});

test('issue-1175-c7: durable run log agrees with the live draft PR', async () => {
  // Regression caught: a stale evidence JSON says PR #1165 is draft/open and
  // points at the release while GitHub actually has another head or failed
  // checks, and the run log does not contain the executed commands.
  const evidence = await loadEvidence();
  assert.equal(evidence.pullRequest?.number, 1165);
  assert.match(evidence.runLog ?? '', /^docs\/ai\/runs\/.+\.md$/);
  const runLog = await readFile(resolve(root, evidence.runLog), 'utf8');
  assert.match(runLog, new RegExp(evidence.testedHeadSha));
  for (const record of [
    evidence.gitnexus,
    evidence.review,
    ...(evidence.gates ?? []),
    evidence.sandbox,
    evidence.physicalDevice,
    evidence.testflight,
  ]) {
    assert.ok(
      runLog.includes(record.command),
      `run log must contain exact command: ${record.command}`,
    );
  }

  const actual = actualPullRequest();
  const head = git('rev-parse', 'HEAD');
  assert.equal(actual.number, 1165);
  assert.equal(actual.state, 'OPEN');
  assert.equal(actual.isDraft, true);
  assert.equal(actual.mergedAt, null);
  assert.equal(actual.headRefOid, head);
  assert.equal(
    evidence.pullRequest?.sourceHeadSha,
    evidence.testedHeadSha,
  );
  assert.equal(
    evidence.pullRequest?.headPolicy,
    'evidence-only-descendant',
  );
  assert.equal(evidence.pullRequest?.state, actual.state);
  assert.equal(evidence.pullRequest?.draft, actual.isDraft);
  assert.equal(evidence.pullRequest?.merged, false);
  assert.equal(evidence.pullRequest?.url, actual.url);
  assert.ok(
    Array.isArray(actual.statusCheckRollup) &&
      actual.statusCheckRollup.length > 0,
    'draft PR must have reported checks',
  );
  for (const check of actual.statusCheckRollup) {
    const outcome = check.conclusion ?? check.state ?? check.status;
    assert.ok(
      ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(outcome),
      `PR check ${check.name ?? check.context ?? 'unknown'} is ${outcome}`,
    );
  }
});

test('issue-1175-c14: release evidence proves one exact tested source head and evidence-only final commits', async () => {
  // Regression caught: internally consistent booleans still mix commands,
  // builds, review, and PR data from different commits; this assertion makes
  // the immutable tested source SHA the shared provenance key.
  const evidence = await loadEvidence();
  const currentHead = git('rev-parse', 'HEAD');
  assert.match(evidence.testedHeadSha ?? '', SHA);
  assert.doesNotThrow(() =>
    git('merge-base', '--is-ancestor', evidence.testedHeadSha, currentHead),
  );
  const filesAfterTestedHead = git(
    'diff',
    '--name-only',
    `${evidence.testedHeadSha}..${currentHead}`,
  )
    .split('\n')
    .filter(Boolean);
  for (const file of filesAfterTestedHead) {
    assert.match(
      file,
      /^(?:docs\/ai\/(?:evidence|runs)\/|docs\/ai\/project-state\.md$|\.agent-stack\/postmortems\/)/,
      `post-verification commit changed executable source: ${file}`,
    );
  }
  const provenanceRecords = [
    evidence.gitnexus,
    evidence.review,
    ...(evidence.gates ?? []),
    evidence.sandbox,
    evidence.developmentBuild,
    evidence.physicalDevice,
    evidence.productionBuild,
    evidence.testflight,
  ];
  for (const record of provenanceRecords) {
    assert.equal(
      record?.headSha,
      evidence.testedHeadSha,
      'all review/test/build records must use the same tested head',
    );
  }
  assert.equal(
    evidence.pullRequest?.sourceHeadSha,
    evidence.testedHeadSha,
  );
  assert.equal(
    evidence.pullRequest?.headPolicy,
    'evidence-only-descendant',
  );
  assertNoCredentialValues(evidence);
});

test('issue-1175-c30: aggregate diff check is clean', () => {
  // Regression caught: a source slice can be internally formatted while an
  // earlier aggregate commit still carries whitespace errors relative to main.
  assert.doesNotThrow(
    () => command('git', ['diff', '--check', 'main']),
    'git diff --check main must report no whitespace errors',
  );
});
