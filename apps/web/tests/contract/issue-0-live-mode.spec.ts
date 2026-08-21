import { expect, test } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const bridge = 'http://127.0.0.1:4173/__rhythm_live';
const projectRoot = path.resolve(import.meta.dirname, '../..');

test('issue-0-c1: live bridge reports real API and engine health', async ({ request }) => {
  // Regression caught: a Live badge can appear while either loopback dependency is unreachable.
  const response = await request.get(`${bridge}/health`);
  expect(response.ok()).toBeTruthy();
  const health = await response.json();
  expect(health).toMatchObject({ mode: 'live', api: { connected: true, service: 'rhythm-api-server' }, engine: { connected: true, healthy: true } });
});

test('issue-0-c2: live sessions are exposed with an unmistakable environment receipt', async ({ request }) => {
  // Regression caught: Live mode silently renders seeded fixtures instead of GET /agent-sessions.
  const response = await request.get(`${bridge}/api/agent-sessions`);
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['x-rhythm-environment']).toBe('live');
  const body = await response.json();
  expect(Array.isArray(body.sessions ?? body)).toBeTruthy();
});

test('issue-0-c3: selected live session hydration uses exact detail routes', async ({ request }) => {
  // Regression caught: selection only changes local state and never hydrates server-owned panels.
  const response = await request.get(`${bridge}/meta/control-map`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.sessionHydration).toEqual([
    'GET /agent-sessions/:id',
    'GET /agent-sessions/:id/messages',
    'GET /agent-sessions/:id/todo',
    'GET /agent-sessions/:id/diff',
  ]);
});

test('issue-0-c4: same-origin WebSocket bridge exposes the real agents gateway', async ({ request }) => {
  // Regression caught: REST is live while events stay fixture-only or connect to the guarded origin directly.
  const response = await request.get(`${bridge}/meta`);
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({ websocket: '/__rhythm_live/ws/agents', upstream: 'ws://127.0.0.1:4001/ws/agents', stripsBrowserOriginOnLoopbackHop: true });
});

test('issue-0-c5: live smoke lifecycle is constrained to smoke-prefixed recoverable records', async ({ request }) => {
  // Regression caught: automated smoke can mutate or hard-delete a pre-existing user record.
  const response = await request.get(`${bridge}/meta/smoke-policy`);
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({ requiredNamePrefix: '[SMOKE] Rhythm web live', allowed: ['create', 'read', 'rename', 'prompt', 'cancel', 'archive'], forbidden: ['hard-delete', 'worktree-reset', 'worktree-remove', 'profile-delete', 'webhook-delete', 'proposal-approve', 'proposal-reject'] });
});

test('issue-0-c6: live control adapter manifest covers every exact endpoint while fixtures remain explicit', async ({ request }) => {
  // Regression caught: an enabled Tool action continues mutating only React fixture state in Live mode.
  const response = await request.get(`${bridge}/meta/control-map`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.modeSwitch).toEqual(['live', 'fixtures']);
  expect(body.controls).toEqual(expect.arrayContaining(['/agent-memory', '/agent-research', '/agent-schedules', '/agent-webhooks', '/opencode/skills', '/opencode/commands', '/agent-cookbook', '/agent-org-proposals', '/agents/run-quality', '/integrations/gmail-signals', '/agent-designs']));
});

test('issue-0-c7: failed live requests return truthful errors without fixture fallback', async ({ request }) => {
  // Regression caught: live 404/5xx is reported as success after silently applying fixture state.
  const response = await request.get(`${bridge}/api/__contract_missing_route__`, { failOnStatusCode: false });
  expect(response.status()).toBe(404);
  expect(response.headers()['x-rhythm-environment']).toBe('live');
  const body = await response.json();
  expect(body.fixtureFallback).toBe(false);
});

test('issue-0-c8: web suite baseline remains 58 and the project is web-only', async () => {
  // Regression caught: live mode ships by deleting coverage or reintroducing a non-web runtime.
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  expect(JSON.stringify(packageJson).toLowerCase()).not.toContain('electron');
  await expect(stat(path.join(projectRoot, 'electron'))).rejects.toThrow();
  await expect(stat(path.join(projectRoot, 'release'))).rejects.toThrow();
  expect(packageJson.scripts['test:list']).toBeTruthy();
  expect(packageJson.scripts['live:dev']).toBeTruthy();
  expect(packageJson.scripts['test:live']).toBeTruthy();
});
