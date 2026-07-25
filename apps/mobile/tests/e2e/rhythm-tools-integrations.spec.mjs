import { expect, test } from '@playwright/test';

async function openTool(page, name) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Tools' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}\\.`) }).click();
}

test('issue-1173-c9: cloud tools survive paired host outage without sensitive caching', async ({ page }) => {
  await openTool(page, 'Email');
  await expect(page.getByText('Volunteer reply')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Tools' }).click();
  await page.getByRole('button', { name: /^Gallery\./ }).click();
  await expect(page.getByText('Sunday service graphic')).toBeVisible();
});

test('issue-1173-c10: paired integrations lifecycle and feature gating', async ({ page }) => {
  await openTool(page, 'Skills');
  await expect(page.getByText('Approved skills', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Tools' }).click();
  await page.getByRole('button', { name: /^Playbooks\./ }).click();
  await expect(page.getByRole('button', { name: 'New playbook' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Tools' }).click();
  await page.getByRole('button', { name: /^MCP\./ }).click();
  await expect(page.getByText(/connected|disabled/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Back to Tools' }).click();
  await page.getByRole('button', { name: /^Providers & Models\./ }).click();
  await expect(page.getByText('OpenAI')).toBeVisible();
});
