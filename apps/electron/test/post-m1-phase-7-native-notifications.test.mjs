import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const mainSource = await readFile(resolve(here, '../src/main.mjs'), 'utf8');
const preloadSource = await readFile(resolve(here, '../src/preload.cjs'), 'utf8');

test('post-m1-p7-c4e: Electron owns permission presentation deduplication cancellation and a narrow preload', () => {
  // Regression caught: the packaged host has no Notification import or lifecycle while the renderer
  // can gain an arbitrary notification/signing primitive. The host-wiring assertions fail.
  assert.ok(
    /import\s*\{[^}]*\bNotification\b[^}]*\}\s*from\s*['"]electron['"]/.test(mainSource),
    'Electron main must own the native Notification primitive',
  );
  assert.ok(
    /Notification\.requestPermission|requestPermission\([^)]*notification/i.test(mainSource),
    'the host must explicitly request native notification permission',
  );
  assert.ok(/new Notification\s*\(/.test(mainSource), 'the host must present native notifications');
  assert.ok(
    /(?:Map|Set)\s*\(|notification[^\n]*(?:dedup|seen|presented)/i.test(mainSource),
    'the host must keep a native-notification deduplication registry',
  );
  assert.ok(
    /\.close\(\)|\.destroy\(\)|cancelNotification/i.test(mainSource),
    'resolved asks must cancel their native presentation',
  );
  assert.ok(
    !/showNotification|newNotification|sign\s*:\s*|signPayload|privateKey/i.test(preloadSource),
    'the preload must not expose arbitrary renderer-controlled notification or signing primitives',
  );
});
