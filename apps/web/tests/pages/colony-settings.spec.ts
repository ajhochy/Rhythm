import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

type Call = { action: string; payload?: unknown };

async function mockColonySettings(page: Page) {
  await page.addInitScript(() => {
    const calls: Call[] = [];
    const resets = new Set<() => void>();
    let enabled = false;
    let sources = [{ id: 'codex', state: 'present', enabled: false }, { id: 'rhythm', state: 'present', enabled: false }];
    Object.assign(window, {
      __colonySettingsCalls: calls,
      __colonyReset: () => resets.forEach((callback) => callback()),
      rhythmShell: { appVersion: 'test', colonyView: {
        getStatus: async () => ({ v: 1, available: true, enabled, sources }),
        discoverSources: async () => sources,
        setEnabled: async (value: boolean) => { calls.push({ action: 'setEnabled', payload: value }); enabled = value; return { v: 1, available: true, enabled, sources }; },
        setSource: async (id: string, value: boolean) => { calls.push({ action: 'setSource', payload: { id, enabled: value } }); sources = sources.map((source) => source.id === id ? { ...source, enabled: value } : source); return { v: 1, available: true, enabled, sources }; },
        previewImport: async () => { calls.push({ action: 'previewImport' }); return { ok: true, counts: { archived: 7000, viewed: 4, groups: 2, version: 3 } }; },
        commitImport: async () => { calls.push({ action: 'commitImport' }); return { ok: true, receipt: { updatedAt: 42, counts: { archived: 7000, viewed: 4, groups: 2 } } }; },
        onReset: (callback: () => void) => { resets.add(callback); return () => resets.delete(callback); },
      } },
    });
  });
}

const calls = (page: Page) => page.evaluate(() => (window as Window & { __colonySettingsCalls: Call[] }).__colonySettingsCalls);

test('1532:settings-import-account-switch:4 settings explains local-only scanning and exposes source toggles accessibly', async ({ page }) => {
  // Regression caught: enablement happens without explaining scope or lets missing/unknown sources scan.
  await mockColonySettings(page);
  await openPage(page, '/settings?settingsSection=bot-crossing');
  await expect(page.getByRole('option', { name: 'Bot Crossing', exact: true })).toBeVisible();
  await expect(page.getByText(/local task stores/i)).toBeVisible();
  await expect(page.getByText(/not uploaded/i)).toBeVisible();
  await page.getByLabel('Scan Codex').check();
  await page.getByRole('button', { name: 'Enable Bot Crossing' }).click();
  expect(await calls(page)).toEqual([
    { action: 'setSource', payload: { id: 'codex', enabled: true } },
    { action: 'setEnabled', payload: true },
  ]);
  expect(await new AxeBuilder({ page }).include('.settings-page').analyze()).toMatchObject({ violations: [] });
});

test('1532:settings-import-account-switch:5 preview shows counts and commits exactly once after confirmation', async ({ page }) => {
  // Regression caught: renderer supplies a path, skips preview, or double-submits import.
  await mockColonySettings(page);
  await openPage(page, '/settings?settingsSection=bot-crossing');
  await page.getByLabel('Scan Codex').check();
  await page.getByRole('button', { name: 'Enable Bot Crossing' }).click();
  await page.getByRole('button', { name: 'Choose state file' }).click();
  await expect(page.getByText('7,000 archived')).toBeVisible();
  await expect(page.getByText('4 viewed')).toBeVisible();
  const commit = page.getByRole('button', { name: 'Import this state' });
  await commit.dblclick();
  await expect(page.locator('.colony-settings').getByRole('status')).toContainText('Imported 7,000 archived');
  expect(await calls(page)).toEqual([
    { action: 'setSource', payload: { id: 'codex', enabled: true } },
    { action: 'setEnabled', payload: true },
    { action: 'previewImport' }, { action: 'commitImport' },
  ]);
});

test('1532:settings-import-account-switch:6 host reset clears visible preview and disables the section', async ({ page }) => {
  // Regression caught: account switch leaves old-profile counts or enabled state visible.
  await mockColonySettings(page);
  await openPage(page, '/settings?settingsSection=bot-crossing');
  await page.getByLabel('Scan Codex').check();
  await page.getByRole('button', { name: 'Enable Bot Crossing' }).click();
  await page.getByRole('button', { name: 'Choose state file' }).click();
  await expect(page.getByText('7,000 archived')).toBeVisible();
  await page.evaluate(() => (window as Window & { __colonyReset(): void }).__colonyReset());
  await expect(page.getByText('7,000 archived')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable Bot Crossing' })).toBeVisible();
});

test('review:apps/web/src/pages/colony/settings.tsx:85 file selection stays disabled during commit', async ({ page }) => {
  await mockColonySettings(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, '__finishColonyCommit', { configurable: true, value: undefined, writable: true });
    window.addEventListener('DOMContentLoaded', () => {
      const shell = (window as Window & { rhythmShell?: { colonyView?: { commitImport?: () => Promise<unknown> } }; __finishColonyCommit?: () => void }).rhythmShell;
      if (!shell?.colonyView) return;
      shell.colonyView.commitImport = () => new Promise((resolve) => {
        (window as Window & { __finishColonyCommit?: () => void }).__finishColonyCommit = () => resolve({ ok: true, receipt: { updatedAt: 42, counts: { archived: 7000, viewed: 4, groups: 2 } } });
      });
    }, { once: true });
  });
  await openPage(page, '/settings?settingsSection=bot-crossing');
  await page.getByRole('button', { name: 'Enable Bot Crossing' }).click();
  await page.getByRole('button', { name: 'Choose state file' }).click();
  await page.getByRole('button', { name: 'Import this state' }).click();
  await expect(page.getByRole('button', { name: 'Choose state file' })).toBeDisabled();
  await page.evaluate(() => (window as Window & { __finishColonyCommit?: () => void }).__finishColonyCommit?.());
  await expect(page.locator('.colony-settings').getByRole('status')).toContainText('Imported 7,000 archived');
});
