import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const proofDir = fileURLToPath(
  new URL('../../../../.proof/i1285/ui/', import.meta.url),
);

async function capture(page, name) {
  await mkdir(proofDir, { recursive: true });
  await page.screenshot({ path: `${proofDir}/${name}.png`, fullPage: true });
}

async function openTool(page, name) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Tools' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}\\.`) }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

test('issue-1285-c3: proposed reviews and paired Gallery metadata are actionable', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('button', { name: 'Agents menu', exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1_500);
  await page.getByRole('button', { name: 'Agents menu', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Create chat', exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await capture(page, 'agents-menu-open');

  await openTool(page, 'Review Queue');
  await page.getByText('High-risk model change').click();
  await expect(page.getByRole('button', { name: 'Approve proposal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject proposal' })).toBeVisible();
  await capture(page, 'review-queue-proposal');

  await page.getByRole('button', { name: 'Back to Tools' }).click();
  await page.getByRole('button', { name: /^Gallery\./ }).click();
  await expect(page.getByText('Sunday service graphic')).toBeVisible();
  await capture(page, 'gallery');
});

test('issue-1285-c4-c5: large catalogs share controls and providers explain safe model availability', async ({ page }) => {
  for (const tool of ['Skills', 'MCP', 'Profiles', 'Providers & Models']) {
    await openTool(page, tool);
    await expect(page.getByTestId('tool-catalog-controls')).toBeVisible();
    await expect(page.getByLabel(`Search ${tool}`)).toBeVisible();
    await expect(page.getByText('Group by', { exact: true })).toBeVisible();
    await expect(page.getByText('Sort by', { exact: true })).toBeVisible();
    await capture(
      page,
      tool.toLowerCase().replaceAll(' & ', '-').replaceAll(' ', '-'),
    );
  }

  await expect(
    page.getByText(/Only AI providers and models configured or available in Rhythm/),
  ).toBeVisible();
  await expect(page.getByText('GPT-4.1 mini')).toBeVisible();
  await page.getByLabel('Search Providers & Models').fill('GPT-4.1');
  await expect(page.getByText('OpenAI')).toBeVisible();
});
