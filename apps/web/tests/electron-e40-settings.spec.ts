import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createLiveSettingsGateway } from '../src/gateway/settings';

test('E40: settings gateway uses authenticated workspace and preference routes', async () => {
  const seen: Array<{ path: string; method: string; body: any; auth: string | null }> = [];
  const gateway = createLiveSettingsGateway('https://settings.invalid', 'settings-token', async (input, init) => {
    const url = new URL(String(input)); seen.push({ path: url.pathname, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get('authorization') });
    return new Response(url.pathname.endsWith('/role') || init?.method === 'DELETE' ? null : JSON.stringify(url.pathname.endsWith('/members') ? [] : { id: 1, name: 'Workspace', role: 'admin' }), { status: url.pathname.endsWith('/role') || init?.method === 'DELETE' ? 204 : 200, headers: { 'content-type': 'application/json' } });
  });
  await gateway.workspace(); await gateway.members(); await gateway.updateRole(2, 'admin'); await gateway.updateUser(2, { isFacilitiesManager: true }); await gateway.updatePreferences({ emailNotificationsEnabled: false });
  expect(seen).toEqual(expect.arrayContaining([
    { path: '/workspaces/me', method: 'GET', body: null, auth: 'Bearer settings-token' }, { path: '/workspaces/me/members', method: 'GET', body: null, auth: 'Bearer settings-token' },
    { path: '/workspaces/me/members/2/role', method: 'PATCH', body: { role: 'admin' }, auth: 'Bearer settings-token' }, { path: '/users/2', method: 'PATCH', body: { isFacilitiesManager: true }, auth: 'Bearer settings-token' },
    { path: '/users/me/preferences', method: 'PATCH', body: { emailNotificationsEnabled: false }, auth: 'Bearer settings-token' },
  ]));
});

test('E40: Settings is routed and links existing account, integration, mobile, and memory surfaces', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'); const shell = await readFile(new URL('../src/components/Shell.tsx', import.meta.url), 'utf8'); const page = await readFile(new URL('../src/pages/settings/index.tsx', import.meta.url), 'utf8');
  expect(app).toContain("route === '/settings'"); expect(shell).toContain("'Settings'");
  for (const path of ['/tools/agent-settings', '/integrations', '/mobile-access', '/tools/brain']) expect(page).toContain(path);
  expect(page).toContain('isFacilitiesManager'); expect(page).toContain('emailNotificationsEnabled');
});
