import { chromium, expect, test } from '@playwright/test';
import path from 'node:path';

test('inactive Dayflow gateway uses the local transport and strips hosted authorization', async () => {
  const { createLiveGateway } = await import(path.resolve(import.meta.dirname, '../src/gateway/index.ts'));
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const gateway = createLiveGateway({
    apiBase: 'http://127.0.0.1:4798',
    engineBase: 'http://127.0.0.1:4797',
    expectedApiBase: 'http://127.0.0.1:4798',
    expectedEngineBase: 'http://127.0.0.1:4797',
    productionApiBase: 'https://api.example.test',
    taskToken: 'disposable-cloud-token',
  }, async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify({ enabled: false, automaticImport: false, adapterStatus: 'adapter_not_ready', sourceVersion: 'fixture-v1', timezone: '', importedCount: 0, pendingCreateCount: 0, pendingDeleteCount: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await gateway.domains.dayflow!.getStatus();
  await gateway.domains.dayflow!.getConfig();
  expect(calls).toEqual([
    { url: 'http://127.0.0.1:4798/dayflow-integration/status', authorization: null },
    { url: 'http://127.0.0.1:4798/dayflow-integration/config', authorization: null },
  ]);
});

test('Dayflow Settings mounts without source access, then requires dated preview and selected consent', async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) throw new Error('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is required for this cached-browser fixture test.');
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:4173/tests/electron-e40-harness.html#/settings?settingsSection=dayflow');
    await expect(page.getByTestId('page-settings')).toBeVisible();
    await expect(page.getByRole('option', { name: 'Dayflow', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dayflow' })).toBeVisible();
    await expect(page.getByTestId('dayflow-status')).toContainText('unconfigured');
    expect(await page.evaluate(() => (window as typeof window & { __e40: unknown[] }).__e40))
      .toEqual([['dayflow-status'], ['dayflow-config'], ['dayflow-owned']]);
    await page.getByTestId('dayflow-bundle-path').fill('/Applications/Dayflow.app'); await page.getByTestId('dayflow-check-source').click();
    await expect(page.getByRole('alert')).toContainText('Source verified');
    await page.getByTestId('dayflow-timezone').fill('America/Los_Angeles');
    await page.getByTestId('dayflow-save').click();
    await expect(page.getByTestId('dayflow-status')).toContainText('ready');
    await page.getByTestId('dayflow-enable').click();
    await page.getByTestId('dayflow-preview').click(); const preview = page.getByTestId('dayflow-preview-results');
    await expect(preview.getByRole('checkbox')).not.toBeChecked(); await expect(page.getByTestId('dayflow-import')).toBeDisabled();
    await preview.getByRole('checkbox').check(); await page.getByTestId('dayflow-import').click();
    expect(await page.evaluate(() => (window as typeof window & { __e40: unknown[] }).__e40.some((entry: any[]) => entry[0] === 'dayflow-commit' && entry[2].length === 1))).toBe(true);
    await page.getByTestId('dayflow-disable').click(); page.once('dialog', dialog => dialog.accept()); await page.getByTestId(`dayflow-forget-0123456789ABCDEFGHJKMNPQRS`).click();
  } finally {
    await browser.close();
  }
});

test('a first token-bearing save retires only its consumed token while preserving a newer draft', async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath) throw new Error('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is required for this cached-browser fixture test.');
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:4173/tests/electron-e40-harness.html?race=consumed-token#/settings?settingsSection=dayflow');
    await page.getByTestId('dayflow-bundle-path').fill('/Applications/Dayflow.app'); await page.getByTestId('dayflow-check-source').click();
    await page.getByTestId('dayflow-timezone').fill('America/Los_Angeles'); await page.getByTestId('dayflow-exclusions').fill('First edit'); await page.getByTestId('dayflow-save').click();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __e40: any[] }).__e40.filter((entry) => entry[0] === 'dayflow-config-save').length)).toBe(1);
    await page.getByTestId('dayflow-exclusions').fill('Newer edit');
    await page.evaluate(() => (window as typeof window & { __e40ReleaseFirstSave: () => void }).__e40ReleaseFirstSave());
    await expect(page.getByTestId('dayflow-save')).toBeEnabled();
    await page.getByTestId('dayflow-save').click();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __e40: any[] }).__e40.filter((entry) => entry[0] === 'dayflow-config-save').map((entry) => entry[1]))).toEqual([
      expect.objectContaining({ sourceSelectionToken: 'opaque-selection', exclusions: ['First edit'] }),
      expect.objectContaining({ sourceSelectionToken: undefined, exclusions: ['Newer edit'] }),
    ]);
    await expect(page.getByTestId('dayflow-status')).toContainText('ready');
  } finally {
    await browser.close();
  }
});
