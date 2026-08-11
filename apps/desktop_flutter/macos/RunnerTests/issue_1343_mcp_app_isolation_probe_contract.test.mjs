import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const testsDir = dirname(fileURLToPath(import.meta.url));
const runnerDir = join(testsDir, '..', 'Runner');
const policyFile = join(runnerDir, 'McpAppIsolationProbePolicy.swift');
const driverFile = join(testsDir, 'McpAppIsolationProbeContractDriver.swift');

function runSwiftContract(contractCase) {
  const buildDir = mkdtempSync(join(tmpdir(), 'rhythm-issue-1343-'));
  const executable = join(buildDir, 'issue-1343-contract');
  try {
    const compile = spawnSync(
      'xcrun',
      [
        'swiftc',
        '-framework',
        'WebKit',
        policyFile,
        driverFile,
        '-o',
        executable,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          CLANG_MODULE_CACHE_PATH: join(buildDir, 'clang-module-cache'),
          SWIFT_MODULECACHE_PATH: join(buildDir, 'swift-module-cache'),
        },
      },
    );
    assert.equal(
      compile.status,
      0,
      `contract policy must compile:\n${compile.stdout}${compile.stderr}`,
    );
    const run = spawnSync(executable, [contractCase], { encoding: 'utf8' });
    assert.equal(
      run.status,
      0,
      `contract case ${contractCase} failed:\n${run.stdout}${run.stderr}`,
    );
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

test('issue-1343-c2: the trusted shell exclusively owns the bridge and isolates the iframe', () => {
  runSwiftContract('bridge-isolation');
});

test('issue-1343-c3: boot nonce and origin rejection fail closed', () => {
  runSwiftContract('nonce-origin');
});

test('issue-1343-c4: every probe view uses isolated ephemeral storage', () => {
  runSwiftContract('ephemeral-storage');
});

test('issue-1343-c5: CSP, network, navigation, and download policy deny undeclared access', () => {
  runSwiftContract('csp-network-navigation');
});

test('issue-1343-c6: content, messages, views, dimensions, and lifetime are bounded', () => {
  runSwiftContract('bounds-lifecycle');
});
