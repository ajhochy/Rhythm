import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const gatewayModulePath = '../../src/gateway/index.ts';

test('slice-2-c19: renderer CSP permits only production local services and the exact artifact bridge', async () => {
  // Regression caught: shipping CSP keeps sandbox ports or the content-addressed bridge hash drifts.
  const html = await readFile(path.resolve(import.meta.dirname, '../../index.html'), 'utf8');
  const connectSrc = html.match(/(?:^|;)\s*connect-src\s+([^;]+)/)?.[1].trim().split(/\s+/);
  expect(connectSrc).toEqual(['https://api.vcrcapps.com', 'http://127.0.0.1:4001', 'http://127.0.0.1:4096', 'ws://127.0.0.1:4001']);
  const shell = await readFile(path.resolve(import.meta.dirname, '../../src/pages/dashboard/LiveArtifactsShell.tsx'), 'utf8');
  const rawBridge = shell.match(/const ARTIFACT_BRIDGE_SCRIPT = `<script>([\s\S]*?)<\\\/script>`;/)?.[1];
  expect(rawBridge).toBeTruthy();
  const bridgeHash = createHash('sha256').update(rawBridge!.replaceAll('\\/', '/'), 'utf8').digest('base64');
  expect(html).toContain(`'sha256-${bridgeHash}'`);
});

async function loadGateway(): Promise<any> {
  try {
    return await import(gatewayModulePath);
  } catch {
    return null;
  }
}

test('slice-2-c1: gateway exposes explicit mode, health, and unsupported domain boundary', async () => {
  // Regression caught: composition can no longer distinguish fixture from live before feature migration.
  const gateway = await loadGateway();
  expect(gateway, 'renderer gateway module must exist').not.toBeNull();
  if (!gateway) return;
  const fixture = gateway.createFixtureGateway();
  expect(fixture.mode).toBe('fixture');
  expect(typeof fixture.health.api).toBe('function');
  expect(typeof fixture.health.engine).toBe('function');
  await expect(fixture.unsupported('sessions.list')).rejects.toThrow(/unsupported.*sessions\.list/i);
});

test('slice-2-c2: fixture gateway performs zero network operations', async () => {
  // Regression caught: fixture mode silently reaches live ports while returning seeded objects.
  const gateway = await loadGateway();
  expect(gateway, 'renderer gateway module must exist').not.toBeNull();
  if (!gateway) return;
  let calls = 0;
  const fixture = gateway.createFixtureGateway(() => { calls += 1; throw new Error('network forbidden'); });
  await expect(fixture.health.api()).resolves.toMatchObject({ service: 'api', state: 'fixture' });
  await expect(fixture.health.engine()).resolves.toMatchObject({ service: 'engine', state: 'fixture' });
  expect(calls).toBe(0);
});

test('production live bases default to Flutter runtime ports and reject baked-in sandbox ports', async () => {
  // Regression caught: the packaged Electron renderer was permanently pinned to the parity-test
  // sandbox and could not connect to the user's real API/engine.
  const { liveEnvironment } = await import('../live-environment');
  expect(liveEnvironment({})).toEqual({
    apiBase: 'http://127.0.0.1:4001',
    engineBase: 'http://127.0.0.1:4096',
    productionApiBase: 'https://api.vcrcapps.com',
    wsBase: 'ws://127.0.0.1:4001',
  });
  const gateway = await loadGateway();
  expect(gateway, 'renderer gateway module must exist').not.toBeNull();
  if (!gateway) return;
  expect(gateway.validateLiveBase('http://127.0.0.1:4001', 'api')).toBe('http://127.0.0.1:4001');
  expect(gateway.validateLiveBase('http://127.0.0.1:4096/', 'engine')).toBe('http://127.0.0.1:4096');

  const rejected = [
    ['', 'api'], ['https://127.0.0.1:4001', 'api'], ['http://localhost:4001', 'api'],
    ['http://127.0.0.1:4098', 'api'], ['http://127.0.0.1:4097', 'engine'],
    ['http://user@127.0.0.1:4001', 'api'], ['http://127.0.0.1:4001/v1', 'api'],
    ['http://127.0.0.1:4001?x=1', 'api'], ['http://127.0.0.1:4001/#x', 'api'],
    ['http://127.0.0.1:4096', 'api'], ['http://127.0.0.1:4001', 'engine'],
  ];
  for (const [value, service] of rejected) {
    expect(() => gateway.validateLiveBase(value, service), `${service}: ${value}`).toThrow(/live configuration/i);
  }
});

test('production gateway receipt exposes Flutter runtime ports instead of sandbox constants', async () => {
  const module = await loadGateway();
  const gateway = module.createLiveGateway({
    apiBase: 'http://127.0.0.1:4001',
    engineBase: 'http://127.0.0.1:4096',
    productionApiBase: 'https://api.vcrcapps.com',
    taskToken: 'disposable-receipt-token',
  });
  expect(gateway.environment).toEqual({ apiPort: '4001', enginePort: '4096' });
});

test('credentialed production base rejects plaintext and every loopback spelling', async () => {
  const module = await loadGateway();
  for (const productionApiBase of [
    'http://api.example.com',
    'https://localhost',
    'https://localhost.',
    'https://preview.localhost',
    'https://0.0.0.0',
    'https://10.0.0.1',
    'https://169.254.1.2',
    'https://192.168.1.2',
    'https://127.0.0.1:4001',
    'https://127.42.0.7',
    'https://2130706433',
    'https://0x7f000001',
    'https://[::1]:4001',
    'https://[::]',
    'https://[fe80::1]',
    'https://[fc00::1]',
    'https://[::ffff:127.0.0.1]',
  ]) {
    expect(() => module.createLiveGateway({
      apiBase: 'http://127.0.0.1:4001',
      engineBase: 'http://127.0.0.1:4096',
      productionApiBase,
      taskToken: 'disposable-boundary-token',
    })).toThrow(/production API base/i);
  }
});

test('bucket-a-repair-c1: trusted alternate expected bases accept only matching distinct unprivileged loopback ports', async () => {
  // Regression caught: custom-port verification either remains pinned to 4098/4097 or accepts an arbitrary configured URL.
  const gateway = await loadGateway();
  expect(gateway, 'renderer gateway module must exist').not.toBeNull();
  if (!gateway) return;
  expect(gateway.validateLiveBase('http://127.0.0.1:4798', 'api', 'http://127.0.0.1:4798')).toBe('http://127.0.0.1:4798');
  expect(gateway.validateLiveBase('http://127.0.0.1:4797/', 'engine', 'http://127.0.0.1:4797')).toBe('http://127.0.0.1:4797');
  expect(() => gateway.composeGateway({
    mode: 'live',
    apiBase: 'http://127.0.0.1:4798',
    engineBase: 'http://127.0.0.1:4797',
    productionApiBase: 'https://api.example.test',
    expectedApiBase: 'http://127.0.0.1:4798',
    expectedEngineBase: 'http://127.0.0.1:4797',
    taskToken: 'disposable-repair-token',
  })).not.toThrow();

  for (const expected of [
    'file:///tmp/api',
    'http://user@127.0.0.1:4798',
    'http://127.0.0.1:4798/path',
    'http://127.0.0.1:4798?query=1',
    'http://127.0.0.1:4798#fragment',
    'http://127.0.0.1:1023',
    'http://localhost:4798',
  ]) {
    expect(() => gateway.validateLiveBase(expected, 'api', expected), expected).toThrow(/live configuration/i);
  }
  expect(() => gateway.validateLiveBase('http://127.0.0.1:4798', 'api', 'http://127.0.0.1:4799')).toThrow(/live configuration/i);
  expect(() => gateway.composeGateway({
    mode: 'live',
    apiBase: 'http://127.0.0.1:4798',
    engineBase: 'http://127.0.0.1:4798',
    productionApiBase: 'https://api.example.test',
    expectedApiBase: 'http://127.0.0.1:4798',
    expectedEngineBase: 'http://127.0.0.1:4798',
    taskToken: 'disposable-repair-token',
  })).toThrow(/distinct/i);
});

test('slice-2-c4: explicit live configuration failure never composes fixture', async () => {
  // Regression caught: an invalid explicit live request silently downgrades to fixtures.
  const gateway = await loadGateway();
  expect(gateway, 'renderer gateway module must exist').not.toBeNull();
  if (!gateway) return;
  expect(() => gateway.composeGateway({ mode: 'live', apiBase: '', engineBase: '' })).toThrow(/live configuration/i);
  expect(gateway.composeGateway({}).mode).toBe('fixture');
});

test('slice-2-c5: API and engine health failures remain separate live errors', async () => {
  // Regression caught: one generic connected badge hides which live dependency failed.
  const gateway = await loadGateway();
  expect(gateway, 'renderer gateway module must exist').not.toBeNull();
  if (!gateway) return;
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'http://127.0.0.1:4098/health') return new Response('api down', { status: 503 });
    return new Response(JSON.stringify({ healthy: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  // Disposable dummy token: satisfies the Slice 3 explicit-token requirement so this test reaches its original assertions; never sent anywhere real.
  const live = gateway.createLiveGateway({
    apiBase: 'http://127.0.0.1:4098',
    engineBase: 'http://127.0.0.1:4097',
    expectedApiBase: 'http://127.0.0.1:4098',
    expectedEngineBase: 'http://127.0.0.1:4097',
    productionApiBase: 'https://api.vcrcapps.com',
    taskToken: 'disposable-dummy-token',
  }, fetcher);
  await expect(live.health.api()).rejects.toThrow(/API.*503/i);
  await expect(live.health.engine()).resolves.toMatchObject({ service: 'engine', state: 'healthy' });
});

test('post-login local boundary omits the cloud bearer while production keeps it', async () => {
  const gateway = await loadGateway();
  expect(gateway, 'renderer gateway module must exist').not.toBeNull();
  if (!gateway) return;
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const live = gateway.createLiveGateway({
    apiBase: 'http://127.0.0.1:4098',
    engineBase: 'http://127.0.0.1:4097',
    expectedApiBase: 'http://127.0.0.1:4098',
    expectedEngineBase: 'http://127.0.0.1:4097',
    productionApiBase: 'https://api.vcrcapps.com',
    taskToken: 'disposable-cloud-token',
  }, fetcher);

  await live.domains.sessions.list();
  await live.domains.tasks.list();

  expect(calls).toEqual([
    { url: 'http://127.0.0.1:4098/agent-sessions?scope=chats', authorization: null },
    { url: 'https://api.vcrcapps.com/tasks?status=all', authorization: 'Bearer disposable-cloud-token' },
  ]);
});

test('slice-2-c7: failed live requests cannot return fixture data', async () => {
  // Regression caught: a live network failure resolves with seeded fixture content.
  const gateway = await loadGateway();
  expect(gateway, 'renderer gateway module must exist').not.toBeNull();
  if (!gateway) return;
  // Disposable dummy token: satisfies the Slice 3 explicit-token requirement so this test reaches its original assertions; never sent anywhere real.
  const live = gateway.createLiveGateway(
    {
      apiBase: 'http://127.0.0.1:4098',
      engineBase: 'http://127.0.0.1:4097',
      expectedApiBase: 'http://127.0.0.1:4098',
      expectedEngineBase: 'http://127.0.0.1:4097',
      productionApiBase: 'https://api.vcrcapps.com',
      taskToken: 'disposable-dummy-token',
    },
    async () => { throw new TypeError('connection refused'); },
  );
  await expect(live.health.api()).rejects.toThrow(/API.*connection refused/i);
  await expect(live.unsupported('sessions.list')).rejects.toThrow(/unsupported.*sessions\.list/i);
});
