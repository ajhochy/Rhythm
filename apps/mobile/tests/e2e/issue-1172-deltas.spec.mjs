import { expect, test } from '@playwright/test';

const fakePort =
  process.env.RHYTHM_MOBILE_E2E_FAKE_PORT ??
  process.env.PLAYWRIGHT_FAKE_PORT ??
  '44096';
const fakeServer = `http://127.0.0.1:${fakePort}`;

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${fakeServer}/__control/reset`, {
    data: { scenario: 'happy-path' },
  });
  expect(response.ok()).toBeTruthy();
});

test('issue-1172-delta-c1/c2: lifecycle views, all projects, and fork are usable from Chats', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const create = page
    .getByRole('button', { name: 'Create chat', exact: true })
    .locator('visible=true');
  await expect(create).toBeEnabled({ timeout: 30_000 });
  await create.click();
  const titleInput = page
    .getByLabel('Chat title', { exact: true })
    .locator('visible=true');
  await titleInput.fill('Lifecycle proof');
  await expect(titleInput).toHaveValue('Lifecycle proof');
  await titleInput.press('Tab');
  await page
    .getByRole('button', { name: 'Create', exact: true })
    .locator('visible=true')
    .click();
  await expect(
    page.getByPlaceholder('Ask anything...').locator('visible=true'),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole('button', { name: 'Back to Agents', exact: true })
    .locator('visible=true')
    .click();

  await expect(
    page
      .getByRole('button', { name: 'Filter chats by project', exact: true })
      .locator('visible=true'),
  ).toContainText('All projects');
  await page
    .getByTestId('chat-lifecycle-completed')
    .locator('visible=true')
    .click();
  await expect(
    page.getByText('Lifecycle proof', { exact: true }).locator('visible=true'),
  ).toBeVisible();

  await page
    .getByLabel('Chat actions for Lifecycle proof', { exact: true })
    .locator('visible=true')
    .click();
  await page
    .locator('[role="menuitem"][data-testid^="chat-action-fork-"]')
    .locator('visible=true')
    .click();
  await expect(
    page.getByPlaceholder('Ask anything...').locator('visible=true'),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole('button', { name: 'Back to Agents', exact: true })
    .locator('visible=true')
    .click();
  await page
    .getByTestId('chat-lifecycle-all')
    .locator('visible=true')
    .click();
  await expect(
    page
      .getByText('Lifecycle proof (fork)', { exact: true })
      .locator('visible=true'),
  ).toBeVisible();
});

test('issue-1172-delta-c6: unified Activity renders all six source kinds', async ({
  page,
  request,
}) => {
  const activitySources = await request.post(
    `${fakeServer}/__control/activity-sources`,
    { data: { includeOptimizer: true } },
  );
  expect(activitySources.ok()).toBeTruthy();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('button', { name: 'Agents menu', exact: true })
    .locator('visible=true')
    .click();
  await page
    .getByRole('menuitem', { name: 'Activity', exact: true })
    .locator('visible=true')
    .click();
  for (const [title, source] of [
    ['Human target activity', 'human'],
    ['Schedule target activity', 'scheduler'],
    ['Webhook target activity', 'webhook'],
    ['Research target activity', 'research'],
    ['Cookbook target activity', 'cookbook'],
    ['Optimizer target activity', 'optimizer'],
  ]) {
    await expect(
      page
        .getByLabel(`${title}. ${source}. completed.`, { exact: true })
        .locator('visible=true'),
    ).toBeVisible();
  }
});
