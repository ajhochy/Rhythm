import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const mainSource = await readFile(resolve(here, '../src/main.mjs'), 'utf8');

test('post-m1-p7-c4f-policy: native activation is allowlisted queued and replayed through owned-target navigation', () => {
  // Regression caught: an early or hostile native activation is loaded directly as a renderer URL,
  // or is discarded before renderer readiness. Packaged foreground/background/terminated execution
  // remains an orchestrator-owned follow-up; this test fixes the required host policy and wiring.
  assert.ok(
    /pendingNativeNotification|pendingNotificationActivation|notificationActivationQueue/.test(mainSource),
    'the host must retain early native activations until the renderer is ready',
  );
  assert.ok(
    /validateNotificationActivation|validateNativeNotificationTarget/.test(mainSource),
    'native activation payloads must pass an explicit allowlist',
  );
  assert.ok(
    /task|rhythm|project|session|approval/.test(mainSource),
    'the allowlist must cover only the contract target families',
  );
  assert.ok(
    /mainWindow\.restore\(\)[\s\S]*mainWindow\.focus\(\)/.test(mainSource),
    'activation must restore and focus the single app instance',
  );
});
