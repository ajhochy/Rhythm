import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const enabled = process.env.RHYTHM_LIVE_E2E === '1';
if (enabled) {
  assert.match(readFileSync('/private/tmp/hermes-shipping-rollout-20261014-sandbox/api_server.pid','utf8').trim(), /^\d+$/);
  for (const path of ['/health','/opencode/health']) assert.equal((await fetch(`http://127.0.0.1:4898${path}`,{redirect:'error'})).status,200);
}
test('canonical shipping sandbox exposes supported workstream registry, but requires owner authentication', {skip:!enabled}, async () => {
  const response = await fetch('http://127.0.0.1:4898/agent-workstreams?projectId=disposable-fixture',{redirect:'error'});
  assert.equal(response.status,401);
});
test('Recipe remains explicitly default-off; no production feature workaround', {skip:!enabled}, async () => {
  const response = await fetch('http://127.0.0.1:4898/agent-workflows',{method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({recipeId:'disposable-preflight-no-dispatch',input:{}})});
  assert.equal(response.status,409);
  assert.equal((await response.json()).error,'disabled');
});
