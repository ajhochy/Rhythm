import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('skip link keeps the current route and focuses main content', async ({ page }) => {
  await page.goto('/#/tasks');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/tasks$/);
  await expect(page.locator('#main-content')).toBeFocused();
});

test('dialog contains focus and restores a surviving trigger or main fallback', async ({ page }) => {
  await page.goto('/#/agents');
  const trigger = page.getByTestId('new-session-advanced');
  await trigger.click();
  const dialog = page.getByTestId('advanced-session-dialog');
  await expect(dialog).toBeVisible();
  await page.locator('#main-content').evaluate((item) => item.focus());
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();

  await trigger.click();
  await trigger.evaluate((item) => item.remove());
  await page.keyboard.press('Escape');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('selected focus and repeated reduced-motion toasts remain visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/agents');
  const selected = page.locator('.session-row.selected').first();
  await selected.focus();
  expect(await selected.evaluate((item) => getComputedStyle(item).outlineStyle)).not.toBe('none');

  const refresh = page.getByTestId('sessions-refresh');
  await refresh.click();
  const toast = page.getByTestId('toast-status');
  await expect(toast).toHaveAttribute('data-visible', 'true');
  await refresh.click();
  await expect(toast).toHaveAttribute('data-visible', 'true');
  await page.waitForTimeout(50);
  expect(Number(await toast.evaluate((item) => getComputedStyle(item).opacity))).toBeGreaterThan(0.9);
  await mkdir('../../docs/ai/runs/artifacts/e50', { recursive: true });
  await page.screenshot({ path: '../../docs/ai/runs/artifacts/e50/focus-and-toast.png' });
});
