import { expect, test } from '@playwright/test';

test('issue-1232: Agents categories show counts, filter results, and preserve deep links', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: /Chats, \d+ items/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Scheduled Tasks, \d+ items/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Background Loops, \d+ items/ })).toBeVisible();

  await page.getByRole('button', { name: /Scheduled Tasks, \d+ items/ }).click();
  await expect(page.getByText('Schedule target activity', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Search scheduled tasks').fill('missing task');
  await expect(page.getByRole('heading', { name: 'No matching scheduled tasks' })).toBeVisible();
  await page.getByPlaceholder('Search scheduled tasks').fill('');
  await page.getByRole('button', { name: /^Schedule target activity\./ }).click();
  await expect(page.getByRole('heading', { name: 'Scheduled Jobs', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Selected schedule target', exact: true })).toBeVisible();
});

test('issue-1232: empty Background Loops explains the category', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Background Loops, \d+ items/ }).click();
  await expect(page.getByRole('heading', { name: 'No background loops yet' })).toBeVisible();
  await expect(page.getByText(/self-improvement work/i)).toBeVisible();
});
