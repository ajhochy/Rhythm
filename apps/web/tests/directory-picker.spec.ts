import { test, expect, type Page } from '@playwright/test';

async function openLiveRail(page: Page, picker: boolean) {
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.route(/https:\/\/directory-picker\.invalid|http:\/\/127\.0\.0\.1:(4199|4197)/, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions: [], resumable: [], ancestors: [], pageInfo: { nextCursor: null, hasMore: false } } });
    if (path.endsWith('/health')) return route.fulfill({ json: { status: 'ready' } });
    return route.fulfill({ json: [] });
  });
  if (picker) await page.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', { value: Object.freeze({ selectDirectory: async () => '/Users/AJ/Project with spaces' }) });
  });
  await page.goto('/tests/directory-picker-harness.html');
  await page.getByTestId('new-session-advanced').click();
  await expect(page.getByTestId('advanced-profile')).toBeVisible(); // Ensures liveHistory is true.
}

test('native directory picker is enabled with live history and updates cwd through a click', async ({ page }) => {
  await openLiveRail(page, true);
  await page.getByTestId('advanced-cwd').fill('/manual/control');
  await expect(page.getByTestId('advanced-cwd')).toHaveValue('/manual/control');
  await expect(page.getByTestId('advanced-browse')).toBeEnabled();
  await page.getByTestId('advanced-browse').click();
  await expect(page.getByTestId('advanced-cwd')).toHaveValue('/Users/AJ/Project with spaces');
  await expect(page.getByTestId('advanced-branch')).toHaveValue('');
});

test('live browser without the bridge preserves manual entry and disables Browse', async ({ page }) => {
  await openLiveRail(page, false);
  await expect(page.getByTestId('advanced-browse')).toBeDisabled();
  await page.getByTestId('advanced-cwd').fill('/manual/project');
  await expect(page.getByTestId('advanced-cwd')).toHaveValue('/manual/project');
});

test('fixture Browse fallback remains /workspace/rhythm', async ({ page }) => {
  await page.goto('/#/agents');
  await page.getByTestId('new-session-advanced').click();
  await page.getByTestId('advanced-cwd').fill('/manual/control');
  await page.getByTestId('advanced-browse').click();
  await expect(page.getByTestId('advanced-cwd')).toHaveValue('/workspace/rhythm');
  await expect(page.getByTestId('toast-status')).toContainText('Fixture folder selected');
});

for (const outcome of ['cancel', 'reject'] as const) test(`native picker ${outcome} preserves cwd and manual fallback`, async ({ page }) => {
  await page.goto('/#/agents');
  await page.evaluate((result) => {
    Object.defineProperty(window, 'rhythmShell', { value: Object.freeze({ selectDirectory: async () => {
      if (result === 'reject') throw new Error('dialog unavailable');
      return null;
    } }) });
  }, outcome);
  await page.getByTestId('new-session-advanced').click();
  await page.getByTestId('advanced-cwd').fill('/keep/project');
  await page.getByTestId('advanced-browse').click();
  if (outcome === 'reject') await expect(page.getByTestId('toast-status')).toContainText('Folder selection failed');
  await expect(page.getByTestId('advanced-cwd')).toHaveValue('/keep/project');
  await page.getByTestId('advanced-cwd').fill('/manual/after-picker');
  await expect(page.getByTestId('advanced-cwd')).toHaveValue('/manual/after-picker');
});
