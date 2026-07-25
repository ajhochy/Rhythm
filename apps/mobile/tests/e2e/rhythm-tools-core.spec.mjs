import { expect, test } from '@playwright/test';

async function openTool(page, name) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Tools' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}\\.`) }).click();
}

test('issue-1173-c2: Brain CRUD search and offline cache', async ({ page }) => {
  await openTool(page, 'Brain');
  await page.getByRole('button', { name: 'New memory' }).click();
  await page.getByLabel('Memory title').fill('Sunday handoff');
  await page.getByLabel('Memory content').fill('Call the volunteer coordinator.');
  await page.getByRole('button', { name: 'Save memory' }).click();
  await page.getByLabel('Search Brain').fill('volunteer');
  await expect(page.getByText('Sunday handoff')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete Sunday handoff' }).click();
  await expect(page.getByText('Sunday handoff')).not.toBeVisible();
});

test('issue-1173-c3: Research lifecycle', async ({ page }) => {
  await openTool(page, 'Research');
  await page.getByRole('button', { name: 'New research' }).click();
  await page.getByLabel('Research question').fill('How should we follow up with first-time guests?');
  await page.getByRole('button', { name: 'Start research' }).click();
  const research = page.getByRole('button', {
    name: /How should we follow up with first-time guests.*gathering/i,
  });
  await expect(research).toBeVisible();
  await research.click();
  await expect(page.getByText('Research report', { exact: true })).toBeVisible();
});

test('issue-1173-c4: Scheduled Job lifecycle and confirmations', async ({ page }) => {
  await openTool(page, 'Scheduled Jobs');
  await page.getByRole('button', { name: 'New scheduled job' }).click();
  await page.getByLabel('Job name').fill('Monday follow-up');
  await page.getByLabel('Cron schedule').fill('0 9 * * 1');
  await page.getByRole('button', { name: 'Save scheduled job' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Run Monday follow-up now' }).click();
  await expect(page.getByText('Run queued.', { exact: true })).toBeVisible();
});
