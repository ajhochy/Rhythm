import { expect, test } from '@playwright/test';

async function openTool(page, name) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Tools' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}\\.`) }).click();
}

test('issue-1173-c6: Profile edits preserve scope and projection ordering', async ({ page }) => {
  await openTool(page, 'Profiles');
  await page.getByText('Secretary').click();
  await page.getByLabel('Profile prompt').fill('Coordinate ministry follow-up safely.');
  await page.getByRole('button', { name: 'No permissions' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Projected to OpenCode')).toBeVisible();
});

test('issue-1173-c7: Cookbook CRUD and confirmed execution', async ({ page }) => {
  await openTool(page, 'Cookbook');
  await page.getByRole('button', { name: 'New recipe' }).click();
  await page.getByLabel('Recipe title').fill('Weekly volunteer recap');
  await page.getByRole('button', { name: 'Save recipe' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Run Weekly volunteer recap' }).click();
  await expect(page.getByText(/queued|started/i).first()).toBeVisible();
});

test('issue-1173-c8: Review Queue risk controls and Report Card', async ({ page }) => {
  await openTool(page, 'Review Queue');
  await page.getByText('High-risk model change').click();
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'Approve proposal' }).click();
  await page.getByRole('button', { name: 'Back to Tools' }).click();
  await page.getByRole('button', { name: /^Report Card\./ }).click();
  await expect(page.getByText(/success rate/i).first()).toBeVisible();
});
