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

async function routeProfiles(page: Page) {
  await page.route('http://127.0.0.1:7161/**', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route('http://127.0.0.1:7160/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': request.headers()['origin'] ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/agent-configs') return route.fulfill({ status: 200, headers, json: profiles });
    if (path === '/opencode/auth/accounts' || path === '/opencode/auth/openai/accounts') return route.fulfill({ status: 200, headers, json: { accounts: [] } });
    if (path === '/opencode/auth' || path === '/opencode/mcp' || path === '/agents/models/catalog' || path === '/skills' || path === '/opencode/skills') return route.fulfill({ status: 200, headers, json: [] });
    return route.fulfill({ status: 200, headers, json: {} });
  });
}

// The Profiles overview left Agent Settings: profiles are browsed and edited only in the Profiles tool.
test('1562-profiles-overview-navigable:1 Agent Settings has no Profiles section and old deep links open the Profiles tool', async ({ page }) => {
  await routeProfiles(page);
  await page.goto('/#/tools/agent-settings?settingsSection=profiles');
  const sections = page.getByRole('listbox', { name: 'Agent settings sections' });
  await expect(sections.getByRole('option').first()).toBeVisible();
  await expect(sections.getByRole('option', { name: /Profiles/ })).toHaveCount(0);
  await expect(page.getByTestId('agent-setting-planning-agent')).toHaveCount(0);
  await page.getByTestId('agent-settings-open-profiles').click();
  await expect(page).toHaveURL(/#\/profiles/);
  await expect(page.getByTestId('profile-planning-agent')).toBeVisible();
});

test('1562-profiles-overview-navigable:2 a profile deep link selects the requested editor profile', async ({ page }) => {
  // Regression: the editor always selects its default profile.
  await routeProfiles(page);
  await page.goto('/#/profiles?profile=planning-agent');
  await expect(page.getByTestId('profile-planning-agent')).toHaveClass(/selected/);
  await expect(page.getByRole('heading', { name: 'Planning Agent', exact: true })).toBeVisible();
});

test('1562-profiles-overview-navigable:3 search matches label, provider and model', async ({ page }) => {
  // Regression: finding one profile requires reading all 54 rows.
  await routeProfiles(page);
  await page.goto('/#/profiles');
  const list = page.getByRole('listbox', { name: 'Profiles' });
  await expect(list.getByRole('option')).toHaveCount(54);
  for (const value of ['planning', 'anthropic', 'claude-planner']) {
    await page.getByTestId('profile-search').fill(value);
    await expect(list.getByRole('option')).toHaveCount(1);
    await expect(page.getByTestId('profile-planning-agent')).toBeVisible();
  }
});

test('1562-profiles-overview-navigable:4 disabled profiles are visibly marked', async ({ page }) => {
  // Regression: disabled rows are visually indistinguishable without reading muted metadata.
  await routeProfiles(page);
  await page.goto('/#/profiles');
  await expect(page.getByRole('listbox', { name: 'Profiles' }).locator('em', { hasText: 'Disabled' })).toHaveCount(2);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`1562-profiles-overview-navigable:5 navigation stays reachable after profile scrolling at ${viewport.width}px`, async ({ page }) => {
    // Regression: the page scroll carries navigation off-screen on long profile lists.
    await page.setViewportSize(viewport);
    await routeProfiles(page);
    await page.goto('/#/profiles');
    if (viewport.width < 900) {
      await page.getByTestId('profile-inspector').evaluate((node) => { node.parentElement!.scrollTop = node.parentElement!.scrollHeight; });
      await expect(page.getByRole('button', { name: 'Back to Profile settings', exact: true })).toBeInViewport();
    } else {
      const list = page.getByRole('listbox', { name: 'Profiles' });
      await list.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await expect(page.getByTestId('profile-create')).toBeInViewport();
      await expect(page.getByTestId('profile-search')).toBeInViewport();
      await expect(page.getByTestId('profile-profile-54')).toBeInViewport();
    }
  });
}
