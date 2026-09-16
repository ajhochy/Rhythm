import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { openFixture } from '../helpers';

const inspectorPath = path.resolve(import.meta.dirname, '../../src/components/Inspector.tsx');

async function inspectorSource() {
  return readFile(inspectorPath, 'utf8');
}

test('issue-1408-c1: session changes retain before/after content and render it when expanded', async () => {
  // Regression caught: session rows expand but render nothing because only patch is displayed.
  const source = await inspectorSource();
  expect(source).toMatch(/before:\s*row\.before/);
  expect(source).toMatch(/after:\s*row\.after/);
  expect(source).toMatch(/expanded\[entry\.path\][\s\S]*entry\.before[\s\S]*entry\.after/);
});

test('issue-1410-c1: both file viewers write the selected path before reporting copy success', async () => {
  // Regression caught: either copy button can show success while never touching the clipboard.
  const source = await inspectorSource();
  expect(source).toMatch(/await\s+navigator\.clipboard\.writeText\(path\);[\s\S]*notify\(['"]File path copied['"]\)/);
  expect(source.match(/copyFilePath\([^,]+,\s*notify\)/g)).toHaveLength(2);
});

test('issue-1410-c2: clipboard rejection does not report success', async () => {
  // Regression caught: denied clipboard permission still produces the success toast.
  const source = await inspectorSource();
  expect(source).toMatch(/async function copyFilePath[\s\S]*catch\s*\{[\s\S]*notify\([^)]*(failed|unable)/i);
});

test('issue-1409-c1: simulated terminal is explicitly labeled Fixture', async ({ page }) => {
  // E27 now owns real live PTY behavior through its dedicated config.
  await openFixture(page);
  await page.getByTestId('inspector-terminal').click();
  await expect(page.getByTestId('terminal-panel').locator('.kind-badge')).toHaveText('Fixture');
});

test('issue-1409-c2: fixture commands never claim a local PTY connection', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await openFixture(page);
  await page.getByTestId('inspector-terminal').click();
  await page.getByTestId('terminal-input').fill('pwd');
  await page.getByTestId('terminal-run').click();
  await expect(page.getByTestId('toast-status')).toContainText('Fixture terminal command completed');
  await expect(page.getByTestId('terminal-panel')).not.toContainText('Local PTY');
  expect(writes).toEqual([]);
});
