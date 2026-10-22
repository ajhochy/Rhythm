import path from 'node:path';
import { test, expect } from './fixture';

// Run only in the canonical synthetic sandbox; never targets an installed app.
test('C1–C4: cloud pages use same-origin host custody; upstream expiry leaves local sessions usable', async ({ page, api, apiBase }, testInfo) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1' || process.env.RHYTHM_WEB_CLOUD_TEST !== '1', 'requires explicitly enabled synthetic cloud sandbox');
  const token = 'web-cloud-synthetic-bearer-only';
  const browserRequests: string[] = [];
  const browserResponses: string[] = [];
  const responseReads: Promise<void>[] = [];
  page.on('request', request => { browserRequests.push(request.url(), JSON.stringify(request.headers()), request.postData() ?? ''); });
  page.on('response', response => {
    responseReads.push((async () => {
      browserResponses.push(JSON.stringify(await response.allHeaders()));
      try { browserResponses.push(await response.text()); } catch { /* WS/empty responses have no body */ }
    })());
  });
  const bootstrap = await api('/web/bootstrap');
  expect(bootstrap.capabilities.cloud).toBe(true);
  expect(JSON.stringify(bootstrap)).not.toContain(token);
  await page.goto('/#/tasks');
  await expect(page.getByText('Synthetic cloud task', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => { location.hash = '#/facilities'; });
  await expect(page.getByText('Synthetic cloud room', { exact: true }).first()).toBeVisible();
  const status = await (await fetch('http://127.0.0.1:7097/_cloud/status')).json();
  for (const route of ['/tasks?status=all', '/facilities']) {
    expect(status.recorded.some((row: any) => row.url === route && row.authorization === `Bearer ${token}` && !row.cookie)).toBe(true);
  }
  const cwd = path.resolve(import.meta.dirname, '../../../../');
  // Project-scoped like A2: unprojected sessions sit in the collapsed "No project" group.
  const project = await api('/projects', { method: 'POST', body: JSON.stringify({ name: 'Cloud expiry project', cwd }) });
  const session = await api('/agent-sessions', { method: 'POST', body: JSON.stringify({ name: 'Cloud expiry local access', cwd, projectId: project.id, isolateWorktree: false }) });
  await page.evaluate(() => { location.hash = '#/tasks'; });
  await expect(page.getByText('Synthetic cloud task', { exact: true }).first()).toBeVisible();
  await fetch('http://127.0.0.1:7097/_cloud/disconnect', { method: 'POST' });
  await page.evaluate(() => { location.hash = '#/facilities'; });
  await expect(page.getByText(/Upstream account connection problem/).first()).toBeVisible();
  await page.evaluate(() => { location.hash = '#/agents'; });
  // In-app navigation (no reload): a project created after load starts collapsed.
  await page.getByRole('button', { name: /^Cloud expiry project/ }).click();
  await page.getByTestId(`session-${session.id}`).click();
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
  await Promise.all(responseReads);
  expect(JSON.stringify([browserRequests, browserResponses, storage, await page.content()])).not.toContain(token);
  expect(browserRequests.filter(value => /^https?:\/\//.test(value)).every(value => new URL(value).origin === apiBase)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cloud-expired-local-session.png'), fullPage: true });
});
