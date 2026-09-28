import assert from 'node:assert/strict';
import test from 'node:test';

const live = process.env.RHYTHM_LIVE_E2E === '1';

function requiredString(value, name) {
  assert.equal(typeof value, 'string', `${name} must be a string`);
  assert.ok(value.trim().length > 0, `${name} must be nonempty`);
  return value;
}

function explicitRelayBase() {
  const value = requiredString(process.env.RHYTHM_LIVE_RELAY_BASE, 'RHYTHM_LIVE_RELAY_BASE');
  const url = new URL(value);
  assert.equal(url.protocol, 'https:', 'RHYTHM_LIVE_RELAY_BASE must use HTTPS');
  assert.ok(url.hostname.length > 0, 'RHYTHM_LIVE_RELAY_BASE must name a host');
  assert.equal(url.username, '', 'RHYTHM_LIVE_RELAY_BASE must not include credentials');
  assert.equal(url.password, '', 'RHYTHM_LIVE_RELAY_BASE must not include credentials');
  assert.equal(url.search, '', 'RHYTHM_LIVE_RELAY_BASE must not include a query');
  assert.equal(url.hash, '', 'RHYTHM_LIVE_RELAY_BASE must not include a fragment');
  return url.toString().replace(/\/$/, '');
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, `${url} must return HTTP 200`);
  return await response.json();
}

test('live: hosted relay mirrors the running local mobile gateway after candidate startup', {
  skip: !live,
  timeout: 30_000,
}, async () => {
  const relayBase = explicitRelayBase();
  const after = new Date(requiredString(process.env.RHYTHM_LIVE_RELAY_AFTER, 'RHYTHM_LIVE_RELAY_AFTER'));
  assert.ok(Number.isFinite(after.getTime()), 'RHYTHM_LIVE_RELAY_AFTER must be an ISO timestamp');

  const [engine, localGateway, relay, hostedGateway] = await Promise.all([
    readJson('http://127.0.0.1:4096/global/health'),
    readJson('http://127.0.0.1:4002/mobile-gateway/health'),
    readJson(`${relayBase}/relay/health`),
    readJson(`${relayBase}/relay/mobile-gateway/health`),
  ]);

  assert.equal(engine.healthy, true, 'the local OpenCode engine must be healthy');
  assert.equal(localGateway.status, 'ready', 'the local mobile gateway must be ready');
  assert.equal(relay.status, 'ok');
  assert.equal(relay.role, 'relay');
  assert.equal(relay.macOnline, true, 'the public relay must report the candidate Mac online');
  assert.equal(hostedGateway.macOnline, true, 'the hosted gateway snapshot must be online');
  assert.equal(hostedGateway.status, localGateway.status, 'hosted gateway status must match the local gateway');

  for (const [name, value] of [
    ['local hostId', localGateway.hostId],
    ['hosted hostId', hostedGateway.hostId],
    ['local contractFingerprint', localGateway.contractFingerprint],
    ['hosted contractFingerprint', hostedGateway.contractFingerprint],
    ['local gatewayVersion', localGateway.gatewayVersion],
    ['hosted gatewayVersion', hostedGateway.gatewayVersion],
    ['local opencodeVersion', localGateway.opencodeVersion],
    ['hosted opencodeVersion', hostedGateway.opencodeVersion],
  ]) requiredString(value, name);

  assert.equal(hostedGateway.hostId, localGateway.hostId, 'hosted health must belong to this local gateway');
  assert.equal(hostedGateway.contractFingerprint, localGateway.contractFingerprint, 'hosted contract must match the local gateway');
  assert.equal(hostedGateway.gatewayVersion, localGateway.gatewayVersion, 'hosted gateway version must match the local gateway');
  assert.equal(hostedGateway.opencodeVersion, localGateway.opencodeVersion, 'hosted OpenCode version must match the local gateway');
  assert.ok(Array.isArray(localGateway.features) && localGateway.features.length > 0, 'local gateway must publish supported features');
  assert.deepEqual(hostedGateway.features, localGateway.features, 'hosted features must match the local gateway exactly');

  const uplinkAt = new Date(requiredString(hostedGateway.lastUplinkAt, 'hosted lastUplinkAt'));
  assert.ok(Number.isFinite(uplinkAt.getTime()), 'hosted lastUplinkAt must be an ISO timestamp');
  assert.ok(uplinkAt.getTime() > after.getTime(), 'hosted uplink must be newer than the supplied candidate-start boundary');
  assert.equal(relay.lastUplinkAt, hostedGateway.lastUplinkAt, 'public relay and gateway health must describe the same current uplink');
});
