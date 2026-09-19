import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';
import type { HermesStatus } from '../../src/pages/hermes/bridge';

type Receipt = { action: string; payload?: unknown };
type FixtureWindow = Window & { __hermesCalls: Receipt[]; __hermesStatus(status: HermesStatus): void };

async function mockHermes(page: Page, state: HermesStatus['state'], options: { enabled?: boolean; rejectStatus?: boolean; rejectAttach?: boolean } = {}) {
  await page.addInitScript(({ state, options }) => {
    let status = { state, port: 9121, url: 'http://127.0.0.1:9121', version: '1.2.3', reason: state === 'failed' ? 'Hermes exited before it was ready.' : undefined };
    const calls: Receipt[] = [];
    const subscribers = new Set<(status: HermesStatus) => void>();
    Object.assign(window, {
      __hermesCalls: calls,
      __hermesStatus: (next: typeof status) => { status = next; for (const callback of subscribers) callback(next); },
      rhythmShell: {
        hermes: {
          enabled: options.enabled ?? true,
          getStatus: async () => { if (options.rejectStatus) throw new Error('offline'); return status; },
          install: async () => { calls.push({ action: 'install' }); return { ...status, state: 'starting' }; },
          restart: async () => { calls.push({ action: 'restart' }); return { ...status, state: 'starting' }; },
          onStatus: (callback: (status: HermesStatus) => void) => { subscribers.add(callback); return () => { subscribers.delete(callback); calls.push({ action: 'unsubscribe' }); }; },
        },
        hermesView: {
          attach: async () => { calls.push({ action: 'attach' }); return { ok: !options.rejectAttach }; },
          setBounds: async (bounds: unknown) => { calls.push({ action: 'bounds', payload: bounds }); return true; },
          detach: async () => { calls.push({ action: 'detach' }); return true; },
          sendIntent: async (intent: unknown) => { calls.push({ action: 'intent', payload: intent }); return { ok: false, reason: 'unsupported-draft' }; },
        },
      },
    });
  }, { state, options });
}
const receipts = (page: Page, action: string) => page.evaluate(action => (window as unknown as FixtureWindow).__hermesCalls.filter(call => call.action === action), action);

test('Hermes destination is hidden in a browser and its direct route explains enabling', async ({ page }) => {
  await openPage(page, '/hermes');
  await expect(page.getByTestId('page-hermes')).toHaveAttribute('data-hermes-state', 'disabled');
  await expect(page.getByRole('heading', { name: 'Hermes is disabled' })).toBeVisible();
  await expect(page.getByText('RHYTHM_HERMES_ENABLED=1', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="nav-hermes"], [data-testid="nav-hermes-overflow"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask Hermes about my dashboard' })).toBeDisabled();
});

test('Hermes disabled bridge hides the destination even if a stale status says ready', async ({ page }) => {
  await mockHermes(page, 'ready', { enabled: false });
  await openPage(page, '/hermes');
  await expect(page.getByTestId('page-hermes')).toHaveAttribute('data-hermes-state', 'disabled');
  expect(await receipts(page, 'attach')).toEqual([]);
  await expect(page.getByTestId('nav-hermes')).toHaveCount(0);
});

for (const [state, heading] of [
  ['absent', 'Install Hermes on this Mac'], ['starting', 'Starting Hermes…'],
  ['failed', 'Hermes could not open'], ['stopped', 'Hermes has stopped'],
] as const) {
  test(`Hermes ${state} state is explicit and keeps the intent disabled`, async ({ page }) => {
    await mockHermes(page, state);
    await openPage(page, '/hermes');
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask Hermes about my dashboard' })).toBeDisabled();
    expect(await receipts(page, 'attach')).toEqual([]);
    if (state === 'starting') await expect(page.getByRole('progressbar', { name: 'Starting Hermes' })).toBeVisible();
    if (state === 'failed') await expect(page.getByRole('alert')).toContainText('Hermes exited');
  });
}

for (const [state, button, action] of [['absent', 'Install Hermes…', 'install'], ['failed', 'Retry', 'restart']] as const) {
  test(`Hermes ${action} delegates to the native supervisor`, async ({ page }) => {
    await mockHermes(page, state);
    await openPage(page, '/hermes');
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.getByTestId('page-hermes')).toHaveAttribute('data-hermes-state', 'starting');
    expect(await receipts(page, action)).toEqual([{ action }]);
  });
}

test('Hermes ready attaches, reports viewport bounds, and detaches on leaving', async ({ page }) => {
  await mockHermes(page, 'ready');
  await openPage(page, '/hermes');
  const host = page.locator('[data-hermes-host]');
  await expect(host).toBeVisible();
  await page.clock.runFor(50);
  await expect.poll(async () => (await receipts(page, 'bounds')).length).toBeGreaterThan(0);
  const bounds = await host.boundingBox();
  const recorded = (await receipts(page, 'bounds')).at(-1)?.payload as typeof bounds;
  expect(recorded).toEqual(bounds);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.clock.runFor(50);
  await expect.poll(async () => (await receipts(page, 'bounds')).length).toBeGreaterThan(1);
  await page.evaluate(() => { window.location.hash = '/tasks'; });
  await expect(host).toHaveCount(0);
  expect((await receipts(page, 'detach')).length).toBeGreaterThan(0);
  expect((await receipts(page, 'unsubscribe')).length).toBeGreaterThan(0);
});

test('Hermes status changes tear down the ready view', async ({ page }) => {
  await mockHermes(page, 'ready');
  await openPage(page, '/hermes');
  await expect(page.locator('[data-hermes-host]')).toBeVisible();
  await page.evaluate(() => (window as unknown as FixtureWindow).__hermesStatus({ state: 'failed', reason: 'Hermes stopped unexpectedly.' }));
  await expect(page.getByRole('alert')).toContainText('Hermes stopped unexpectedly.');
  await expect(page.locator('[data-hermes-host]')).toHaveCount(0);
  expect((await receipts(page, 'detach')).length).toBeGreaterThan(0);
});

test('Hermes changing the ready origin remounts its native host', async ({ page }) => {
  await mockHermes(page, 'ready');
  await openPage(page, '/hermes');
  await expect(page.locator('[data-hermes-host]')).toBeVisible();
  const attachments = (await receipts(page, 'attach')).length;
  await page.evaluate(() => (window as unknown as FixtureWindow).__hermesStatus({ state: 'ready', port: 9122, url: 'http://127.0.0.1:9122' }));
  await expect.poll(async () => (await receipts(page, 'attach')).length).toBeGreaterThan(attachments);
  expect((await receipts(page, 'detach')).length).toBeGreaterThan(0);
});

test('Hermes asks only on click, sends a labelled bounded summary, and reports unsupported drafts', async ({ page }) => {
  await mockHermes(page, 'ready');
  await openPage(page, '/hermes');
  const ask = page.getByRole('button', { name: 'Ask Hermes about my dashboard' });
  await expect(ask).toBeEnabled();
  expect(await receipts(page, 'intent')).toEqual([]);
  await ask.click();
  const requests = await receipts(page, 'intent');
  expect(requests).toHaveLength(1);
  const intent = requests[0].payload as { v: number; type: string; context: string };
  expect(Object.keys(intent).sort()).toEqual(['context', 'type', 'v']);
  expect(intent.v).toBe(1); expect(intent.type).toBe('new-chat');
  expect(intent.context).toMatch(/^Rhythm dashboard summary\n/);
  expect(Buffer.byteLength(intent.context, 'utf8')).toBeLessThanOrEqual(4096);
  await expect(page.getByRole('status').filter({ hasText: 'does not support opening a draft' })).toBeVisible();
});

for (const options of [{ rejectStatus: true }, { rejectAttach: true }]) {
  test(`Hermes ${Object.keys(options)[0]} shows a recoverable failure`, async ({ page }) => {
    await mockHermes(page, 'ready', options);
    await openPage(page, '/hermes');
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask Hermes about my dashboard' })).toBeDisabled();
  });
}

for (const state of ['disabled', 'absent', 'starting', 'failed', 'ready'] as const) {
  test(`Hermes ${state} is accessible at narrow RTL and enlarged text`, async ({ page }) => {
    await mockHermes(page, state, { enabled: state !== 'disabled' });
    await page.setViewportSize({ width: 640, height: 900 });
    await openPage(page, '/hermes');
    await expect(page.getByTestId('page-hermes')).toHaveAttribute('data-hermes-state', state);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.style.fontSize = '200%'; });
    const result = await new AxeBuilder({ page }).include('.hermes-page').analyze();
    expect(result.violations).toEqual([]);
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  });
}
