import { expect, test } from '@playwright/test';
import { openFixture, openPage } from './helpers';

test('1565:remaining-literals-and-adhoc-formatters:1 live automation overview has no fabricated date or provider count', async ({ page }) => {
  await page.route((url) => ['http://127.0.0.1:65534', 'http://127.0.0.1:65533'].includes(url.origin), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': request.headers().origin ?? '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.origin === 'http://127.0.0.1:65533' || url.pathname === '/health') return route.fulfill({ headers, json: { healthy: true, status: 'ready' } });
    const bodies: Record<string, unknown> = {
      '/automation-catalog/triggers': [{ key: 'rhythm.task_due', source: 'rhythm', label: 'Task due', configSchema: {} }],
      '/automation-catalog/actions': [{ key: 'create_task', label: 'Create task', configSchema: {} }],
      '/automation-catalog/providers': [{ source: 'rhythm', label: 'Rhythm' }, { source: 'gmail', label: 'Gmail' }],
      '/automation-rules': [],
      '/integrations/accounts': [],
      '/agent-sessions': { sessions: [], pageInfo: { hasMore: false, nextCursor: null } },
      '/agent-configs': [],
      '/opencode/auth/accounts': { accounts: [] },
    };
    await route.fulfill({ headers, json: bodies[url.pathname] ?? [] });
  });
  await page.route('**/tests/issue-1565-automations.html', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { FixtureProvider } = await import('/src/store.tsx');
    const { GatewayProvider } = await import('/src/gateway/context.tsx');
    const { composeGateway } = await import('/src/gateway/index.ts');
    const { AutomationsPage } = await import('/src/pages/automations/index.tsx');
    await import('/src/styles.css');
    const gateway = composeGateway({ mode: 'live', apiBase: 'http://127.0.0.1:65534', expectedApiBase: 'http://127.0.0.1:65534', engineBase: 'http://127.0.0.1:65533', expectedEngineBase: 'http://127.0.0.1:65533', productionApiBase: 'https://automation-fixture.invalid', taskToken: 'synthetic' });
    createRoot(document.getElementById('root')).render(React.createElement(GatewayProvider, { gateway }, React.createElement(FixtureProvider, null, React.createElement(AutomationsPage, { route: '/automations' }))));
  </script></body></html>` }));
  await page.goto('/tests/issue-1565-automations.html');
  await expect(page.getByLabel('Automation summary')).not.toContainText('Aug 12');
  await expect(page.getByLabel('Automation summary')).not.toContainText('15:45');
  await expect(page.getByTestId('automations-provider-count')).toHaveCount(0);
});

test('issue-1565: transcript and owned fixture surfaces show semantic timestamps without horizontal overflow', async ({ page }, info) => {
  test.setTimeout(90_000);
  const surfaces = [
    ['transcript', 'agents', true, '2:01 PM'],
    ['messages', 'messages', false, '3:36 PM'],
    ['schedules', 'tools/tasks', true, 'Aug 11, 8:00 AM'],
    ['email', 'tools/email', true, 'Aug 12, 3:36 PM'],
    ['mobile', 'mobile-access', false, 'Aug 10, 5:00 AM'],
    ['facilities', 'facilities', false, '10:00 AM'],
    ['integrations', 'integrations', false, '3:32 PM'],
    ['automations', 'automations', false, '2:35 PM'],
  ] as const;
  for (const [name, route, tool, expectedLabel] of surfaces) {
    if (tool) await openFixture(page, `#/${route}`);
    else await openPage(page, route);
    if (name === 'messages') await page.getByRole('option', { name: 'Weekend Team' }).click();
    if (name === 'schedules') await page.getByTestId('schedule-schedule-health').click();
    if (name === 'facilities') await page.getByRole('option', { name: /Leadership sync/ }).first().click();
    if (name === 'automations') await page.getByRole('option', { name: /Nudge owners before tasks are due/ }).click();
    await expect(page.getByText(expectedLabel, { exact: true }).first(), `${name} exact timestamp`).toBeVisible();
    const times = page.locator('#main-content time[datetime][title]');
    if (['transcript', 'messages', 'mobile', 'facilities'].includes(name)) {
      await expect(times.first(), `${name} must show a formatted time`).toBeVisible();
      const full = await times.first().getAttribute('title');
      expect(full, `${name} retains seconds, year and zone`).toMatch(/2026.*\d+:\d{2}:\d{2}.*(?:PDT|PST)/);
      await expect(times.first().locator('[aria-hidden="true"]')).toBeVisible();
      await expect(times.first().locator('.sr-only')).toHaveText(full!);
    }
    await expect(page.locator('#main-content')).not.toContainText('Time unavailable');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow`).toBe(true);
    await page.screenshot({ path: info.outputPath(`issue-1565-${name}.png`), fullPage: true });
  }
});

test.describe('second timezone', () => {
  test.use({ timezoneId: 'Asia/Kolkata' });
  test('issue-1565: zoned reservation renders in viewer zone without unavailable time', async ({ page }, info) => {
    await openPage(page, 'facilities');
    await page.getByRole('option', { name: /Leadership sync/ }).first().click();
    const time = page.locator('#main-content time[datetime][title]').first();
    await expect(time).toBeVisible();
    await expect(time.locator('[aria-hidden="true"]')).toHaveText('Aug 12, 10:30 PM');
    await expect(page.locator('#main-content')).not.toContainText('Time unavailable');
    await page.screenshot({ path: info.outputPath('issue-1565-kolkata.png'), fullPage: true });
  });
});
