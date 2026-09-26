import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.RHYTHM_ISSUE_1562_CONTRACT !== '1', 'Run with the issue-1562 live-gateway Playwright config');

const profiles = Array.from({ length: 54 }, (_, index) => ({
  id: index === 35 ? 'planning-agent' : `profile-${index + 1}`,
  label: index === 35 ? 'Planning Agent' : `Profile ${String(index + 1).padStart(2, '0')}`,
  icon: 'AG', enabled: index < 52, isAgent: true, isManager: false, sessionSelectable: true,
  modelProvider: index === 35 ? 'anthropic' : 'openai', modelId: index === 35 ? 'claude-planner' : `model-${index % 4}`,
  allowedMcpsJson: '{}', allowedSkillsJson: '[]', allowedDelegatesJson: '[]', corePermissionsJson: '{}',
  autoApproveActions: false, isDefault: index === 0, updatedAt: '2026-09-24T00:00:00Z',
}));

async function openSettings(page: Page) {
  await page.route('http://127.0.0.1:7161/**', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route('http://127.0.0.1:7160/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': request.headers()['origin'] ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/agent-configs') return route.fulfill({ status: 200, headers, json: profiles });
    if (path === '/opencode/auth/accounts') return route.fulfill({ status: 200, headers, json: { accounts: [] } });
    if (path === '/opencode/auth' || path === '/opencode/mcp' || path === '/agents/models/catalog' || path === '/skills') return route.fulfill({ status: 200, headers, json: [] });
    return route.fulfill({ status: 200, headers, json: {} });
  });
  await page.goto('/#/tools/agent-settings?settingsSection=profiles');
  await expect(page.getByTestId('agent-setting-planning-agent')).toBeVisible();
}

test('1562-profiles-overview-navigable:1 profile row deep-links and selects the requested editor profile', async ({ page }) => {
  // Regression: overview rows are inert and the editor always selects its default profile.
  await openSettings(page);
  const planning = page.getByTestId('agent-setting-planning-agent');
  await planning.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/profiles\?profile=planning-agent$/);
  await expect(page.getByTestId('profile-planning-agent')).toHaveClass(/selected/);
  await expect(page.getByRole('heading', { name: 'Planning Agent', exact: true })).toBeVisible();
});

test('1562-profiles-overview-navigable:2 search matches label, provider and model', async ({ page }) => {
  // Regression: finding one profile requires reading all 54 inert cards.
  await openSettings(page);
  const search = page.getByRole('searchbox', { name: 'Search profiles overview' });
  for (const value of ['planning', 'anthropic', 'claude-planner']) {
    await search.fill(value);
    await expect(page.locator('.agent-settings-profile-row')).toHaveCount(1);
    await expect(page.getByTestId('agent-setting-planning-agent')).toBeVisible();
  }
});

test('1562-profiles-overview-navigable:3 disabled profiles are grouped and visibly marked', async ({ page }) => {
  // Regression: disabled rows are visually indistinguishable without reading muted metadata.
  await openSettings(page);
  const disabled = page.getByTestId('agent-settings-disabled-profiles');
  await expect(disabled.getByRole('heading', { name: 'Disabled profiles' })).toBeVisible();
  await expect(disabled.locator('.agent-settings-profile-row')).toHaveCount(2);
  await expect(disabled.getByText('Disabled', { exact: true })).toHaveCount(2);
});

test('1562-profiles-overview-navigable:4 primary editor action precedes the first profile row', async ({ page }) => {
  // Regression: the only editor action is appended after thousands of pixels of rows.
  await openSettings(page);
  const action = await page.getByTestId('agent-settings-open-profiles').boundingBox();
  const first = await page.locator('.agent-settings-profile-row').first().boundingBox();
  expect(action!.y).toBeLessThan(first!.y);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`1562-profiles-overview-navigable:5 navigation stays reachable after profile scrolling at ${viewport.width}px`, async ({ page }) => {
    // Regression: the page scroll carries settings navigation off-screen on long profile lists.
    await page.setViewportSize(viewport);
    await openSettings(page);
    const detail = page.getByTestId('list-inspector-detail');
    await detail.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const navigation = viewport.width < 720 ? page.getByRole('button', { name: 'Back to list', exact: true }) : page.getByRole('listbox', { name: 'Agent settings sections' });
    await expect(navigation).toBeInViewport();
  });
}
