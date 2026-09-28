import { expect, test, type Page, type Route, type WebSocketRoute } from '@playwright/test';

test.skip(process.env.RHYTHM_ISSUE_1550_CONTRACT !== '1', 'Run with the issue-1550 Playwright config');

const session = { id: 'behavior-session', sdkSessionId: 'ses_behavior', name: 'Behavior session', profileId: 'behavior-profile', cwd: '/tmp/behavior', status: 'idle', createdAt: '2026-09-24T00:00:00Z' };

async function installSettingsRoutes(page: Page) {
  await page.route('http://127.0.0.1:7265/**', route => route.fulfill({ status: 200, json: { healthy: true, status: 'ready' } }));
  await page.route('https://issue1550.invalid/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/optimizer/auto-promotion') return route.fulfill({ status: 200, json: { availability: true, state: { autoPromotionEnabled: false, enabledAt: null, autoPromotionEligible: true, totalVerified: 5, totalRegressions: 0, trustThreshold: 5 } } });
    return route.fulfill({ status: 200, json: [] });
  });
  await page.route('http://127.0.0.1:7264/**', (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/opencode/auth/accounts') return route.fulfill({ status: 200, json: { accounts: [] } });
    if (path === '/opencode/auth') return route.fulfill({ status: 200, json: { providers: [] } });
    return route.fulfill({ status: 200, json: path === '/health' ? { healthy: true } : [] });
  });
}

async function openBehavior(page: Page) {
  await installSettingsRoutes(page);
  await page.goto('/#/tools/agent-settings');
  await page.getByRole('option', { name: 'Behavior', exact: true }).click();
  return page.getByTestId('list-inspector-detail');
}

test('1550:behavior-device-pref-and-modal:3 Behavior exposes a real default-off destructive confirmation switch', async ({ page }) => {
  // Regression: Behavior renders only a false endpoint gap notice and redirects users to Flutter.
  const detail = await openBehavior(page);
  const control = detail.getByRole('switch', { name: /destructive-tool confirmation/i });
  await expect(control).not.toBeChecked();
  await expect(detail).not.toContainText('Configure in Flutter');
  await expect(detail.getByRole('note')).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Behavior' })).not.toContainText('Configure in Flutter Agent settings');
});

test('1550:behavior-device-pref-and-modal:4 Behavior persists per-device account-scoped state across reload', async ({ page }) => {
  // Regression: the switch is cosmetic or writes a second store that disappears on reload.
  let detail = await openBehavior(page);
  await detail.getByRole('switch', { name: /destructive-tool confirmation/i }).check();
  await expect(detail).toContainText('This device');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rhythm.settings.fixture') ?? '{}').requireDestructiveModal)).toBe(true);
  await page.reload();
  await page.getByRole('option', { name: 'Behavior', exact: true }).click();
  detail = page.getByTestId('list-inspector-detail');
  await expect(detail.getByRole('switch', { name: /destructive-tool confirmation/i })).toBeChecked();
});

async function permissionCase(page: Page, enabled: boolean, tool: string) {
  await page.addInitScript(({ enabled }) => localStorage.setItem('rhythm.settings.4189', JSON.stringify({ requireDestructiveModal: enabled })), { enabled });
  const sockets: WebSocketRoute[] = [];
  const posts: Array<{ path: string; body: unknown }> = [];
  await page.routeWebSocket(/\/ws\/agents$/, socket => sockets.push(socket));
  await page.route(/https:\/\/issue1550\.invalid|http:\/\/127\.0\.0\.1:726[45]/, route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST') { posts.push({ path, body: request.postDataJSON() }); return route.fulfill({ status: 204 }); }
    if (path === '/agent-configs') return route.fulfill({ json: [{ id: 'behavior-profile', label: 'Behavior', enabled: true, sessionSelectable: true }] });
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions: [session], pageInfo: { hasMore: false, nextCursor: null } } });
    if (path === `/agent-sessions/${session.id}`) return route.fulfill({ json: { session, messages: [{ sdkMessageId: 'msg_behavior', role: 'output', parts: [{ type: 'text', text: 'Ready' }] }], transcriptPage: { hasMore: false, nextCursor: null } } });
    if (path.endsWith('/pending-permissions') || path === '/question') return route.fulfill({ json: [] });
    return route.fulfill({ json: path.endsWith('/health') ? { status: 'ready' } : [] });
  });
  await page.goto('/tests/electron-e22-harness.html#/agents');
  // The live store connects its socket before the selected transcript finishes hydrating.
  // Match the E24 harness boundary so the decision is emitted only after that session owns the view.
  await expect(page.getByTestId('message-msg_behavior')).toBeVisible();
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  sockets[0].send(JSON.stringify({ type: 'permission.asked', sessionId: session.id, permissionID: `permission-${tool}`, tool, directory: session.cwd, patterns: ['synthetic pattern'], title: `${tool} approval` }));
  await expect(page.getByTestId('permission-card')).toBeVisible();
  return { posts };
}

test('1550:behavior-device-pref-and-modal:5 preference escalates only destructive live permissions and preserves replies', async ({ browser }) => {
  // Regression: the preference does not affect the real permission.asked surface or escalates non-destructive tools.
  for (const scenario of [{ enabled: true, tool: 'bash', dialog: true }, { enabled: true, tool: 'read', dialog: false }, { enabled: false, tool: 'bash', dialog: false }]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { posts } = await permissionCase(page, scenario.enabled, scenario.tool);
    await expect(page.getByRole('dialog')).toHaveCount(scenario.dialog ? 1 : 0);
    const surface = scenario.dialog ? page.getByRole('dialog') : page.getByTestId('permission-card');
    for (const [testId, name] of [['permission-allow-once', 'Allow once'], ['permission-always', 'Always allow'], ['permission-deny', 'Deny']] as const) {
      const action = surface.getByTestId(testId);
      await expect(action).toBeVisible();
      await expect(action).toHaveAccessibleName(name);
    }
    if (scenario.dialog) {
      await surface.getByRole('button', { name: 'Allow once' }).click();
      await expect.poll(() => posts).toEqual([{ path: `/agent-sessions/${session.id}/permissions/permission-bash/reply`, body: { reply: 'once' } }]);
    }
    await context.close();
  }
});

test('1550:behavior-device-pref-and-modal:6 fixture Behavior no longer claims server endpoints are required', async ({ page }) => {
  // Regression: the deterministic fixture continues teaching the obsolete /agent-settings/behavior contract.
  await page.goto('http://127.0.0.1:7266/#/tools/agent-settings');
  await page.getByRole('option', { name: 'Behavior', exact: true }).click();
  const detail = page.getByTestId('list-inspector-detail');
  await expect(detail.getByRole('switch', { name: /destructive-tool confirmation/i })).toBeVisible();
  await expect(detail).not.toContainText('/agent-settings/behavior');
  await expect(detail).not.toContainText('Configure in Flutter');
});
