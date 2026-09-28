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

test('external-links-c1: one validator canonicalizes credential-free http(s) and rejects everything else', () => {
  assert.equal(policy.externalHttpUrl('HTTPS://Example.COM:443/a/../guide?q=1#start'), 'https://example.com/guide?q=1#start');
  assert.equal(policy.externalHttpUrl('http://example.com/plain'), 'http://example.com/plain');
  for (const value of ['', 'x'.repeat(4097), `https://example.com/${'x'.repeat(4096)}`, 'not a url', 'https:example.com', ' https://example.com',
    'https://example.com/\nnext', 'https://example.com/​zw', 'https://user@example.com', 'https://:secret@example.com',
    'javascript:alert(1)', 'file:///tmp/a', 'data:text/plain,a', 'rhythm://app/index.html', 'rhythm-artifact://x', 'custom-scheme://open',
    undefined, null, 42, { href: 'https://example.com' }]) {
    assert.equal(policy.externalHttpUrl(value), null, String(value).slice(0, 40));
  }
});

test('external-links-c2: external opens are capped per sliding window', () => {
  let t = 0;
  const allow = policy.createExternalOpenLimiter(3, 1000, () => t);
  assert.deepEqual([allow(), allow(), allow(), allow()], [true, true, true, false]);
  t = 999; assert.equal(allow(), false);
  t = 1000; assert.deepEqual([allow(), allow(), allow(), allow()], [true, true, true, false]);
});

test('external-links-c3: IPC, window-open and will-navigate share the validator; the window handler always denies', () => {
  assert.match(mainSource, /rhythm:shell:open-external[\s\S]{0,200}externalHttpUrl\(value\)/);
  assert.match(mainSource, /setWindowOpenHandler\(\(\{ url \}\) => \{\s*denials\.popup = true;\s*openLinkExternally\(url\);\s*return \{ action: 'deny' \};/);
  assert.match(mainSource, /on\('will-navigate', \(event\) => \{\s*denials\.navigation = true;\s*event\.preventDefault\(\);\s*openLinkExternally\(event\.url\);/);
  assert.doesNotMatch(mainSource, /action: 'allow'/);
});
