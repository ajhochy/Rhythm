import { expect, test } from '@playwright/test';

const TOOLS = [
  'Brain',
  'Research',
  'Scheduled Jobs',
  'Webhooks',
  'Profiles',
  'Cookbook',
  'Review Queue',
  'Report Card',
  'Email',
  'Gallery',
  'Skills',
  'Playbooks',
  'MCP',
  'Providers & Models',
];

test('issue-1173-c12: all fourteen tools are navigable and reviewed', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Tools' }).click();
  for (const tool of TOOLS) {
    const link = page.getByRole('button', { name: new RegExp(`^${tool}\\.`) });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole('heading', { name: tool })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Tools' }).click();
  }
});
