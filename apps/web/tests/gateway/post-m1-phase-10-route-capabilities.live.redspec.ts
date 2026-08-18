import { expect, test, type Page } from '@playwright/test';

// Phase 10 / post-m1-p10-c5g: Automations must derive only the seven canonical surface states from
// live rule/trigger/action/provider responses; a missing catalog or a rule whose stored triggerKey
// no longer exists in the live catalog must remain bounded detail *within* those states (not a
// separate invented state literal), and must be driven by the real response, never a fixture toggle.

const baseRule = {
  id: 'rule-live-1', name: 'Live automation rule', source: 'rhythm', triggerKey: 'rhythm.task_due',
  triggerConfig: null, actionType: 'create_task', actionConfig: {}, conditions: [], enabled: true,
  ownerId: null, sourceAccountId: null, lastEvaluatedAt: null, lastMatchedAt: null, matchCountLastRun: 0,
  previewSample: null, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
};

async function routeAutomations(page: Page, responses: Record<string, unknown>) {
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    const url = new URL(route.request().url());
    const match = Object.entries(responses).find(([path]) => url.pathname === path);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(match ? match[1] : []) });
  });
  await page.route('http://127.0.0.1:4097/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ healthy: true }) });
  });
  await page.goto('/#/automations');
  await expect(page.getByRole('status', { name: 'Environment receipt' })).toContainText('Environment: Live');
}

test('post-m1-p10-c5g: an empty live catalog stays ready with bounded detail, not an invented state', async ({ page }) => {
  await routeAutomations(page, {
    '/automation-catalog/triggers': [],
    '/automation-catalog/actions': [],
    '/automation-catalog/providers': [],
    '/automation-rules': [baseRule],
  });
  await expect(page.getByTestId(`automation-rule-${baseRule.id}`)).toBeVisible();
  await expect(page.getByTestId('automations-catalog-empty')).toBeVisible();
  await expect(page.getByTestId('automations-new')).toBeDisabled();
});

test('post-m1-p10-c5g: a rule referencing a trigger absent from the live catalog is bounded detail on an otherwise-ready page', async ({ page }) => {
  await routeAutomations(page, {
    '/automation-catalog/triggers': [{ key: 'gmail.message_matching_filter', source: 'gmail', label: 'Gmail message matches filter', description: '', signalTypes: [], configSchema: {} }],
    '/automation-catalog/actions': [{ key: 'create_task', label: 'Create task', description: '', configSchema: {} }],
    '/automation-catalog/providers': [],
    '/automation-rules': [baseRule], // baseRule.triggerKey ('rhythm.task_due') is not in the served catalog above
  });
  await expect(page.getByTestId(`automation-rule-${baseRule.id}`)).toBeVisible();
  await expect(page.getByTestId('automation-invalid-config')).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('automation-invalid-config')).toContainText('trigger');
  await expect(page.getByTestId(`automation-resync-${baseRule.id}`)).toBeDisabled();
  // Catalog itself was non-empty, so the catalog-empty detail must not also render.
  await expect(page.getByTestId('automations-catalog-empty')).toHaveCount(0);
});
