// Regression contracts for Phase 1 host-policy gaps. These tests do not launch Electron.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const policy = await import('../src/policy.mjs');
const mainSource = await readFile(resolve(here, '../src/main.mjs'), 'utf8');

test('post-m1-p1-c4b: deep-link requests are explicit fail-closed policy decisions', () => {
  // Regression caught: arbitrary native inputs bypass the centralized deep-link policy.
  assert.equal(typeof policy.validateDeepLink, 'function', 'policy must export validateDeepLink');
  assert.equal(policy.validateDeepLink('https://example.invalid/#/agents'), false);
  assert.equal(policy.validateDeepLink('rhythm://other/index.html#/agents'), false);
  assert.equal(policy.validateDeepLink('rhythm://app/index.html#/agents'), true);
  assert.equal(policy.validateDeepLink('not a URL'), false);
});

test('post-m1-p1-c4c: the host acquires one instance lock and routes second-instance input through policy', () => {
  // The pure funnel is behavioral; importing main.mjs would execute Electron. The one narrow
  // source assertion below is retained only for the Electron-only lock and event binding.
  assert.equal(
    policy.deepLinkFromArgv(['electron', '.', 'rhythm://app/index.html#/agents']),
    'rhythm://app/index.html#/agents',
  );
  assert.equal(policy.deepLinkFromArgv(['electron', '.', 'https://example.invalid/#/agents']), null);
  assert.equal(policy.deepLinkFromArgv(['electron', '.', 'rhythm://other/index.html#/agents']), null);
  assert.equal(policy.deepLinkFromArgv(['electron', '.', '--smoke']), null);

  assert.match(
    mainSource,
    /const hasSingleInstanceLock = app\.requestSingleInstanceLock\(\);\s*if \(!hasSingleInstanceLock\) app\.quit\(\);[\s\S]*const routeIncomingDeepLink = \(argv\) => \{[\s\S]*deepLinkFromArgv\(argv\)[\s\S]*app\.on\('second-instance',[\s\S]*routeIncomingDeepLink\(argv\)[\s\S]*app\.on\('open-url',[\s\S]*routeIncomingDeepLink\(\[url\]\)/,
    'host must bind the single-instance lock and route both Electron URL events through one funnel',
  );
});
