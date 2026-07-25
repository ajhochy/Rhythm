import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const contractPath = resolve(root, 'docs/ai/contracts/issue-1171.json');
const nativeEvidencePath = resolve(
  root,
  'docs/ai/runs/artifacts/issue-1171/native-accessibility.json',
);

const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const requested = process.argv[2] ?? 'all';
const criterionIds =
  requested === 'all'
    ? contract.criteria.map(({ criterion_id }) => criterion_id)
    : [requested.startsWith('issue-1171-') ? requested : `issue-1171-${requested}`];

for (const criterionId of criterionIds) {
  assert.ok(
    contract.criteria.some(({ criterion_id }) => criterion_id === criterionId),
    `Unknown issue #1171 criterion: ${criterionId}`,
  );
}

function run(label, cwd, executable, args, env = {}) {
  console.log(`\n[issue-1171] ${label}`);
  const result = spawnSync(executable, args, {
    cwd: resolve(root, cwd),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  assert.equal(
    result.status,
    0,
    `${label} failed with exit status ${result.status ?? 'unknown'}`,
  );
}

function validateNativeEvidence() {
  assert.equal(
    existsSync(nativeEvidencePath),
    true,
    'issue-1171-c6: retained native accessibility evidence is missing',
  );
  const evidence = JSON.parse(readFileSync(nativeEvidencePath, 'utf8'));
  assert.equal(evidence.issue, 1171);
  assert.equal(evidence.simulator.name, 'Rhythm-1171-iPhone-SE');
  assert.equal(evidence.simulator.foreignSimulatorTouched, false);
  assert.match(
    evidence.dynamicType.contentSizeCategory,
    /^accessibility-/,
    'issue-1171-c6: native Dynamic Type was not set to an accessibility size',
  );
  assert.equal(evidence.dynamicType.pairButtonReachable, true);
  assert.equal(evidence.dynamicType.layoutClipped, false);
  for (const label of [
    'Close pairing',
    'QR code scanner',
    'Scan test QR code',
  ]) {
    assert.ok(
      evidence.accessibilityLabels.includes(label),
      `issue-1171-c6: missing native accessibility label evidence: ${label}`,
    );
  }
  for (const relativePath of evidence.screenshots) {
    const screenshotPath = resolve(root, relativePath);
    assert.equal(
      existsSync(screenshotPath),
      true,
      `issue-1171-c6: retained screenshot is missing: ${relativePath}`,
    );
    assert.ok(
      statSync(screenshotPath).size > 10_000,
      `issue-1171-c6: retained screenshot is unexpectedly small: ${relativePath}`,
    );
  }
}

const selected = new Set(criterionIds);
const needs = (...ids) => ids.some((id) => selected.has(`issue-1171-${id}`));

if (needs('c1', 'c6')) {
  run(
    'c1/c6 API Tailscale and strict phone-surface regressions',
    'apps/api_server',
    'npx',
    [
      'vitest',
      'run',
      'src/services/__tests__/tailscale_serve_service.test.ts',
      'src/services/__tests__/mobile_gateway_surface.test.ts',
    ],
  );
}

if (needs('c2', 'c5')) {
  run(
    'c2/c5 Flutter QR and mobile-access behavior',
    'apps/desktop_flutter',
    'flutter',
    ['test', 'test/features/agents/mobile_access_dialog_test.dart'],
  );
}

if (needs('c3', 'c4', 'c6', 'c7', 'c9')) {
  run(
    'c3/c4/c6 paired-host security and state machine',
    'apps/mobile',
    'npm',
    ['run', 'test:paired-host'],
  );
}

if (needs('c4', 'c5', 'c6', 'c7', 'c9')) {
  run(
    'c4/c5/c6 pairing, replacement, failure UI, and computed-type browser behavior',
    'apps/mobile',
    'npx',
    ['playwright', 'test', 'tests/e2e/pairing.spec.mjs'],
    {
      PLAYWRIGHT_FAKE_PORT: '44171',
      PLAYWRIGHT_WEB_PORT: '19171',
    },
  );
}

if (needs('c8')) {
  run(
    'c8 Playwright occupied-port isolation',
    'apps/mobile',
    'node',
    ['tests/playwright-port-isolation.test.mjs'],
  );
}

if (needs('c5')) {
  run(
    'c5 Flutter formatting',
    'apps/desktop_flutter',
    'dart',
    ['format', '.', '--set-exit-if-changed'],
  );
  run(
    'c5 Flutter analysis',
    'apps/desktop_flutter',
    'flutter',
    ['analyze', '--no-fatal-infos'],
  );
  run('c5 mobile lint', 'apps/mobile', 'npm', ['run', 'lint']);
  run('c5 mobile typecheck', 'apps/mobile', 'npm', ['run', 'typecheck']);
}

if (needs('c6')) {
  validateNativeEvidence();
}

for (const criterionId of criterionIds) {
  const criterion = contract.criteria.find(
    ({ criterion_id }) => criterion_id === criterionId,
  );
  assert.equal(
    criterion.status,
    'pass',
    `${criterionId}: executable evidence passed, but contract status is ${criterion.status}; update it only after recording this run`,
  );
  assert.ok(
    Array.isArray(criterion.evidence) && criterion.evidence.length > 0,
    `${criterionId}: pass status requires explicit evidence`,
  );
}

console.log(
  `\nIssue #1171 executable acceptance contract passed: ${criterionIds.join(', ')}`,
);
