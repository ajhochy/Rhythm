import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

type Call = { action: string; payload?: unknown };
type FixtureWindow = Window & { __colonyCalls: Call[]; __colonyEmit(message: { event: string; payload: Record<string, unknown> }): void };

async function mockColony(page: Page, options: { enabled?: boolean; available?: boolean; missingHost?: boolean; attachOutcomes?: Array<{ ok: boolean; reason?: string }> } = {}) {
  await page.addInitScript((options) => {
    const calls: Call[] = [];
    const subscribers = new Set<(message: { event: string; payload: Record<string, unknown> }) => void>();
    let enabled = options.enabled ?? false;
    let sources = [
      { id: 'hermes', state: 'present', enabled: false },
      { id: 'codex', state: 'missing', enabled: false },
    ];
    let attempt = 0;
    const outcomes = options.attachOutcomes ?? [{ ok: true }];
    Object.assign(window, {
      __colonyCalls: calls,
      __colonyEmit: (message: { event: string; payload: Record<string, unknown> }) => subscribers.forEach((subscriber) => subscriber(message)),
      rhythmShell: options.missingHost ? {} : { colonyView: {
        getStatus: async () => { calls.push({ action: 'status' }); return { v: 1, available: options.available ?? true, enabled, sources }; },
        discoverSources: async () => { calls.push({ action: 'discover' }); return sources; },
        setSource: async (id: string, value: boolean) => { calls.push({ action: 'setSource', payload: { id, enabled: value } }); sources = sources.map((source) => source.id === id ? { ...source, enabled: value } : source); return { v: 1, available: true, enabled, sources }; },
        setEnabled: async (value: boolean) => { calls.push({ action: 'setEnabled', payload: value }); enabled = value; return { v: 1, available: true, enabled, sources }; },
        attach: async () => { calls.push({ action: 'attach' }); return outcomes[Math.min(attempt++, outcomes.length - 1)]; },
        setBounds: async (bounds: unknown) => { calls.push({ action: 'bounds', payload: bounds }); return true; },
        detach: async () => { calls.push({ action: 'detach' }); return true; },
        onEvent: (subscriber: (message: { event: string; payload: Record<string, unknown> }) => void) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
      } },
    });
  }, options);
}

const calls = (page: Page, action: string) => page.evaluate((action) => (window as unknown as FixtureWindow).__colonyCalls.filter((call) => call.action === action), action);

test('1530:native-host:1 Bot Crossing is an optional destination and overflows at compact widths', async ({ page }) => {
  await mockColony(page);
  await openPage(page, '/agents');
  await expect(page.getByTestId('nav-colony')).toHaveText('Bot Crossing');
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.getByTestId('nav-more').click();
  await expect(page.getByTestId('nav-colony-overflow')).toHaveText('Bot Crossing');
});

test('embedded Rhythm session opens reuse the existing agents navigation path', async ({ page }) => {
  await mockColony(page, { enabled: true });
  await openPage(page, '/colony');
  await expect(page.getByRole('region', { name: 'Bot Crossing scene' })).toBeVisible();
  await page.evaluate(() => (window as unknown as FixtureWindow).__colonyEmit({ event: 'scene.action', payload: { ok: true, kind: 'rhythm-session', sessionId: 'session-from-scene' } }));
  await expect(page).toHaveURL(/#\/agents\?sessionId=session-from-scene$/);
});

test('1530:native-host:2 disabled first visit explains local read-only discovery without attaching', async ({ page }) => {
  await mockColony(page);
  await openPage(page, '/colony');
  await expect(page.getByRole('heading', { name: 'See your local agent work in one place' })).toBeVisible();
  await expect(page.getByText(/read-only/i)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Hermes/i })).toBeVisible();
  expect(await calls(page, 'attach')).toEqual([]);
  expect(await calls(page, 'inventory')).toEqual([]);
  expect(await new AxeBuilder({ page }).include('.colony-page').analyze()).toMatchObject({ violations: [] });
});

test('1530:native-host:3 enable attaches once, resizes, and route departure detaches once', async ({ page }) => {
  await mockColony(page);
  await openPage(page, '/colony');
  await page.getByRole('checkbox', { name: /Hermes/i }).check();
  await page.getByRole('button', { name: 'Enable Bot Crossing' }).click();
  await expect(page.getByRole('region', { name: 'Bot Crossing scene' })).toBeVisible();
  await expect.poll(async () => (await calls(page, 'bounds')).length).toBeGreaterThan(0);
  expect(await calls(page, 'setEnabled')).toHaveLength(1);
  expect(await calls(page, 'attach')).toHaveLength(1);
  const before = (await calls(page, 'bounds')).length;
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect.poll(async () => (await calls(page, 'bounds')).length).toBeGreaterThan(before);
  await page.evaluate(() => { window.location.hash = '/tasks'; });
  await expect.poll(async () => (await calls(page, 'detach')).length).toBe(1);
});

test('Bot Crossing normal state is only a full-bleed native scene host', async ({ page }) => {
  // Regression caught: Rhythm's duplicate toolbar, task rail, inspector, and disabled View menu shrink and cover the original Bot Crossing UI.
  await mockColony(page, { enabled: true });
  await openPage(page, '/colony');
  const host = page.getByRole('region', { name: 'Bot Crossing scene' });
  await expect(host).toBeVisible();
  await expect(page.locator('.colony-toolbar')).toHaveCount(0);
  await expect(page.locator('.colony-rail')).toHaveCount(0);
  await expect(page.locator('.colony-inspector')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View options' })).toHaveCount(0);
  const [pageBox, hostBox] = await Promise.all([page.getByTestId('page-colony').boundingBox(), host.boundingBox()]);
  expect(pageBox).not.toBeNull();
  expect(hostBox).not.toBeNull();
  expect(Math.abs(hostBox!.width - pageBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(hostBox!.height - pageBox!.height)).toBeLessThanOrEqual(1);
});

test('1530:native-host:4 attach errors can be retried', async ({ page }) => {
  await mockColony(page, { enabled: true, attachOutcomes: [{ ok: false, reason: 'Pinned Colony artifact is missing.' }, { ok: true }] });
  await openPage(page, '/colony');
  await expect(page.getByRole('alert')).toContainText('Pinned Colony artifact is missing');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('region', { name: 'Bot Crossing scene' })).toBeVisible();
  expect(await calls(page, 'attach')).toHaveLength(2);
});

test('1530:native-host:5 a missing host requests a rebuild accessibly', async ({ page }) => {
  await mockColony(page, { missingHost: true });
  await openPage(page, '/colony');
  await expect(page.getByRole('alert')).toContainText('Rebuild the Rhythm package');
  expect(await new AxeBuilder({ page }).include('.colony-page').analyze()).toMatchObject({ violations: [] });
});

test('1530:native-host:overlay shell overlays hide the native view and restore its bounds', async ({ page }) => {
  await mockColony(page, { enabled: true });
  await page.setViewportSize({ width: 1000, height: 800 });
  await openPage(page, '/colony');
  await expect.poll(async () => (await calls(page, 'bounds')).length).toBeGreaterThan(0);
  await page.getByTestId('nav-more').click();
  await expect.poll(async () => (await calls(page, 'bounds')).at(-1)?.payload).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  await page.keyboard.press('Escape');
  await expect.poll(async () => ((await calls(page, 'bounds')).at(-1)?.payload as { width?: number } | undefined)?.width ?? 0).toBeGreaterThan(0);
});
