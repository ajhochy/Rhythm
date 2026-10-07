import { expect, test } from '@playwright/test';

test('issue-1172-c10: Activity tool links open the selected supported target UI', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Chats menu' }).click();
  await page.getByRole('menuitem', { name: 'Activity' }).click();

  for (const target of [
    { activity: 'Research target activity', heading: 'Research', detail: 'Selected research target', report: 'Research report' },
    { activity: 'Schedule target activity', heading: 'Scheduled Jobs', detail: 'Selected schedule target' },
    { activity: 'Webhook target activity', heading: 'Webhooks', detail: 'Selected webhook target' },
    { activity: 'Cookbook target activity', heading: 'Cookbook', detail: 'Selected recipe target' },
  ]) {
    await page.getByRole('button', { name: new RegExp(`^${target.activity}\\.`) }).click();
    await expect(page.getByRole('heading', { name: target.heading, exact: true })).toBeVisible();
    if (target.report) {
      // Research detail: header is "Research report"; the selected title is context text (657e1e5d).
      await expect(page.getByRole('heading', { name: target.report, exact: true })).toBeVisible();
      await expect(page.getByLabel(target.detail, { exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: target.detail, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Back to Tools' }).click();
    await page.getByRole('tab', { name: 'Chats' }).click();
    await page.getByRole('button', { name: 'Chats menu' }).click();
    await page.getByRole('menuitem', { name: 'Activity' }).click();
  }
});
