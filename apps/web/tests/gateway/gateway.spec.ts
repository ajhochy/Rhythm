import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const gatewayModulePath = '../../src/gateway/index.ts';

test('slice-2-c19: renderer CSP permits only the live HTTP and session WebSocket destinations', async () => {
  // Regression caught: connect-src blocks live health/session input or broadens access beyond the exact sandbox services.
  const html = await readFile(path.resolve(import.meta.dirname, '../../index.html'), 'utf8');
  const connectSrc = html.match(/(?:^|;)\s*connect-src\s+([^;]+)/)?.[1].trim().split(/\s+/);
  expect(connectSrc).toEqual(['http://127.0.0.1:4098', 'http://127.0.0.1:4097', 'ws://127.0.0.1:4098']);
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

test('slice-2-c3: live bases accept only exact loopback HTTP ports', async () => {
  // Regression caught: aliases, credentials, paths, or production ports bypass the fail-closed live seam.
  const gateway = await loadGateway();
  expect(gateway, 'renderer gateway module must exist').not.toBeNull();
  if (!gateway) return;
  expect(gateway.validateLiveBase('http://127.0.0.1:4098', 'api')).toBe('http://127.0.0.1:4098');
  expect(gateway.validateLiveBase('http://127.0.0.1:4097/', 'engine')).toBe('http://127.0.0.1:4097');

  const rejected = [
    ['', 'api'], ['https://127.0.0.1:4098', 'api'], ['http://localhost:4098', 'api'],
    ['http://127.0.0.1:4001', 'api'], ['http://127.0.0.1:4096', 'engine'],
    ['http://user@127.0.0.1:4098', 'api'], ['http://127.0.0.1:4098/v1', 'api'],
    ['http://127.0.0.1:4098?x=1', 'api'], ['http://127.0.0.1:4098/#x', 'api'],
    ['http://127.0.0.1:4097', 'api'], ['http://127.0.0.1:4098', 'engine'],
  ];
  for (const [value, service] of rejected) {
    expect(() => gateway.validateLiveBase(value, service), `${service}: ${value}`).toThrow(/live configuration/i);
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
    productionApiBase: 'http://127.0.0.1:4798',
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
    productionApiBase: 'http://127.0.0.1:4798',
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
  const live = gateway.createLiveGateway({ apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097', productionApiBase: 'https://api.vcrcapps.com', taskToken: 'disposable-dummy-token' }, fetcher);
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
    { apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097', productionApiBase: 'https://api.vcrcapps.com', taskToken: 'disposable-dummy-token' },
    async () => { throw new TypeError('connection refused'); },
  );
  await expect(live.health.api()).rejects.toThrow(/API.*connection refused/i);
  await expect(live.unsupported('sessions.list')).rejects.toThrow(/unsupported.*sessions\.list/i);
});
