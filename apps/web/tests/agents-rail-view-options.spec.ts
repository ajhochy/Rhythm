import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('view options replaces standalone checkboxes and supports keyboard selection and return focus', async ({ page }) => {
  await page.goto('/agents');
  const rail = page.getByRole('complementary', { name: 'Agents', exact: true });
  const trigger = rail.getByRole('button', { name: 'View options', exact: true });
  await expect(rail.getByRole('checkbox', { name: /Archived sessions|Compact rows/ })).toHaveCount(0);
  const selected = await rail.locator('[aria-current="true"]').getAttribute('data-testid');
  await trigger.focus();
  await trigger.press('ArrowDown');
  const archive = page.getByRole('menuitemcheckbox', { name: 'View archived sessions' });
  await expect(archive).toBeFocused();
  await expect(archive).toHaveAttribute('aria-checked', 'false');
  await expect(archive).toHaveAccessibleDescription('Shows archived conversations instead of active ones. Does not archive anything.');
  await archive.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Comfortable', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const compact = page.getByRole('menuitemradio', { name: 'Compact', exact: true });
  await expect(compact).toBeFocused();
  await compact.press('Space');
  await expect(trigger).toBeFocused();
  await expect(rail.locator('.session-list')).toHaveClass(/rail-compact/);
  await trigger.press('ArrowUp');
  await expect(compact).toBeFocused();
  await expect(compact).toHaveAttribute('aria-checked', 'true');
  await compact.press('Home');
  await expect(archive).toBeFocused();
  await archive.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('menu', { name: 'View options' })).toHaveCount(0);
  expect(await rail.locator('[aria-current="true"]').getAttribute('data-testid')).toBe(selected);
});

test('archive is an explicit view with an obvious return path, without mutating sessions', async ({ page }) => {
  await page.goto('/agents');
  const before = await page.evaluate(() => localStorage.getItem('rhythm-agents-fixture-sessions'));
  const trigger = page.getByRole('button', { name: 'View options', exact: true });
  await trigger.click();
  await page.getByRole('menuitemcheckbox', { name: 'View archived sessions' }).click();
  const back = page.getByRole('button', { name: 'Archived sessions — Back to active', exact: true });
  await expect(back).toBeVisible();
  await trigger.click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'View archived sessions' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await back.click();
  await expect(back).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('rhythm-agents-fixture-sessions'))).toBe(before);
});

test('existing nonpersistent preference contract survives reload without new account-wide keys', async ({ page }) => {
  await page.goto('/agents');
  const keys = () => page.evaluate(() => Object.keys(localStorage).filter(key => /compact|density|session-sort|project-filter|archivedOnly/.test(key)).sort());
  const before = await keys();
  await page.getByTestId('session-sort').selectOption('name');
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Compact', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Comfortable', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemcheckbox', { name: 'View archived sessions' })).toHaveAttribute('aria-checked', 'false');
  expect(await keys()).toEqual(before);
});

for (const theme of ['light', 'dark']) test(`narrow rail at 200 percent with RTL keeps ${theme} view options contained and accessible`, async ({ page }, testInfo) => {
  await page.goto('/agents');
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.dir = 'rtl'; document.documentElement.style.zoom = '2'; }, theme);
  const rail = page.getByRole('complementary', { name: 'Agents', exact: true });
  await rail.evaluate(element => { element.style.width = '228px'; });
  await rail.getByRole('button', { name: 'View options', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'View options' });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const railBox = (await rail.boundingBox())!;
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(railBox.x);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(railBox.x + railBox.width);
  const axe = await new AxeBuilder({ page }).include('.session-rail').analyze();
  expect(axe.violations).toEqual([]);
  await rail.screenshot({ path: testInfo.outputPath(`view-options-${theme}-rtl-200.png`) });
});
