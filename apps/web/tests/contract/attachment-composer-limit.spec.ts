import { expect, test, type Page, type Route } from '@playwright/test';

const origin = 'http://127.0.0.1:4592';
const cors = {
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-rhythm-human-approval',
};
const session = {
  id: 'a1-session', sdkSessionId: 'sdk-a1-session', name: 'Attachment review', status: 'idle',
  cwd: '/workspace/rhythm', branch: 'main', profileId: 'profile-a1', projectId: 'project-a1', projectName: 'Rhythm',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', permissionMode: 'default',
};
const profile = {
  id: 'profile-a1', label: 'Reviewer', enabled: true, isAgent: true, isManager: false,
  sessionSelectable: true, modelProvider: 'anthropic', modelId: 'claude-sonnet-4',
};

async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, headers: cors, json: value });
}

async function openComposer(page: Page, frames: Array<Record<string, unknown>>) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', {
      configurable: true,
      value: Object.freeze({
        version: 9,
        gateway: Object.freeze({ apiBase: 'http://127.0.0.1:4001', engineBase: 'http://127.0.0.1:4096', productionApiBase: 'https://api.vcrcapps.com' }),
        auth: Object.freeze({ signInWithGoogle: async () => ({
          sessionToken: 'a1-synthetic-owner-token',
          user: { id: 91, name: 'Attachment Owner', email: 'owner@example.test', role: 'admin', artifactTabIds: [] },
        }) }),
      }),
    });
  });
  await page.routeWebSocket('ws://127.0.0.1:4001/ws/agents', (ws) => {
    ws.onMessage((message) => {
      try { frames.push(JSON.parse(String(message))); } catch { /* no data frame */ }
    });
  });
  await page.route('http://127.0.0.1:4096/**', (route) => json(route, { healthy: true }));
  await page.route('http://127.0.0.1:4001/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    if (url.pathname === '/health') return json(route, { healthy: true });
    if (url.pathname === '/agent-configs') return json(route, [profile]);
    if (url.pathname === '/agent-sessions' && request.method() === 'GET') return json(route, { sessions: [session] });
    if (url.pathname === `/agent-sessions/${session.id}`) return json(route, { session, messages: [], transcriptPage: { nextCursor: null, hasMore: false } });
    if (['/notifications', '/agent-approvals'].includes(url.pathname) || url.pathname.endsWith('/pending-permissions')) return json(route, []);
    return json(route, { error: { code: 'NOT_FOUND' } }, 404);
  });
  await page.goto('/#/agents');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await expect(page.getByTestId('session-a1-session')).toHaveAttribute('aria-current', 'true');
}

test('A1 encoded WebSocket limit keeps an oversized selected file and draft for retry', async ({ page }) => {
  const frames: Array<Record<string, unknown>> = [];
  await openComposer(page, frames);
  await page.getByTestId('composer-input').fill('Review the selected workbook');
  await page.getByTestId('composer-live-file-input').setInputFiles({
    name: 'large.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.alloc(16 * 1024 * 1024, 0x61),
  });
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('attachment-feedback')).toContainText(/too large after encoding|20 MiB attachment limit/i);
  await expect(page.getByRole('region', { name: 'Pending attachments' })).toContainText('large.xlsx');
  await expect(page.getByTestId('composer-input')).toHaveValue('Review the selected workbook');
  expect(frames.filter((frame) => frame.type === 'session.input')).toHaveLength(0);
});

test('A1 aggregate WebSocket limit retains multiple selected files after rejection', async ({ page }) => {
  const frames: Array<Record<string, unknown>> = [];
  await openComposer(page, frames);
  await page.getByTestId('composer-input').fill('Review both files');
  await page.getByTestId('composer-live-file-input').setInputFiles([
    { name: 'one.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.alloc(8 * 1024 * 1024, 0x61) },
    { name: 'two.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.alloc(8 * 1024 * 1024, 0x62) },
  ]);
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('attachment-feedback')).toContainText(/combined WebSocket message limit/i);
  await expect(page.getByRole('region', { name: 'Pending attachments' })).toContainText('one.xlsx');
  await expect(page.getByRole('region', { name: 'Pending attachments' })).toContainText('two.xlsx');
  await expect(page.getByTestId('composer-input')).toHaveValue('Review both files');
  expect(frames.filter((frame) => frame.type === 'session.input')).toHaveLength(0);
});
