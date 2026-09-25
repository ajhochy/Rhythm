import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// This suite needs its own intercepted live-gateway webServer, not default fixture discovery.
test.skip(process.env.RHYTHM_ISSUE_1559_CONTRACT !== '1', 'Run with the issue-1559 live-gateway Playwright config');

const paths = ['/agent-configs', '/opencode/auth/accounts', '/opencode/mcp', '/opencode/auth'];
const names = ['Profiles overview', 'Auto-promotion', 'Accounts', 'Behavior', 'Keybindings', 'Runtime / OpenCode server', 'MCP servers'];

async function openSettings(page: Page, failed: Set<string>, override?: (route: Route, path: string, count: number) => Promise<boolean>) {
  const counts: Record<string, number> = Object.fromEntries(paths.map((path) => [path, 0]));
  await page.route('http://127.0.0.1:5697/**', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route('http://127.0.0.1:5698/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': request.headers()['origin'] ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (paths.includes(pathname)) counts[pathname]++;
    if (override && await override(route, pathname, counts[pathname] ?? 0)) return;
    return route.fulfill({ status: failed.has(pathname) ? 503 : 200, headers, json: failed.has(pathname) ? { error: `${pathname} offline` } : pathname === '/opencode/auth/accounts' ? { accounts: [] } : [] });
  });
  await page.goto('/#/tools/agent-settings');
  await expect.poll(() => paths.every((path) => counts[path] > 0)).toBe(true);
  await expect(page.getByRole('listbox', { name: 'Agent settings sections' })).toHaveAttribute('aria-busy', 'false');
  return counts;
}

const deferred = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
};

async function rowsRemainAccessible(page: Page) {
  const list = page.getByRole('listbox', { name: 'Agent settings sections' });
  await expect(list.getByRole('option')).toHaveCount(7);
  for (const name of names) await expect(list.getByRole('option', { name, exact: true })).toBeVisible();
  await list.getByRole('option', { name: 'Profiles overview' }).focus();
  await page.keyboard.press('End');
  await expect(list.getByRole('option', { name: 'MCP servers' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('list-inspector-detail')).toContainText('MCP servers provide tools');
}

test('issue-1559-c1: rejected profiles stays in its overview while all seven sections and MCP remain keyboard reachable', async ({ page }) => {
  // Regression: passing a profile fetch error into ListInspector disables every option.
  await openSettings(page, new Set(['/agent-configs']));
  await expect(page.getByTestId('tool-trace')).toContainText('failed');
  await expect(page.getByTestId('tool-trace')).not.toContainText('0 agent profiles loaded');
  await rowsRemainAccessible(page);
  await page.getByRole('option', { name: 'Profiles overview' }).click();
  await expect(page.getByTestId('list-inspector-detail').getByRole('alert')).toContainText('offline');
  await expect(page.getByTestId('agent-settings-error')).toHaveCount(0);
});

test('issue-1559-c2: all four rejected loads keep seven rows and offline-only sections reachable', async ({ page }) => {
  // Regression: aggregated load failure hides the section list or blocks read-only screens.
  await openSettings(page, new Set(paths));
  await rowsRemainAccessible(page);
  for (const name of ['Runtime / OpenCode server', 'Behavior', 'Keybindings']) {
    await page.getByRole('option', { name, exact: true }).click();
    await expect(page.getByTestId('list-inspector-detail')).toContainText(name === 'Behavior' ? 'destructive-action' : name === 'Keybindings' ? 'Shortcuts cover' : 'Local API');
  }
  await expect(page.getByTestId('tool-trace')).toContainText('failed');
  await expect(page.getByTestId('tool-trace')).not.toContainText('0 agent profiles loaded');
  const accessibility = await new AxeBuilder({ page }).include('.list-inspector').analyze();
  expect(accessibility.violations).toEqual([]);
});

for (const path of paths.slice(1)) {
  test(`issue-1559-c2: rejected ${path} alone preserves all seven selectable rows`, async ({ page }) => {
    // Regression: a sibling request failure mistakenly activates the fatal list state.
    await openSettings(page, new Set([path]));
    await rowsRemainAccessible(page);
    await expect(page.getByTestId('tool-trace')).toContainText('failed');
  });
}

test('issue-1559-c3: each section-local retry calls only its own failed request', async ({ page }) => {
  // Regression: a retry replays all four calls, hiding other failures and wasting offline requests.
  const failed = new Set(paths);
  const counts = await openSettings(page, failed);
  for (const [section, path, label] of [
    ['Profiles overview', '/agent-configs', 'Retry profiles'],
    ['Accounts', '/opencode/auth/accounts', 'Retry accounts'],
    ['Accounts', '/opencode/auth', 'Retry providers'],
    ['MCP servers', '/opencode/mcp', 'Retry MCP servers'],
  ]) {
    await page.getByRole('option', { name: section, exact: true }).click();
    failed.delete(path);
    const before = { ...counts };
    await page.getByTestId('list-inspector-detail').getByRole('button', { name: label }).click();
    await expect.poll(() => counts[path]).toBe(before[path] + 1);
    for (const other of paths.filter((entry) => entry !== path)) expect(counts[other]).toBe(before[other]);
  }
  await expect(page.getByTestId('tool-trace')).not.toContainText('failed');
});

test('issue-1559-c4: in-flight retries ignore duplicate activation and keep sibling sections operable', async ({ page }) => {
  // Regression: rapid activations issue duplicate requests or disable unrelated settings.
  const wait = deferred();
  let armed = false;
  const counts = await openSettings(page, new Set(['/agent-configs', '/opencode/mcp']), async (route, path, count) => {
    if (armed && path === '/agent-configs') { await wait.gate; await route.fulfill({ status: 200, json: [] }); return true; }
    return false;
  });
  armed = true;
  const before = counts['/agent-configs'];
  const retry = page.getByRole('button', { name: 'Retry profiles' });
  await retry.click();
  await expect(retry).toHaveAttribute('aria-disabled', 'true');
  await expect(retry).toHaveAttribute('aria-busy', 'true');
  await retry.dispatchEvent('click');
  await expect.poll(() => counts['/agent-configs']).toBe(before + 1);
  await page.getByRole('option', { name: 'MCP servers' }).click();
  await expect(page.getByRole('button', { name: 'Retry MCP servers' })).toHaveAttribute('aria-disabled', 'false');
  await page.getByRole('option', { name: 'Runtime / OpenCode server' }).click();
  await expect(page.getByTestId('list-inspector-detail')).toContainText('Local API');
  wait.release();
});

test('issue-1559-c5: newest-started section read wins over older Refresh and retry responses', async ({ page }) => {
  // Regression: a delayed mount/Refresh response overwrites a later successful retry.
  const slow = deferred();
  let armed = false;
  let started = 0;
  let oldResponseFinished = false;
  const counts = await openSettings(page, new Set(['/agent-configs']), async (route, path, count) => {
    if (armed && path === '/agent-configs' && ++started === 1) { await slow.gate; await route.fulfill({ status: 503, json: { error: 'old refresh failure' } }); oldResponseFinished = true; return true; }
    if (armed && path === '/agent-configs') { await route.fulfill({ status: 200, json: [{ id: 'latest', label: 'Latest profile', enabled: true, provider: 'openai', model: 'new' }] }); return true; }
    return false;
  });
  armed = true;
  const before = counts['/agent-configs'];
  await page.getByTestId('agent-settings-refresh').click();
  await expect.poll(() => counts['/agent-configs']).toBe(before + 1);
  await page.getByRole('button', { name: 'Retry profiles' }).click();
  await expect(page.getByTestId('list-inspector-detail')).toContainText('Latest profile');
  slow.release();
  await expect.poll(() => oldResponseFinished).toBe(true);
  await expect(page.getByTestId('list-inspector-detail')).toContainText('Latest profile');
  await expect(page.getByTestId('list-inspector-detail')).not.toContainText('old refresh failure');
});

test('issue-1559-c6: failed retry retains focus; success moves focus to persistent local status', async ({ page }) => {
  // Regression: removing a focused Retry button drops keyboard focus to the document.
  let attempts = 0;
  let armed = false;
  await openSettings(page, new Set(['/agent-configs']), async (route, path) => {
    if (armed && path === '/agent-configs') {
      attempts++;
      await route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1 ? { error: 'still offline' } : [] });
      return true;
    }
    return false;
  });
  armed = true;
  const retry = page.getByRole('button', { name: 'Retry profiles' });
  await retry.focus();
  await retry.click();
  await expect(retry).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('still offline');
  await retry.click();
  await expect(page.getByTestId('agent-settings-profiles-status')).toBeFocused();
  await expect(page.getByTestId('agent-settings-profiles-status')).toHaveAttribute('role', 'status');
  for (const state of ['success']) {
    const accessibility = await new AxeBuilder({ page }).include('.list-inspector').analyze();
    expect(accessibility.violations, state).toEqual([]);
  }
});

test('issue-1559-c6: failed and retrying states retain 44px target, axe and narrow layout', async ({ page }, testInfo) => {
  // Regression: narrow retry targets overflow or lose accessible status during a pending request.
  const slow = deferred();
  let armed = false;
  await openSettings(page, new Set(['/agent-configs']), async (route, path) => {
    if (armed && path === '/agent-configs') { await slow.gate; await route.fulfill({ status: 503, json: { error: 'still offline' } }); return true; }
    return false;
  });
  armed = true;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 820 });
    const button = page.getByRole('button', { name: 'Retry profiles' });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('.list-inspector').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.list-inspector').analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`issue-1559-error-${width}.png`) });
  }
  await page.getByRole('button', { name: 'Retry profiles' }).click();
  await expect(page.getByTestId('agent-settings-profiles-status')).toContainText('Retrying profiles');
  expect((await new AxeBuilder({ page }).include('.list-inspector').analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('issue-1559-retrying-narrow.png') });
  slow.release();
});

test('issue-1559-c7: provider badges distinguish unknown, last known and confirmed disconnected', async ({ page }) => {
  // Regression: a failed provider read is shown as confirmed disconnected and asks for re-login.
  let providerOnline = false;
  let providerIds = ['openai'];
  const counts = await openSettings(page, new Set(['/opencode/auth']), async (route, path) => {
    if (path === '/opencode/auth' && providerOnline) { await route.fulfill({ status: 200, json: { providers: providerIds } }); return true; }
    return false;
  });
  await page.getByRole('option', { name: 'Accounts' }).click();
  const badge = page.getByTestId('agent-settings-provider-status-openai');
  await expect(badge).toHaveText('Status unknown');
  await expect(page.getByTestId('agent-settings-provider-openai')).not.toHaveClass(/needs-relogin/);
  providerOnline = true;
  await page.getByRole('button', { name: 'Retry providers' }).click();
  await expect(badge).toHaveText('Connected');
  providerIds = [];
  await page.getByTestId('agent-settings-refresh').click();
  await expect(badge).toHaveText('Not connected');
  await expect(page.getByTestId('agent-settings-provider-openai')).toHaveClass(/needs-relogin/);
  providerIds = ['openai'];
  await page.getByTestId('agent-settings-refresh').click();
  await expect(badge).toHaveText('Connected');
  providerOnline = false;
  await page.getByTestId('agent-settings-refresh').click();
  await expect.poll(() => counts['/opencode/auth']).toBeGreaterThanOrEqual(5);
  await expect(badge).toHaveText('Last known Connected');
  await expect(page.getByTestId('agent-settings-provider-openai')).not.toHaveClass(/needs-relogin/);
  providerOnline = true;
  await page.getByRole('button', { name: 'Retry providers' }).click();
  await expect(badge).toHaveText('Connected');
});

test('issue-1559-c8: mutation failures never become load failures or show a load Retry', async ({ page }) => {
  // Regression: action errors are mislabeled as fetch failures and retry the wrong request.
  await openSettings(page, new Set(), async (route, path) => {
    if (path === '/opencode/mcp' && route.request().method() === 'POST') { await route.fulfill({ status: 503, json: { error: 'cannot add server' } }); return true; }
    return false;
  });
  await page.getByRole('option', { name: 'MCP servers' }).click();
  await page.getByTestId('agent-settings-mcp-add-disclosure').locator('summary').click();
  await page.getByTestId('agent-settings-mcp-add-name').fill('example');
  await page.getByTestId('agent-settings-mcp-add-value').fill('https://example.test/mcp');
  await page.getByTestId('agent-settings-mcp-add').click();
  await expect(page.getByRole('alert')).toContainText('Add MCP server failed (503)');
  await expect(page.getByRole('button', { name: 'Retry MCP servers' })).toHaveCount(0);
});

const sections = [
  { key: 'profiles', option: 'Profiles overview', path: '/agent-configs', label: 'Retry profiles', ok: [] as unknown },
  { key: 'accounts', option: 'Accounts', path: '/opencode/auth/accounts', label: 'Retry accounts', ok: { accounts: [] } as unknown },
  { key: 'mcp', option: 'MCP servers', path: '/opencode/mcp', label: 'Retry MCP servers', ok: [] as unknown },
  { key: 'providers', option: 'Accounts', path: '/opencode/auth', label: 'Retry providers', ok: { providers: [] } as unknown },
] as const;
const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

for (const s of sections) {
  test(`issue-1559-c6: ${s.key} error and retrying states preserve targets, layout and axe`, async ({ page }, testInfo) => {
    // Regression: retry state loses its target or status on narrow screens.
    const slow = deferred();
    let armed = false;
    await openSettings(page, new Set([s.path]), async (route, path) => {
      if (armed && path === s.path) { await slow.gate; await route.fulfill({ status: 503, json: { error: 'still offline' } }); return true; }
      return false;
    });
    armed = true;
    await page.getByRole('option', { name: s.option, exact: true }).click();
    for (const state of ['error', 'retrying'] as const) {
      if (state === 'retrying') { await page.setViewportSize(viewports[0]); await page.getByRole('button', { name: s.label }).click(); await expect(page.getByTestId(`agent-settings-${s.key}-status`)).toHaveText(`Retrying ${s.key}…`); }
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        const button = page.getByRole('button', { name: s.label });
        const status = page.getByTestId(`agent-settings-${s.key}-status`);
        await status.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport();
        await expect(status).toBeInViewport();
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(await page.locator('.list-inspector').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        expect((await new AxeBuilder({ page }).include('.list-inspector').analyze()).violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`issue-1559-${s.key}-${state}-${viewport.width}x${viewport.height}.png`) });
      }
    }
    slow.release();
  });

  test(`issue-1559-c10: ${s.key} superseded retry clears busy and ignores late response`, async ({ page }) => {
    // Regression: late retry clears the newer error, or leaves retry guard locked.
    const slow = deferred(); let armed = false; let started = 0;
    const counts = await openSettings(page, new Set([s.path]), async (route, path) => {
      if (!armed || path !== s.path) return false;
      if (++started === 1) { await slow.gate; await route.fulfill({ status: 200, json: s.ok }); return true; }
      await route.fulfill({ status: 503, json: { error: 'refresh still offline' } }); return true;
    });
    armed = true;
    await page.getByRole('option', { name: s.option, exact: true }).click();
    const retry = page.getByRole('button', { name: s.label });
    await retry.click();
    await expect(page.getByTestId(`agent-settings-${s.key}-status`)).toHaveText(`Retrying ${s.key}…`);
    await page.getByTestId('agent-settings-refresh').click();
    await expect.poll(() => started).toBe(2);
    await expect(retry).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId(`agent-settings-${s.key}-status`)).toHaveText('');
    slow.release();
    const before = counts[s.path];
    await retry.click();
    await expect.poll(() => counts[s.path]).toBe(before + 1);
    await expect(page.getByTestId(`agent-settings-${s.key}-status`)).toHaveText(`${s.key} still unavailable`);
  });

  for (const moveAway of [true, false]) {
    test(`issue-1559-c11: ${s.key} retry ${moveAway ? 'does not steal moved focus' : 'moves origin focus to status'}`, async ({ page }) => {
      // Regression: a late retry success steals keyboard focus from a different control.
      const slow = deferred(); let armed = false;
      await openSettings(page, new Set([s.path]), async (route, path) => {
        if (armed && path === s.path) { await slow.gate; await route.fulfill({ status: 200, json: s.ok }); return true; }
        return false;
      });
      armed = true;
      await page.getByRole('option', { name: s.option, exact: true }).click();
      const retry = page.getByRole('button', { name: s.label });
      await retry.focus(); await page.keyboard.press('Enter');
      await expect(retry).toHaveAttribute('aria-busy', 'true');
      if (moveAway) await page.getByTestId('agent-settings-refresh').focus();
      slow.release();
      await expect(page.getByTestId(`agent-settings-${s.key}-status`)).toHaveText(`${s.key} loaded`);
      if (moveAway) await expect(page.getByTestId('agent-settings-refresh')).toBeFocused();
      else await expect(page.getByTestId(`agent-settings-${s.key}-status`)).toBeFocused();
    });
  }
}

test('issue-1559-c12: stale provider check cannot dismiss flow or contradict newer Refresh', async ({ page }) => {
  // Regression: old provider check announces connected after newer read says disconnected.
  const slow = deferred(); let armed = false; let started = 0;
  await openSettings(page, new Set(), async (route, path) => {
    if (path === '/opencode/auth/google/authorize') { await route.fulfill({ status: 200, json: { authUrl: 'https://example.test/auth', instructions: '' } }); return true; }
    if (!armed || path !== '/opencode/auth') return false;
    if (++started === 1) { await slow.gate; await route.fulfill({ status: 200, json: { providers: ['google'] } }); return true; }
    await route.fulfill({ status: 200, json: { providers: [] } }); return true;
  });
  await page.getByRole('option', { name: 'Accounts', exact: true }).click();
  await page.getByTestId('agent-settings-provider-authorize-google').click();
  await expect(page.getByTestId('agent-settings-provider-flow-google')).toBeVisible();
  armed = true;
  await page.getByTestId('agent-settings-provider-check').click();
  await page.getByTestId('agent-settings-refresh').click();
  await expect(page.getByTestId('agent-settings-provider-status-google')).toHaveText('Not connected');
  slow.release();
  await expect(page.getByTestId('agent-settings-provider-flow-google')).toBeVisible();
  await expect(page.getByTestId('list-inspector-detail')).not.toContainText('google connected.');
});

for (const s of sections.filter((entry) => entry.key === 'mcp' || entry.key === 'providers')) {
  test(`issue-1559-c9: ${s.key} action reload clears stale retry failure`, async ({ page }) => {
    // Regression: successful mutation reload leaves a contradictory retry-failure announcement.
    const failed = new Set([s.path]);
    await openSettings(page, failed);
    await page.getByRole('option', { name: s.option, exact: true }).click();
    await page.getByRole('button', { name: s.label }).click();
    await expect(page.getByTestId(`agent-settings-${s.key}-status`)).toHaveText(`${s.key} still unavailable`);
    failed.delete(s.path);
    if (s.key === 'mcp') {
      await page.getByTestId('agent-settings-mcp-add-disclosure').locator('summary').click();
      await page.getByTestId('agent-settings-mcp-add-name').fill('example');
      await page.getByTestId('agent-settings-mcp-add-value').fill('https://example.test/mcp');
      await page.getByTestId('agent-settings-mcp-add').click();
    } else {
      await page.getByTestId('agent-settings-provider-key-opencode').fill('oc-key');
      await page.getByTestId('agent-settings-provider-key-save-opencode').click();
    }
    await expect(page.getByRole('button', { name: s.label })).toHaveCount(0);
    await expect(page.getByTestId(`agent-settings-${s.key}-status`)).toHaveText('');
  });
}

test('issue-1559-c12: stale failed provider check cannot announce action error after newer success', async ({ page }) => {
  // Regression: old failed check reports error despite a newer successful provider read.
  const slow = deferred(); let armed = false; let started = 0;
  await openSettings(page, new Set(), async (route, path) => {
    if (path === '/opencode/auth/google/authorize') { await route.fulfill({ status: 200, json: { authUrl: 'https://example.test/auth', instructions: '' } }); return true; }
    if (!armed || path !== '/opencode/auth') return false;
    if (++started === 1) { await slow.gate; await route.fulfill({ status: 503, json: { error: 'old check offline' } }); return true; }
    await route.fulfill({ status: 200, json: { providers: ['google'] } }); return true;
  });
  await page.getByRole('option', { name: 'Accounts', exact: true }).click();
  await page.getByTestId('agent-settings-provider-authorize-google').click();
  armed = true;
  await page.getByTestId('agent-settings-provider-check').click();
  await page.getByTestId('agent-settings-refresh').click();
  await expect(page.getByTestId('agent-settings-provider-status-google')).toHaveText('Connected');
  slow.release();
  await expect(page.getByTestId('agent-settings-provider-check')).toBeEnabled();
  await expect(page.getByTestId('list-inspector-detail').getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('agent-settings-provider-flow-google')).toBeVisible();
});

for (const s of sections) {
  test(`issue-1559-c9: ${s.key} newer Refresh clears stale retry status`, async ({ page }) => {
    // Regression: a successful retry leaves a contradictory loaded announcement beside a newer failure.
    const failed = new Set([s.path]);
    await openSettings(page, failed);
    await page.getByRole('option', { name: s.option, exact: true }).click();
    failed.delete(s.path);
    await page.getByRole('button', { name: s.label }).click();
    await expect(page.getByTestId(`agent-settings-${s.key}-status`)).toHaveText(`${s.key} loaded`);
    failed.add(s.path);
    await page.getByTestId('agent-settings-refresh').click();
    await expect(page.getByRole('button', { name: s.label })).toBeVisible();
    await expect(page.getByTestId(`agent-settings-${s.key}-status`)).toHaveText('');
  });
}

test('issue-1559-c13: unread provider badge displays exact Status unknown', async ({ page }) => {
  // Regression: the unknown badge is abbreviated or globally capitalized.
  await openSettings(page, new Set(['/opencode/auth']));
  await page.getByRole('option', { name: 'Accounts', exact: true }).click();
  for (const id of ['openai', 'google', 'opencode', 'openrouter']) {
    const badge = page.getByTestId(`agent-settings-provider-status-${id}`);
    await expect(badge).toHaveText('Status unknown');
    expect(await badge.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');
  }
});

test('1559-action-reload-section-retry:1 MCP action reload failure exposes section Retry and retries one GET', async ({ page }) => {
  // Regression: a successful disconnect followed by a failed catalog read leaves a stale list with no recovery.
  let failReload = false;
  const counts = await openSettings(page, new Set(), async (route, path) => {
    if (path === '/opencode/mcp/propresenter/disconnect') {
      failReload = true;
      await route.fulfill({ status: 200, json: {} });
      return true;
    }
    if (path === '/opencode/mcp') {
      if (failReload) await route.fulfill({ status: 503, json: { error: 'MCP reload offline' } });
      else await route.fulfill({ status: 200, json: [{ name: 'propresenter', status: 'connected', error: null, requiredEnv: [], needsCredentials: false, source: 'curated', tools: [] }] });
      return true;
    }
    return false;
  });
  await page.getByRole('option', { name: 'MCP servers', exact: true }).click();
  await page.getByTestId('agent-settings-mcp-disconnect-propresenter').click();
  await expect(page.getByRole('button', { name: 'Retry MCP servers' })).toBeVisible();
  failReload = false;
  const before = counts['/opencode/mcp'];
  await page.getByRole('button', { name: 'Retry MCP servers' }).click();
  await expect.poll(() => counts['/opencode/mcp']).toBe(before + 1);
});

test('1559-action-reload-section-retry:2 account default reload failure exposes section Retry and retries one GET', async ({ page }) => {
  // Regression: a completed Make default mutation swallows its failed account readback.
  let failReload = false;
  const counts = await openSettings(page, new Set(), async (route, path) => {
    if (path === '/opencode/auth/accounts/default') {
      failReload = true;
      await route.fulfill({ status: 200, json: { ok: true } });
      return true;
    }
    if (path === '/opencode/auth/accounts') {
      if (failReload) await route.fulfill({ status: 503, json: { error: 'Accounts reload offline' } });
      else await route.fulfill({ status: 200, json: { accounts: [{ id: 'work', label: 'Work', status: 'ok', isDefault: false }] } });
      return true;
    }
    return false;
  });
  await page.getByRole('option', { name: 'Accounts', exact: true }).click();
  await page.getByTestId('agent-settings-account-default-work').click();
  await expect(page.getByRole('button', { name: 'Retry accounts' })).toBeVisible();
  failReload = false;
  const before = counts['/opencode/auth/accounts'];
  await page.getByRole('button', { name: 'Retry accounts' }).click();
  await expect.poll(() => counts['/opencode/auth/accounts']).toBe(before + 1);
});

test('1559-action-reload-section-retry:3 provider save reload failure exposes section Retry and retries one GET', async ({ page }) => {
  // Regression: a stored provider key followed by a failed provider readback has no section recovery.
  let failReload = false;
  const counts = await openSettings(page, new Set(), async (route, path) => {
    if (path === '/opencode/auth/opencode' && route.request().method() === 'POST') {
      failReload = true;
      await route.fulfill({ status: 200, json: { success: true } });
      return true;
    }
    if (path === '/opencode/auth') {
      if (failReload) await route.fulfill({ status: 503, json: { error: 'Providers reload offline' } });
      else await route.fulfill({ status: 200, json: { providers: [] } });
      return true;
    }
    return false;
  });
  await page.getByRole('option', { name: 'Accounts', exact: true }).click();
  await page.getByTestId('agent-settings-provider-key-opencode').fill('test-key');
  await page.getByTestId('agent-settings-provider-key-save-opencode').click();
  await expect(page.getByRole('button', { name: 'Retry providers' })).toBeVisible();
  failReload = false;
  const before = counts['/opencode/auth'];
  await page.getByRole('button', { name: 'Retry providers' }).click();
  await expect.poll(() => counts['/opencode/auth']).toBe(before + 1);
});
