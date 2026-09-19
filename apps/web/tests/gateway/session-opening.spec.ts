import { expect, test, type Page, type Route } from '@playwright/test';

const profile = { id: 'profile-1', label: 'Reviewer', icon: 'AG', enabled: true, isAgent: true, isManager: false, sessionSelectable: true };
const row = (id: string, scope = 'chats') => ({ id, name: `Session ${id}`, scope, status: 'idle', cwd: '/workspace/rhythm', branch: 'main', profileId: profile.id, sdkSessionId: `sdk-${id}`, createdAt: '2026-09-18T12:00:00Z', updatedAt: '2026-09-18T12:00:00Z', archivedAt: id === 'archived' ? '2026-09-18T13:00:00Z' : null });
const deferred = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };

async function harness(page: Page, options: { delayedList?: Promise<void>; delayedB?: Promise<void>; bStatus?: number } = {}) {
  const requests: string[] = [], mutations: string[] = [], frames: any[] = [];
  const json = (route: Route, status: number, value: unknown) => route.fulfill({ status, headers: { 'access-control-allow-origin': 'http://127.0.0.1:4615', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-rhythm-human-approval' }, json: value });
  await page.addInitScript(() => {
    localStorage.setItem('rhythm-agents-live-selected-session', 'A');
    Object.defineProperty(window, 'rhythmShell', { configurable: true, value: { version: 9, gateway: { apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097', productionApiBase: 'https://api.vcrcapps.com' }, auth: { signInWithGoogle: async () => ({ sessionToken: 'synthetic-session-opening', user: { id: 91, name: 'Test Owner', email: 'owner@example.test', role: 'admin', artifactTabIds: [] } }) } } });
  });
  await page.routeWebSocket('ws://127.0.0.1:4098/ws/agents', ws => { ws.onMessage(value => { try { frames.push(JSON.parse(String(value))); } catch {} }); });
  await page.route('https://api.vcrcapps.com/**', route => json(route, 200, []));
  await page.route('http://127.0.0.1:4097/**', route => json(route, 200, new URL(route.request().url()).pathname === '/question' ? [] : { healthy: true }));
  await page.route('http://127.0.0.1:4098/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'OPTIONS') return json(route, 204, null);
    requests.push(url.pathname);
    if (request.method() !== 'GET') mutations.push(`${request.method()} ${url.pathname}`);
    if (url.pathname === '/health') return json(route, 200, { healthy: true });
    if (url.pathname === '/agent-configs') return json(route, 200, [profile]);
    if (url.pathname === '/agent-sessions') {
      if (options.delayedList) await options.delayedList;
      return json(route, 200, { sessions: [row('A')], ancestors: [], pageInfo: { hasMore: false, nextCursor: null } });
    }
    const match = url.pathname.match(/^\/agent-sessions\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (id === 'B' && options.delayedB) await options.delayedB;
      const status = id === 'B' ? options.bStatus ?? 200 : ['A', 'C', 'scheduled', 'archived'].includes(id) ? 200 : 404;
      if (status !== 200) return json(route, status, { error: { code: 'NOT_FOUND' } });
      return json(route, 200, { session: row(id, id === 'scheduled' ? 'scheduled' : 'chats'), messages: [{ sdkMessageId: `message-${id}`, info: { role: 'output', time: 1755259200000 }, parts: [{ type: 'text', text: `Transcript for ${id}` }] }], transcriptPage: { hasMore: false, nextCursor: null } });
    }
    if (url.pathname === '/agent-approvals' || url.pathname === '/notifications' || url.pathname.endsWith('/pending-permissions')) return json(route, 200, []);
    return json(route, 404, { error: { code: 'NOT_FOUND' } });
  });
  return { requests, mutations, frames };
}
async function open(page: Page, hash: string) { await page.goto(`/${hash}`); await page.getByRole('button', { name: 'Continue with Google' }).click(); }
async function selected(page: Page, id: string) { await expect(page.getByRole('heading', { name: `Session ${id}`, exact: true })).toBeVisible(); await expect(page.getByText(`Transcript for ${id}`, { exact: true })).toBeVisible(); }

test('session-opening-c1: direct local ID outside the first page overrides saved selection', async ({ page }, info) => {
  // Regression: bootstrap falls back to A because B is absent from the initial list.
  const h = await harness(page); await open(page, '#/agents?sessionId=B&approvalId=approval-B'); await selected(page, 'B');
  expect(h.requests).toContain('/agent-sessions/B'); expect(h.requests).not.toContain('/agent-sessions/sdk-B');
  expect(h.mutations).toEqual([]); expect(h.frames.filter(frame => !['session.subscribe', 'session.unsubscribe'].includes(frame.type))).toEqual([]);
  await page.screenshot({ path: info.outputPath('exact-session.png') });
  await page.getByTestId('session-A').click(); await selected(page, 'A');
});
test('session-opening-c2: changing only sessionId updates the visible conversation', async ({ page }) => {
  await harness(page); await open(page, '#/agents?sessionId=B'); await selected(page, 'B');
  await page.evaluate(() => { location.hash = '#/agents?sessionId=C'; }); await selected(page, 'C');
});
test('session-opening-c3: the latest link survives delayed initial hydration', async ({ page }) => {
  const gate = deferred(); await harness(page, { delayedList: gate.promise }); await open(page, '#/agents?sessionId=B');
  await page.evaluate(() => { location.hash = '#/agents?sessionId=C'; }); gate.release(); await selected(page, 'C');
});
test('session-opening-c4: stale detail failure cannot replace the newer selected session', async ({ page }) => {
  const gate = deferred(); const h = await harness(page, { delayedB: gate.promise, bStatus: 404 }); await open(page, '#/agents'); await selected(page, 'A');
  await page.evaluate(() => { location.hash = '#/agents?sessionId=B'; }); await expect.poll(() => h.requests.includes('/agent-sessions/B')).toBe(true);
  await page.evaluate(() => { location.hash = '#/agents?sessionId=C'; }); await selected(page, 'C');
  const failed = page.waitForResponse(response => response.url().includes('/agent-sessions/B?') && response.status() === 404);
  gate.release(); await (await failed).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByTestId('connection-status')).not.toContainText('could not be loaded'); await selected(page, 'C');
});
test('session-opening-c5: missing session reports failure without opening a different conversation', async ({ page }, info) => {
  await harness(page); await open(page, '#/agents?sessionId=missing');
  await expect(page.getByTestId('connection-status')).toContainText('could not be loaded');
  await expect(page.getByRole('heading', { name: 'Session A', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('missing-session.png') });
});
test('session-opening-c6: malformed and repeated IDs are visibly rejected', async ({ page }) => {
  const h = await harness(page); await open(page, '#/agents?sessionId=A&sessionId=B');
  await expect(page.getByTestId('connection-status')).toContainText('session link is invalid');
  expect(h.requests.filter(path => /^\/agent-sessions\/[^/]+$/.test(path))).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Session A', exact: true })).toHaveCount(0);
});
test('session-opening-c7: a scheduled session opens with its matching rail scope', async ({ page }) => {
  await harness(page); await open(page, '#/agents?sessionId=scheduled'); await selected(page, 'scheduled');
  await expect(page.getByRole('tab', { name: 'Scheduled', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('session-opening-c8: the built capability contract matches the accepted URI', async ({ request }) => {
  const response = await request.get('/desktop-capabilities.json');
  expect(await response.json()).toEqual({ version: 1, agentSessionDeepLink: true });
});

test('session-opening-c9: an older reconciliation failure cannot clear the latest link', async ({ page }) => {
  // Regression: background detail(B) returns 404 after selecting C and clears C's selection.
  const options: { delayedB?: Promise<void>; bStatus?: number } = {};
  const h = await harness(page, options); await open(page, '#/agents?sessionId=B'); await selected(page, 'B');
  const gate = deferred(); options.delayedB = gate.promise; options.bStatus = 404;
  const before = h.requests.filter(path => path === '/agent-sessions/B').length;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => h.requests.filter(path => path === '/agent-sessions/B').length).toBeGreaterThan(before);
  await page.evaluate(() => { location.hash = '#/agents?sessionId=C'; }); await selected(page, 'C');
  const failed = page.waitForResponse(response => response.url().includes('/agent-sessions/B?') && response.status() === 404);
  gate.release(); await (await failed).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await selected(page, 'C');
});

test('session-opening-c10: an archived session opens without unarchiving it', async ({ page }) => {
  const h = await harness(page); await open(page, '#/agents?sessionId=archived'); await selected(page, 'archived');
  expect(h.mutations).toEqual([]);
  expect(h.frames.filter(frame => !['session.subscribe', 'session.unsubscribe'].includes(frame.type))).toEqual([]);
});
