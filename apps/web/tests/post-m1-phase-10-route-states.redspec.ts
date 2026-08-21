import { expect, test } from '@playwright/test';
import { openPage } from './helpers';

// Phase 10 / post-m1-p10-c1a: every completed route derives its surface state exclusively from
// ready | loading | empty | server-error | forbidden | unavailable | readonly. Automations was the
// one in-scope route that accepted and persisted three invented literals (catalog-empty,
// invalid-config, provider-error) through its own `?state=` picker and hash parameter. This spec
// proves the picker never offers them and the hash parameter never activates them.

const CANONICAL_STATES = ['ready', 'loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly'].sort();
const INVENTED_LITERALS = ['catalog-empty', 'invalid-config', 'provider-error', 'update-error'];
const calendarRuleId = 'rule-calendar-room';

test('post-m1-p10-c1a: Automations state picker offers exactly the seven canonical literals', async ({ page }) => {
  await openPage(page, 'automations');
  const values = await page.getByTestId('automations-state-select').locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(values.slice().sort()).toEqual(CANONICAL_STATES);
});

for (const invented of INVENTED_LITERALS) {
  test(`post-m1-p10-c1a: Automations ignores the invented "${invented}" literal and falls back to ready`, async ({ page }) => {
    await openPage(page, 'automations', `?state=${invented}`);
    // A real route in the ready state renders its seeded/loaded rows; none of the invented
    // dependency-failure testids may render because that surface state no longer exists.
    await expect(page.getByTestId(`automation-rule-${calendarRuleId}`)).toBeVisible();
    await expect(page.getByTestId('automations-catalog-empty')).toHaveCount(0);
    await expect(page.getByTestId('automation-invalid-config')).toHaveCount(0);
    await expect(page.getByTestId('automation-provider-error')).toHaveCount(0);
    await expect(page.getByTestId('automations-state-select')).toHaveValue('ready');
  });
}

// Cross-page guard: the other seven in-scope Phase 3 routes already reject invented literals.
// Included here so a future regression on any of them is caught by the same spec, not just
// Automations.
const otherRoutes: Array<{ path: string; readyTestId: string }> = [
  { path: 'dashboard', readyTestId: 'dashboard-open-count' },
  { path: 'planner', readyTestId: 'page-planner' },
  { path: 'tasks', readyTestId: 'page-tasks' },
  { path: 'rhythms', readyTestId: 'page-rhythms' },
  { path: 'projects', readyTestId: 'page-projects' },
  { path: 'messages', readyTestId: 'page-messages' },
  { path: 'facilities', readyTestId: 'page-facilities' },
];

for (const route of otherRoutes) {
  test(`post-m1-p10-c1a: ${route.path} already ignores the invented "provider-error" literal`, async ({ page }) => {
    await openPage(page, route.path, '?state=provider-error');
    await expect(page.getByTestId(route.readyTestId)).toBeVisible();
  });
}
