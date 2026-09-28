import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentServerService } from '../src/agent-server.mjs';

test('live: reuse the real local Rhythm runtime and leave its engine alive on disconnect', {
  skip: process.env.RHYTHM_LIVE_E2E !== '1',
}, async () => {
  const engine = async () => {
    const response = await fetch('http://127.0.0.1:4096/global/health', { signal: AbortSignal.timeout(3_000) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.healthy, true);
    assert.equal(typeof body.bootId, 'string');
    assert.equal(typeof body.pid, 'number');
    return body;
  };
  const before = await engine();
  const service = new AgentServerService();
  try {
    assert.equal((await service.start()).status, 'ready');
    assert.equal(service.status.failureReason, null);
    assert.equal((await service.start()).status, 'ready');
  } finally {
    await service.stopGracefully();
    service.stop();
  }
  assert.equal(service.status.status, 'stopped');
  const after = await engine();
  assert.equal(after.bootId, before.bootId, 'disconnect must not restart or stop the borrowed engine');
  assert.equal(after.pid, before.pid);
  const response = await fetch('http://127.0.0.1:4001/agent-configs', { signal: AbortSignal.timeout(3_000) });
  assert.equal(response.status, 200);
  const profiles = await response.json();
  assert.ok(Array.isArray(profiles) && profiles.some((profile) => typeof profile.id === 'string' && typeof profile.label === 'string'),
    'real API still returns usable agent profiles after disconnect');
});
