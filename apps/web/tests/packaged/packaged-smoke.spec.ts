// Whole-app smoke of a packaged Rhythm.app: runtime, every page, core flows, clean quit.
// Runs as the smoke profile's real Google account against production; every write is
// a "[smoke]" record deleted by the same test.
import type { Page } from '@playwright/test';
import { test, expect, waitForSignedIn, listeningPid, bundleVersion, RUNTIME_PORTS } from './packaged-app';
import { OwnedRecords } from './feature-test';

test.describe.configure({ mode: 'serial' });

const PAGES: Array<{ key: string; marker: string }> = [
  { key: 'dashboard', marker: '#dashboard-title' },
  { key: 'planner', marker: '#planner-title' },
  { key: 'tasks', marker: '#tasks-title' },
  { key: 'rhythms', marker: '#rhythms-title' },
  { key: 'projects', marker: '#projects-title' },
  { key: 'messages', marker: '#messages-title' },
  { key: 'facilities', marker: '#facilities-title' },
  { key: 'automations', marker: '#automations-title' },
  { key: 'integrations', marker: '#integrations-title' },
  { key: 'settings', marker: '#settings-title' },
  { key: 'agents', marker: 'section[aria-label="Agents workspace"]' },
];
// Native host views: present only when the build ships and pins them.
const NATIVE: Array<{ key: string; marker: string }> = [
  { key: 'hermes', marker: '[data-testid="page-hermes"]' },
  { key: 'colony', marker: '[data-testid="page-colony"]' },
  { key: 'open-design', marker: '[data-testid="page-open-design"]' },
];

async function openNav(page: Page, key: string): Promise<boolean> {
  const direct = page.getByTestId(`nav-${key}`);
  if (await direct.isVisible()) { await direct.click(); return true; }
  const more = page.getByTestId('nav-more');
  if (!(await more.isVisible())) return false;
  await more.click();
  const overflow = page.getByTestId(`nav-${key}-overflow`);
  if (await overflow.isVisible()) { await overflow.click(); return true; }
  await page.keyboard.press('Escape');
  return false;
}

async function expectPageHealthy(page: Page, key: string, marker: string) {
  await expect(page.locator(marker).first(), `${key} page did not render`).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('route-not-found'), `${key} routed to Not found`).toHaveCount(0);
  await expect(page.getByTestId('page-state-server-error'), `${key} shows a server error`).toHaveCount(0);
}

test.beforeEach(async ({ packaged }) => { if (packaged) packaged.pageErrors.length = 0; });
test.afterEach(async ({ packaged }) => {
  if (packaged) expect(packaged.pageErrors, 'uncaught renderer errors').toEqual([]);
});

test('runtime: packaged app starts its own healthy runtime and signs in', async ({ page, packaged }) => {
  const expected = process.env.RHYTHM_EXPECTED_VERSION;
  if (expected) expect(bundleVersion(packaged.appPath)).toBe(expected);
  await waitForSignedIn(page);

  await expect.poll(() => page.evaluate(() => (window as any).rhythmShell.agentServer.status()), { timeout: 60_000 })
    .toMatchObject({ status: 'ready', ownership: 'electron' });
  const gateway = await page.evaluate(() => ({ api: (window as any).rhythmShell.gateway.apiBase, engine: (window as any).rhythmShell.gateway.engineBase }));
  expect(gateway).toEqual({ api: 'http://127.0.0.1:4001', engine: 'http://127.0.0.1:4096' });

  const api = await fetch('http://127.0.0.1:4001/health');
  expect(api.status).toBe(200);
  expect(await api.json()).toMatchObject({ status: 'ok' });
  const engine = await fetch('http://127.0.0.1:4096/global/health');
  expect(engine.status).toBe(200);
  expect(await engine.json()).toMatchObject({ healthy: true });
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
});

test('navigation: every page renders without errors', async ({ page }) => {
  for (const { key, marker } of PAGES) {
    await test.step(key, async () => {
      expect(await openNav(page, key), `nav-${key} missing from the shell`).toBe(true);
      await expect(page).toHaveURL(new RegExp(`#/${key}(\\?.*)?$`));
      await expectPageHealthy(page, key, marker);
    });
  }
  for (const { key, marker } of NATIVE) {
    await test.step(`${key} (native)`, async () => {
      if (!(await openNav(page, key))) { test.info().annotations.push({ type: 'not-shipped', description: key }); return; }
      await expectPageHealthy(page, key, marker);
    });
  }
  await test.step('notifications menu opens', async () => {
    await openNav(page, 'agents');
    const menu = page.getByRole('button', { name: /^Notifications/ });
    await menu.click();
    await expect(page.getByTestId('approval-queue-status').or(page.getByTestId('approval-queue-announcement')).first()).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

test('tasks: create, edit, complete and delete a [smoke] task', async ({ page }) => {
  const records = new OwnedRecords(page, 'tasks', 'packaged');
  const title = records.prefix;
  let taskId = '';
  await records.open();
  await expect(page.locator('#tasks-title')).toBeVisible();
  try {
    const empty = page.getByTestId('tasks-empty-create');
    await (await empty.isVisible() ? empty : page.getByTestId('tasks-header-add-task')).click();
    await page.getByTestId('task-create-title').fill(title);
    await page.getByTestId('task-create-submit').click();
    const row = page.locator('[data-testid^="task-row-"]', { hasText: title });
    await expect(row).toBeVisible({ timeout: 20_000 });
    taskId = (await row.getAttribute('data-testid'))!.replace('task-row-', '');

    await page.getByTestId(`task-select-${taskId}`).click();
    await page.getByTestId('task-edit-title').fill(`${title} edited`);
    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-inspector')).toContainText(`${title} edited`);

    await page.getByTestId(`task-complete-${taskId}`).click();
    await page.getByTestId('tasks-completion-filter').selectOption('all');
    await expect(page.getByTestId(`task-row-${taskId}`)).toContainText(`${title} edited`);

    await page.reload();
    await waitForSignedIn(page);
    await openNav(page, 'tasks');
    await page.getByTestId('tasks-completion-filter').selectOption('all');
    await expect(page.getByTestId(`task-row-${taskId}`), 'edit did not persist across reload').toContainText(`${title} edited`);
  } finally {
    await records.cleanup();
  }
});

test('agents: a new session gets a real model reply, then is deleted', async ({ page }) => {
  test.setTimeout(240_000);
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNVERIFIED: real-model tests require RHYTHM_FEATURE_MODEL=1').toBe('1');
  const records = new OwnedRecords(page, 'sessions', 'packaged');
  try {
    await records.open();
    await records.create(' model');
    // The answer (42) is not in the prompt, so it can only come from the model.
    await page.getByTestId('composer-input').fill('Reply with only the result of 17 + 25 written as digits.');
    await page.getByTestId('composer-send').click();
    await expect(page.getByTestId('transcript')).toContainText('42', { timeout: 180_000 });
  } finally {
    await records.cleanup();
  }
});

test('quit: app exits cleanly and leaves no runtime behind', async ({ packaged }) => {
  const exit = await packaged.quit();
  expect(exit.signal, `needed SIGKILL to stop\n${packaged.output().slice(-2000)}`).not.toBe('SIGKILL');
  await expect.poll(() => RUNTIME_PORTS.filter((port) => listeningPid(port)), { timeout: 15_000, message: 'api_server/engine still listening after quit' }).toEqual([]);
});
