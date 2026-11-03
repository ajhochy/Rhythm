import { createRequire } from 'node:module';
import { test, expect } from './fixture';

test('U1: browser environment settles healthy using same-origin API and engine checks', async ({ page, apiBase }, info) => {
  const checks: string[] = [];
  page.on('response', response => { if (/\/(health|opencode\/health|opencode\/runtime)$/.test(response.url())) checks.push(response.url()); });
  await page.goto('/#/agents');
  await expect(page.getByTestId('environment-receipt')).toContainText('Environment: Live', { timeout: 20_000 });
  await expect(page.getByTestId('environment-receipt')).not.toContainText('checking');
  expect(checks).toContain(`${apiBase}/health`);
  expect(checks).toContain(`${apiBase}/opencode/health`);
  expect(checks.every(url => new URL(url).origin === apiBase)).toBe(true);
  await page.screenshot({ path: info.outputPath('environment-healthy.png'), fullPage: true });
});

test('O1: bootstrap role equals the validated fixture DB owner and controls existing admin UI', async ({ page, api }, info) => {
  const require = createRequire(`${process.cwd()}/apps/api_server/package.json`);
  const Database = require('better-sqlite3');
  const db = new Database(process.env.RHYTHM_LIVE_DB_PATH!, { readonly: true, fileMustExist: true });
  const id = Number(process.env.RHYTHM_WEB_OWNER_USER_ID ?? 1);
  const owner = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(id);
  db.close();
  expect(owner).toBeTruthy();
  expect((await api('/web/bootstrap')).owner).toMatchObject({ id: owner.id, displayName: owner.name, role: owner.role });
  await page.goto('/#/tools/agent-settings?settingsSection=auto-promotion');
  if (owner.role === 'admin') {
    await expect(page.getByTestId('auto-promotion-settings')).toBeVisible();
    await expect(page.getByText('Administrator access required to view or change auto-promotion.')).toHaveCount(0);
  } else await expect(page.getByText('Administrator access required to view or change auto-promotion.')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`owner-${owner.role}.png`), fullPage: true });
});
