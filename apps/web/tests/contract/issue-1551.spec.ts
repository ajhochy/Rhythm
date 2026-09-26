import { expect, test, type Page, type Route } from '@playwright/test';

test.skip(process.env.RHYTHM_ISSUE_1551_CONTRACT !== '1', 'Run with the issue-1551 Playwright config');

const sessions = [
  { id: 'session-one', sdkSessionId: 'sdk-one', name: 'One', profileId: 'profile-one', cwd: '/tmp/one', status: 'working', createdAt: '2026-09-24T03:00:00Z' },
  { id: 'session-two', sdkSessionId: 'sdk-two', name: 'Two', profileId: 'profile-one', cwd: '/tmp/two', status: 'idle', createdAt: '2026-09-24T02:00:00Z' },
  { id: 'session-three', sdkSessionId: 'sdk-three', name: 'Three', profileId: 'profile-one', cwd: '/tmp/three', status: 'idle', createdAt: '2026-09-24T01:00:00Z' },
];

async function routes(page: Page, writes: Array<{ method: string; path: string; body?: unknown }> = []) {
  await page.route('http://127.0.0.1:7269/**', route => route.fulfill({ status: 200, json: { healthy: true, status: 'ready' } }));
  await page.route(/https:\/\/issue1551\.invalid|http:\/\/127\.0\.0\.1:7268/, (route: Route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      writes.push({ method: request.method(), path, body: request.postDataJSON() });
      if (request.method() === 'POST' && path === '/agent-sessions') return route.fulfill({ status: 201, json: { ...sessions[1], id: 'shortcut-created', name: 'Shortcut created', status: 'idle', createdAt: '2026-09-24T04:00:00Z' } });
      return route.fulfill({ status: path.endsWith('/cancel') ? 204 : 200, json: sessions[0] });
    }
    if (path === '/agent-configs') return route.fulfill({ json: [{ id: 'profile-one', label: 'Agent', enabled: true, isDefault: true, sessionSelectable: true }] });
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions, pageInfo: { hasMore: false, nextCursor: null } } });
    const detail = sessions.find(session => path === `/agent-sessions/${session.id}`);
    if (detail) return route.fulfill({ json: { session: detail, messages: [], transcriptPage: { hasMore: false, nextCursor: null } } });
    if (path === '/opencode/auth/accounts') return route.fulfill({ json: { accounts: [] } });
    if (path === '/opencode/auth') return route.fulfill({ json: { providers: [] } });
    if (path === '/optimizer/auto-promotion') return route.fulfill({ json: { availability: true, state: { autoPromotionEnabled: false, enabledAt: null, autoPromotionEligible: true, totalVerified: 5, totalRegressions: 0, trustThreshold: 5 } } });
    return route.fulfill({ json: path.endsWith('/health') || path === '/health' ? { healthy: true, status: 'ready' } : [] });
  });
}

async function openKeybindings(page: Page) {
  await routes(page);
  await page.goto('/#/tools/agent-settings?settingsSection=keybindings');
  return page.getByTestId('list-inspector-detail');
}

test('1551:send-key-single-store-in-agent-settings:1 shows the live send shortcut without false gap copy', async ({ page }) => {
  const detail = await openKeybindings(page);
  await expect(detail.getByLabel('Send message shortcut')).toHaveValue('Enter');
  await expect(detail).not.toContainText('Configure in Flutter');
  await expect(detail).not.toContainText('/agent-settings/keybindings');
  await expect(page.getByRole('option', { name: 'Keybindings' })).toContainText('Enter to send · This device');
});

test('1551:send-key-single-store-in-agent-settings:2 both editors share one preference and re-sync', async ({ page }) => {
  let detail = await openKeybindings(page);
  await detail.getByLabel('Send message shortcut').selectOption('Meta+Enter');
  await page.goto('/#/settings?settingsSection=keyboard-safety');
  await expect(page.getByLabel('Send message key')).toHaveValue('Meta+Enter');
  await page.getByLabel('Send message key').selectOption('Enter');
  await page.getByRole('button', { name: 'Save keyboard preference' }).click();
  await page.goto('/#/tools/agent-settings?settingsSection=keybindings');
  detail = page.getByTestId('list-inspector-detail');
  await expect(detail.getByLabel('Send message shortcut')).toHaveValue('Enter');
});

test('1551:send-key-single-store-in-agent-settings:3 reset restores defaults and reload persistence', async ({ page }) => {
  let detail = await openKeybindings(page);
  await detail.getByLabel('Send message shortcut').selectOption('Meta+Enter');
  await page.reload(); detail = page.getByTestId('list-inspector-detail');
  await expect(detail.getByLabel('Send message shortcut')).toHaveValue('Meta+Enter');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rhythm.settings.fixture') ?? '{}').sendKey)).toBe('Meta+Enter');
  await detail.getByRole('button', { name: 'Reset shortcuts' }).click();
  await expect(detail.getByLabel('Send message shortcut')).toHaveValue('Enter');
});

async function openAgents(page: Page, preferences: Record<string, unknown> = {}) {
  const writes: Array<{ method: string; path: string; body?: unknown }> = [];
  await page.addInitScript(prefs => { localStorage.setItem('rhythm.settings.4189', JSON.stringify(prefs)); localStorage.setItem('rhythm-agents-live-selected-session', 'session-one'); }, preferences);
  await routes(page, writes);
  await page.routeWebSocket(/\/ws\/agents$/, () => undefined);
  await page.goto('/tests/electron-e22-harness.html#/agents');
  await expect(page.getByTestId('session-session-one')).toHaveAttribute('aria-current', 'true');
  return writes;
}

test('1551:session-shortcuts-enforced:2 changing new-session shortcut disables the old chord', async ({ page }) => {
  const writes = await openAgents(page, { newSessionKey: 'Meta+Shift+N' });
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('session-session-one')).toHaveAttribute('aria-current', 'true');
  expect(writes.filter(write => write.method === 'POST' && write.path === '/agent-sessions')).toHaveLength(0);
  await page.keyboard.press('Control+Shift+N');
  await expect.poll(() => writes.filter(write => write.method === 'POST' && write.path === '/agent-sessions')).toHaveLength(1);
  await expect(page.getByRole('heading', { name: 'Shortcut created', exact: true })).toBeVisible();
  await expect(page.getByTestId('state')).toContainText('shortcut-created');
});

test('1551:session-shortcuts-enforced:3 Escape cancels only with no overlay open', async ({ page }) => {
  const writes = await openAgents(page);
  await page.getByTestId('session-actions').click(); await page.keyboard.press('Escape');
  expect(writes.filter(write => write.path.endsWith('/cancel'))).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => writes.filter(write => write.path.endsWith('/cancel')).length).toBe(1);
});

test('1551:session-shortcuts-enforced:4 bracket chords follow visible rail order', async ({ page }) => {
  await openAgents(page);
  await page.keyboard.press('Control+]');
  await expect(page.getByTestId('session-session-two')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Control+[');
  await expect(page.getByTestId('session-session-one')).toHaveAttribute('aria-current', 'true');
});

test('1551:session-shortcuts-enforced:5 reset restores all four enforced shortcuts', async ({ page }) => {
  const detail = await openKeybindings(page);
  await detail.getByLabel('New session shortcut').selectOption('Meta+Shift+N');
  await detail.getByLabel('Cancel turn shortcut').selectOption('Meta+Period');
  await detail.getByLabel('Switch session shortcut').selectOption('Alt+ArrowUp/Down');
  await detail.getByRole('button', { name: 'Reset shortcuts' }).click();
  await expect(detail.getByLabel('New session shortcut')).toHaveValue('Meta+N');
  await expect(detail.getByLabel('Cancel turn shortcut')).toHaveValue('Escape');
  await expect(detail.getByLabel('Switch session shortcut')).toHaveValue('Meta+BracketLeft/Right');
});
