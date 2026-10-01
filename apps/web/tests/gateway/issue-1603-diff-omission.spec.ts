import { expect, test, type Route } from '@playwright/test';

test('issue-1603: real gateway and Changes panel retain exact patches and explain omitted previews', async ({ page }) => {
  const cors = { 'access-control-allow-origin': 'http://127.0.0.1:4591',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-rhythm-human-approval' };
  const json = (route: Route, value: unknown) => route.fulfill({ status: 200, headers: cors, json: value });
  const profile = { id: 'memory-profile', label: 'Synthetic', enabled: true, isAgent: true,
    sessionSelectable: true, modelProvider: 'synthetic', modelId: 'text' };
  const session = { id: 'memory-session', sdkSessionId: 'memory-sdk', name: 'Synthetic memory test',
    status: 'idle', cwd: '/synthetic', profileId: profile.id, projectId: 'synthetic-project',
    createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' };
  const patch = '--- small.txt\n+++ small.txt\n@@ -1 +1 @@\n-before\n+after\n';
  await page.addInitScript(() => Object.defineProperty(window, 'rhythmShell', { configurable: true,
    value: Object.freeze({ version: 9,
      gateway: Object.freeze({ apiBase: 'http://127.0.0.1:4001', engineBase: 'http://127.0.0.1:4096', productionApiBase: 'https://api.vcrcapps.com' }),
      auth: Object.freeze({ signInWithGoogle: async () => ({ sessionToken: 'synthetic-memory-token',
        user: { id: 91, name: 'Synthetic Owner', email: 'synthetic@example.invalid', role: 'admin', artifactTabIds: [] } }) }),
    }) }));
  await page.routeWebSocket('ws://127.0.0.1:4001/ws/agents', () => undefined);
  await page.route('http://127.0.0.1:4096/**', route => json(route, { healthy: true }));
  await page.route('http://127.0.0.1:4001/**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(route.request().url()).pathname;
    if (path === '/health') return json(route, { healthy: true });
    if (path === '/agent-configs') return json(route, [profile]);
    if (path === '/agent-sessions') return json(route, { sessions: [session] });
    if (path === '/agent-sessions/memory-session') return json(route, { session, messages: [{ sdkMessageId: 'synthetic-message', info: { role: 'input', time: 1790856000000 }, parts: [{ type: 'text', text: 'Inspect changes' }] }], transcriptPage: { hasMore: false, nextCursor: null } });
    if (path === '/agent-sessions/memory-session/diff') return json(route, [
      { file: 'small.txt', patch, additions: 1, deletions: 1 },
      { file: 'large.txt', patch: '', patchOmitted: 'file_too_large', additions: 8, deletions: 3 },
    ]);
    return json(route, []);
  });
  await page.goto('/#/agents');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByTestId('transcript')).toBeVisible();
  await page.getByTestId('inspector-changes').click();
  await expect(page.getByTestId('changes-panel')).toBeVisible();
  await page.getByTestId('change-file-small-txt').click();
  await expect(page.locator('pre.diff-code')).toHaveText(patch);
  await expect(page.getByTestId('change-file-large-txt')).toContainText('+8 −3');
  await page.getByTestId('change-file-large-txt').click();
  await expect(page.getByText('Patch preview omitted to keep this session responsive; change counts are available.')).toBeVisible();
  await expect(page.getByText('No changes.', { exact: true })).toHaveCount(0);
});
