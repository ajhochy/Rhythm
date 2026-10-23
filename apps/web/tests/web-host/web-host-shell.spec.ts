import { test, expect } from './fixture';

// Catches browser startup falling into GoogleSignIn, fixtures, or desktop URLs.
test('A1: configured owner shell uses only its own origin', async ({ page, api, apiBase }, testInfo) => {
  const foreign: string[] = [];
  const csp: string[] = [];
  page.on('console', message => { if (/Content Security Policy|violates.*directive|Refused to (connect|load)/i.test(message.text())) csp.push(message.text()); });
  page.on('request', request => {
    if (new URL(request.url()).origin !== apiBase) foreign.push(request.url());
  });
  const bootstrap = await api('/web/bootstrap');
  expect(bootstrap).toMatchObject({ mode: 'web', owner: { id: 1, displayName: 'Synthetic Admin' } });
  await page.goto('/');
  await expect(page.getByTestId('nav-agents')).toBeVisible();
  await expect(page.getByText('Synthetic Admin', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Sign in with Google/)).toHaveCount(0);
  expect(foreign).toEqual([]);
  expect(csp).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('A1-owner-shell.png'), fullPage: true });
});
