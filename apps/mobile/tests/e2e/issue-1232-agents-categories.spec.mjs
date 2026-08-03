import { expect, test } from '@playwright/test';

const fakePort =
  process.env.PLAYWRIGHT_FAKE_PORT ??
  process.env.RHYTHM_MOBILE_E2E_FAKE_PORT ??
  '44096';
const fakeServer = `http://127.0.0.1:${fakePort}`;

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${fakeServer}/__control/reset`, {
    data: { scenario: 'happy-path' },
  });
  expect(response.ok()).toBeTruthy();
});

test('issue-1232: Agents categories show counts, filter results, and preserve deep links', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Agents menu' }).click();
  await expect(page.getByRole('menuitem', { name: /Chats, \d+ items/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Scheduled Tasks, \d+ items/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Background Loops, \d+ items/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Activity' })).toBeVisible();
  await page.getByRole('menuitem', { name: /Scheduled Tasks, \d+ items/ }).click();
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
  await page.getByRole('button', { name: 'Agents menu' }).click();
  await page.getByRole('menuitem', { name: /Background Loops, \d+ items/ }).click();
  await expect(page.getByRole('heading', { name: 'No background loops yet' })).toBeVisible();
  await expect(page.getByText(/self-improvement work/i)).toBeVisible();
});
