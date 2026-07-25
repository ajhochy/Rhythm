#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const evidencePath = resolve(
  root,
  process.env.RHYTHM_ISSUE_1175_EVIDENCE ??
    'docs/ai/evidence/issue-1175-release.json',
);

let evidence;
try {
  evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
} catch (error) {
  throw new Error(
    `Issue #1175 release evidence is missing or invalid at ${evidencePath}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

assert.equal(evidence.schemaVersion, 1, 'release evidence schema must be v1');
assert.equal(evidence.issue, 1175);
assert.equal(evidence.gitnexus?.baseRef, 'main');
assert.equal(evidence.gitnexus?.unexpectedFlows, 0);
assert.ok(
  Number.isSafeInteger(evidence.gitnexus?.changedFiles) &&
    evidence.gitnexus.changedFiles > 0,
  'GitNexus evidence must record the aggregate changed-file count',
);

assert.equal(evidence.review?.independent, true);
assert.equal(evidence.review?.unresolvedCritical, 0);
assert.equal(evidence.review?.unresolvedImportant, 0);
assert.match(evidence.review?.commit ?? '', /^[0-9a-f]{40}$/);

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
for (const gate of requiredGates) {
  const result = evidence.gates?.find((entry) => entry.name === gate);
  assert.equal(result?.status, 'pass', `${gate} gate must pass`);
  assert.ok(result?.command, `${gate} gate must record its exact command`);
}

assert.equal(evidence.sandbox?.launcher, 'tools/dev/sandbox.sh');
assert.equal(evidence.sandbox?.apiPort, 4098);
assert.equal(evidence.sandbox?.enginePort, 4097);
assert.equal(evidence.sandbox?.port4001Untouched, true);
assert.equal(evidence.sandbox?.port4096Untouched, true);
assert.equal(evidence.sandbox?.status, 'pass');
assert.ok(evidence.sandbox?.command);

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
assert.match(evidence.developmentBuild?.buildId ?? '', /^[A-Za-z0-9-]+$/);
assert.equal(evidence.developmentBuild?.signed, true);
assert.equal(evidence.physicalDevice?.status, 'pass');
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
for (const check of physicalChecks) {
  assert.equal(
    evidence.physicalDevice?.checks?.[check],
    'pass',
    `physical-device ${check} must pass`,
  );
}

assert.match(evidence.productionBuild?.buildId ?? '', /^[A-Za-z0-9-]+$/);
assert.equal(evidence.productionBuild?.status, 'complete');
assert.match(evidence.testflight?.submissionId ?? '', /^[A-Za-z0-9-]+$/);
assert.equal(evidence.testflight?.status, 'complete');

assert.equal(evidence.pullRequest?.number, 1165);
assert.equal(evidence.pullRequest?.state, 'OPEN');
assert.equal(evidence.pullRequest?.draft, true);
assert.equal(evidence.pullRequest?.merged, false);
assert.match(evidence.pullRequest?.headSha ?? '', /^[0-9a-f]{40}$/);
assert.match(evidence.runLog ?? '', /^docs\/ai\/runs\/.+\.md$/);

const serialized = JSON.stringify(evidence);
assert.doesNotMatch(
  serialized,
  /(?:expo_token|deviceToken|sessionToken|authorization|private[_ -]?key|password|secret)["']?\s*[:=]\s*["'][^"']+/i,
  'release evidence must not contain credential values',
);

console.log('Issue #1175 release evidence contract passed');
