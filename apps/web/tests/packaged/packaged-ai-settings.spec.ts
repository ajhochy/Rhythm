import { test, expect, responseFor, assertResponse } from './feature-test';

const statusLabel: Record<string, string> = {
  connected: 'Connected', needs_auth: 'Needs authorization', failed: 'Failed', disabled: 'Disabled',
  disconnected: 'Disconnected', needs_client_registration: 'Needs client registration', configured: 'Configured',
};

test('[AI settings] selected MCP inspector agrees with the real server status and tools', async ({ page }) => {
  // Catches stale/misleading settings UI when real server status or advertised tools change.
  await page.goto('rhythm://app/index.html#/tools/agent-settings?settingsSection=mcp');
  const pending = responseFor(page, 'GET', '/opencode/mcp');
  await page.reload();
  const response = await pending;
  await assertResponse(response, 'GET', '/opencode/mcp', 200);
  const servers = await response.json() as Array<{ name: string; status: string; tools: string[] }>;
  expect(servers.length).toBeGreaterThan(0);
  const list = page.getByTestId('settings-column-items');
  await expect(list).toBeVisible();
  const selected = list.getByRole('option', { selected: true });
  await expect(selected).toHaveCount(1);
  const selectedId = await selected.getAttribute('data-item-id');
  expect(selectedId).toMatch(/^mcp:/);
  const name = selectedId!.slice('mcp:'.length);
  const server = servers.find(row => row.name === name);
  expect(server).toBeDefined();
  const card = page.getByTestId(`agent-settings-mcp-${name}`);
  await expect(card).toBeVisible();
  expect(statusLabel[server!.status]).toBeDefined();
  await expect(page.getByTestId(`agent-settings-mcp-status-${name}`)).toHaveText(statusLabel[server!.status]);
  await expect(card).toContainText(`${server!.tools.length} tools`);
  for (const row of servers) await expect(list.getByTestId(`agent-settings-mcp-row-${row.name}`)).toHaveCount(1);
});

test('[AI settings] model curation reflects real visibility and search clears back to catalog rows', async ({ page }) => {
  // Catches visibility drift from the live catalog and broken search recovery without mutating it.
  await page.goto('rhythm://app/index.html#/tools/agent-settings?settingsSection=models');
  const pending = responseFor(page, 'GET', '/agents/models/catalog/full');
  await page.reload();
  const response = await pending;
  await assertResponse(response, 'GET', '/agents/models/catalog/full', 200);
  const catalog = await response.json() as Array<{ provider: string; modelId: string; visible: boolean; displayName: string }>;
  expect(catalog.length).toBeGreaterThan(0);
  const first = catalog.find(row => row.provider && row.modelId);
  expect(first).toBeDefined();
  const panel = page.getByTestId('model-curation-panel');
  await expect(panel).toBeVisible();
  const row = panel.getByTestId(`model-curation-model-${first!.provider}-${first!.modelId}`);
  await expect(row).toBeVisible();
  await expect(row.getByRole('switch')).toHaveJSProperty('checked', first!.visible);
  const search = page.getByTestId('model-curation-search');
  await search.fill('rhythm-no-such-model-9f16a');
  await expect(panel.getByText('No matching models', { exact: true })).toBeVisible();
  await search.fill('');
  await expect(row).toBeVisible();
  await expect(row.getByRole('switch')).toHaveJSProperty('checked', first!.visible);
});

test('[AI profiles] live profile rail and selected editor agree with GET /agent-configs', async ({ page }) => {
  // Catches stale profile rail/editor data; choosing a row is local navigation and performs no save.
  await page.goto('rhythm://app/index.html#/profiles');
  const pending = responseFor(page, 'GET', '/agent-configs');
  await page.reload();
  const response = await pending;
  await assertResponse(response, 'GET', '/agent-configs', 200);
  const profiles = await response.json() as Array<{ id: string; label: string }>;
  expect(profiles.length).toBeGreaterThan(0);
  const workspace = page.getByTestId('profiles-workspace');
  await expect(workspace).toBeVisible();
  const rail = page.getByTestId('settings-column-profiles');
  for (const profile of profiles) await expect(rail.getByTestId(`profile-${profile.id}`)).toHaveCount(1);
  const profile = profiles[0];
  const row = rail.getByTestId(`profile-${profile.id}`);
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('profile-inspector')).toBeVisible();
  await expect(page.getByTestId('profile-label')).toHaveValue(profile.label);
});
