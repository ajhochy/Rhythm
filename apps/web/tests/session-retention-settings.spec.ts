import { expect, test } from '@playwright/test';
import { selectRow } from './helpers/list-inspector';

const open = async (page: import('@playwright/test').Page, search = '') => {
  await page.goto(`/tests/session-retention-harness.html${search}`);
  await selectRow(page, 'Session cleanup');
  await expect(page.getByTestId('session-retention-panel')).toBeVisible();
};
const puts = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__retention as string[]);

test('session cleanup defaults to Report only; Off saves immediately', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('radio', { name: /Report only/ })).toBeChecked();
  await expect(page.getByText('No nightly check has run yet.')).toBeVisible();
  await page.getByRole('radio', { name: /^Off/ }).check();
  await expect.poll(() => puts(page)).toEqual(['off']);
  await expect(page.getByRole('radio', { name: /^Off/ })).toBeChecked();
});

test('switching to On needs confirmation; Cancel saves nothing', async ({ page }) => {
  await open(page);
  await page.getByRole('radio', { name: /^On/ }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Turn on session cleanup?' });
  await expect(dialog).toContainText('older than 30 days');
  await expect(dialog).toContainText('idle for 30 days');
  await expect(dialog).toContainText('2 KB');
  await expect(dialog).toContainText('message text, token and cost totals, and skill history');
  await expect(page.getByRole('radio', { name: /Report only/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await puts(page)).toEqual([]);
  await page.getByRole('radio', { name: /^On/ }).click();
  await page.getByRole('button', { name: 'Turn on cleanup' }).click();
  await expect.poll(() => puts(page)).toEqual(['on']);
  await expect(page.getByRole('radio', { name: /^On/ })).toBeChecked();
});

test('shows the last report and disables the control under an env override', async ({ page }) => {
  await open(page, '?source=env&report=1');
  await expect(page.getByTestId('session-retention-env')).toContainText('RHYTHM_SESSION_RETENTION');
  for (const name of [/^Off/, /Report only/, /^On/]) await expect(page.getByRole('radio', { name })).toBeDisabled();
  await expect(page.getByTestId('session-retention-report')).toContainText('Last check: would free 1.9 GB (engine) + 512 MB (Rhythm)');
});
