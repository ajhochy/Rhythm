// Behavioral acceptance: run only against the canonical shipping sandbox.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const sb = '/private/tmp/hermes-shipping-rollout-20261014-sandbox';
if (enabled) {
  assert.equal(process.env.RHYTHM_SANDBOX_DIR, sb);
  assert.equal(process.env.RHYTHM_SANDBOX_API_PORT, '4898');
  assert.equal(process.env.RHYTHM_SANDBOX_ENGINE_PORT, '4897');
  assert.equal(process.env.RHYTHM_SANDBOX_GATEWAY_PORT, '4899');
  assert.match(readFileSync(`${sb}/api_server.pid`, 'utf8').trim(), /^\d+$/);
  for (const path of ['/health', '/opencode/health']) {
    assert.equal((await fetch(`http://127.0.0.1:4898${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(10000),
    })).status, 200, `real sandbox prerequisite ${path}`);
  }
}
for (const path of ['/hermes-notify/runs/disposable-unknown/events', '/agent-approvals/relay/pending']) {
  test(`shipping unauthenticated ${path} denies with 401`, { skip: !enabled }, async () => {
    const response = await fetch(`http://127.0.0.1:4898${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 401, 'feature surface must exist and fail closed');
  });
}
