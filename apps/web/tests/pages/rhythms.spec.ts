import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

const ruleId = 'rhythm-weekend-service';
const cardRules = [
  { id: ruleId, title: 'Weekend service cadence', state: 'Enabled' },
  { id: 'rhythm-monthly-care', title: 'Monthly care follow-through', state: 'Paused' },
  { id: 'rhythm-annual-safety', title: 'Annual facilities safety review', state: 'Enabled' },
  { id: 'rhythm-shared-care', title: '礼拜准备节奏 🎵', state: 'Enabled' },
] as const;

async function expectNoBlockingAxe(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${state}: ${blocking.map((item) => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);
}

async function expectNoOverflow(page: Page, label: string) {
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll, `${label}: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.client + 1);
}

test('Rhythms click-through covers selection, create, edit, pause, collaborators, delete, and recovery', async ({ page }) => {
  await openPage(page, 'rhythms');
  await expect(page.getByTestId('page-rhythms')).toBeVisible();
  await page.getByTestId(`rhythm-inspect-${ruleId}`).click();
  await expect(page.getByTestId('rhythm-detail')).toContainText('4 generated tasks');
  // Regression caught: an owned rhythm required an Edit action before its existing fields were available.
  await expect(page.getByTestId('rhythm-direct-editor').getByTestId('rhythm-edit-title')).toBeEnabled();
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);

  await page.getByTestId(`rhythm-enabled-${ruleId}`).uncheck();
  await expect(page.getByTestId('rhythm-next-due')).toContainText('Paused - no next generation');
  await page.getByTestId(`rhythm-enabled-${ruleId}`).check();

  await page.getByTestId('rhythm-add-collaborator').click();
  await page.getByTestId('rhythm-collaborator-option-2').click();
  await expect(page.getByTestId('rhythm-collaborator-2')).toContainText('Riley Chen');
  await page.getByTestId('rhythm-remove-collaborator-2').click();

  await page.getByTestId('rhythm-edit-title').fill('Weekend service reset');
  await page.getByTestId('rhythm-edit-submit').click();
  await expect(page.getByTestId(`rhythm-card-${ruleId}`)).toContainText('Weekend service reset');

  await page.getByTestId('rhythms-new-rule').click();
  const createDialog = page.getByTestId('rhythm-create-dialog');
  await createDialog.getByTestId('rhythm-create-title').fill('Quarter close care');
  await createDialog.getByTestId('rhythm-create-frequency').selectOption('monthly');
  await createDialog.getByTestId('rhythm-create-day-of-month').fill('20');
  await createDialog.getByTestId('rhythm-add-step').click();
  await createDialog.getByTestId('rhythm-step-title-0').fill('Prepare care list');
  await createDialog.getByTestId('rhythm-create-submit').click();
  await expect(page.getByTestId('rhythm-card-rhythm-quarter-close-care')).toBeVisible();

  await page.getByTestId('rhythm-delete-rhythm-quarter-close-care').click();
  await expect(page.getByTestId('rhythm-delete-dialog')).toContainText('already-generated tasks');
  await page.getByTestId('rhythm-delete-confirm').click();
  await expect(page.getByTestId('rhythm-card-rhythm-quarter-close-care')).toHaveCount(0);

  await openPage(page, 'rhythms/rule/not-a-rule');
  await page.getByTestId('rhythm-not-found-back').click();
  await expect(page.getByRole('heading', { level: 2, name: 'Recurring rules' })).toBeVisible();

  await openPage(page, 'rhythms', '?state=server-error');
  await page.getByTestId('page-retry').click();
  await expect(page.getByTestId(`rhythm-card-${ruleId}`)).toBeVisible();
});

test('Rhythms shared and readonly rules remain inspectable without mutation', async ({ page }) => {
  await openPage(page, 'rhythms/rule/rhythm-shared-care', '?state=forbidden');
  await expect(page.getByTestId('rhythm-detail')).toContainText('礼拜准备节奏 🎵');
  await expect(page.getByTestId('rhythm-add-collaborator')).toBeDisabled();
  await expect(page.getByTestId('rhythm-direct-editor').getByTestId('rhythm-edit-title')).toBeDisabled();
  await expect(page.getByTestId('rhythm-delete-rhythm-shared-care')).toBeDisabled();

  await openPage(page, `rhythms/rule/${ruleId}`, '?state=readonly');
  await expect(page.getByTestId('rhythms-mutations')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId(`rhythm-inspect-${ruleId}`)).toBeEnabled();
  await expect(page.getByTestId(`rhythm-enabled-${ruleId}`)).toBeDisabled();
  await expect(page.getByTestId('rhythm-direct-editor').getByTestId('rhythm-edit-title')).toBeDisabled();
  await expect(page.getByTestId('rhythm-detail')).toContainText('Weekend service cadence');
});

for (const width of [1024, 768, 390]) {
  test(`Rhythms is responsive at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, 'rhythms');
    await expect(page.getByTestId('rhythms-new-rule')).toBeVisible();
    await expect(page.getByText('礼拜准备节奏 🎵', { exact: true })).toBeVisible();
    await expectNoOverflow(page, `${width}px ready`);
    await page.getByTestId('rhythms-new-rule').click();
    await page.getByTestId('rhythm-create-dialog').getByTestId('rhythm-add-step').click();
    await expectNoOverflow(page, `${width}px create dialog`);
  });
}

for (const state of ['ready', 'server-error', 'readonly'] as const) {
  test(`Rhythms axe scan for ${state}`, async ({ page }) => {
    await openPage(page, 'rhythms', state === 'ready' ? undefined : `?state=${state}`);
    await expectNoBlockingAxe(page, state);
  });
}

test('Rhythms create dialog and localized content survive 200 percent text and RTL', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, 'rhythms');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar'; });
  await expect(page.getByText('礼拜准备节奏 🎵', { exact: true })).toBeVisible();
  for (const rule of cardRules) {
    await expect(page.getByTestId(`rhythm-inspect-${rule.id}`)).toHaveAccessibleName(`Inspect ${rule.title}`);
    await expect(page.getByTestId(`rhythm-enabled-${rule.id}`)).toHaveAccessibleName(`${rule.state} - ${rule.title}`);
    await expect(page.getByTestId(`rhythm-delete-${rule.id}`)).toHaveAccessibleName(`Delete ${rule.title}`);
  }
  await expect(page.getByTestId('rhythm-enabled-rhythm-shared-care')).toBeDisabled();
  await expectNoOverflow(page, 'RTL list');
  await page.getByTestId('rhythms-new-rule').click();
  await page.getByTestId('rhythm-create-dialog').getByTestId('rhythm-add-step').click();
  await expectNoOverflow(page, 'RTL create dialog');
  await expectNoBlockingAxe(page, 'RTL create dialog');
});
