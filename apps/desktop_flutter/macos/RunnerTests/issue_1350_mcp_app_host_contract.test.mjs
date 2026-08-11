import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const testsDir = dirname(fileURLToPath(import.meta.url));
const policyFile = join(testsDir, '..', 'Runner', 'McpAppHostPolicy.swift');
const driverFile = join(testsDir, 'McpAppHostContractDriver.swift');

function runContract(contractCase) {
  const buildDir = mkdtempSync(join(tmpdir(), 'rhythm-issue-1350-'));
  const executable = join(buildDir, 'issue-1350-contract');
  try {
    const compile = spawnSync(
      'xcrun',
      ['swiftc', '-framework', 'WebKit', policyFile, driverFile, '-o', executable],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          CLANG_MODULE_CACHE_PATH: join(buildDir, 'clang-module-cache'),
          SWIFT_MODULECACHE_PATH: join(buildDir, 'swift-module-cache'),
        },
      },
    );
    assert.equal(compile.status, 0, `${compile.stdout}${compile.stderr}`);
    const run = spawnSync(executable, [contractCase], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

test('issue-1350-c1: outer shell exclusively owns the native channel', () => {
  runContract('bridge-ownership');
});

test('issue-1350-c2: sandbox, origin, and boot nonce fail closed', () => {
  runContract('nonce-origin-sandbox');
});

test('issue-1350-c3: every configuration owns nonpersistent storage', () => {
  runContract('ephemeral-storage');
});

test('issue-1350-c4: CSP, network, navigation, and downloads deny by default', () => {
  runContract('csp-network-navigation');
});

test('issue-1356-c1: native flood, device, link, private-network, and teardown attacks deny', () => {
  runContract('ga-malicious-matrix');
});
