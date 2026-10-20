import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test as base, expect } from './feature-test';

// Audit the real guest renderers as well as the host renderer audited by feature-test.
const test = base.extend<{ nativeAudit: void }>({
  nativeAudit: [async ({ page }, use) => {
    const errors: string[] = [];
    const listeners = new Map<Page, (error: Error) => void>();
    const observe = (child: Page) => {
      if (listeners.has(child)) return;
      const listener = (error: Error) => {
        if (/^(?:rhythm-colony:|file:.*hermes-desktop)/.test(child.url())) errors.push(error.message);
      };
      listeners.set(child, listener);
      child.on('pageerror', listener);
    };
    const contexts = page.context().browser()!.contexts();
    contexts.forEach(context => { context.pages().forEach(observe); context.on('page', observe); });
    try { await use(); } finally {
      contexts.forEach(context => context.off('page', observe));
      listeners.forEach((listener, child) => child.off('pageerror', listener));
      expect(errors, 'uncaught error in an actual companion renderer').toEqual([]);
    }
  }, { auto: true }],
});

async function companionPage(page: Page, kind: 'hermes' | 'colony'): Promise<Page> {
  await page.goto(`rhythm://app/index.html#/${kind}`);
  const find = () => page.context().browser()!.contexts().flatMap(context => context.pages()).filter(candidate => {
    const url = new URL(candidate.url());
    return kind === 'hermes'
      ? url.protocol === 'file:' && url.pathname.endsWith('/hermes-desktop/renderer/index.html') && url.searchParams.get('embedded') === '1'
      : url.protocol === 'rhythm-colony:' && url.pathname === '/index.html';
  });
  await expect.poll(() => find().length, { timeout: 60_000, message: `${kind}: actual pinned child renderer did not attach` }).toBe(1);
  return find()[0];
}

test('[AI Hermes] real Desktop opens saved history through its actual gateway', async ({ page }) => {
  // Catches dashboard substitution, a disconnected embedded Desktop and saved history that cannot open.
  const desktop = await companionPage(page, 'hermes');
  await expect(desktop.getByRole('textbox', { name: 'Search sessions', exact: true })).toBeVisible();
  await expect(desktop.getByRole('button', { name: /^Gateway ready$/ })).toBeVisible({ timeout: 60_000 });
  const sessions = await desktop.evaluate(async () => {
    const body = await (window as any).hermesDesktop.api({ path: '/api/sessions?limit=20&min_messages=2&archived=exclude' });
    return body.sessions.map((row: any) => ({ id: row.id, title: row.title }));
  }) as Array<{ id: string; title: string }>;
  expect(sessions.length, 'UNVERIFIED: read-only Hermes history fixture is empty').toBeGreaterThan(0);
  const all = desktop.getByRole('button', { name: 'All projects', exact: true });
  if (await all.isVisible()) await all.click();
  const row = sessions.find(row => row.title);
  expect(row, 'UNVERIFIED: Hermes returned no titled saved session').toBeDefined();
  await desktop.getByRole('textbox', { name: 'Search sessions', exact: true }).fill(row!.title);
  await desktop.getByText(row!.title, { exact: true }).first().click();
  await expect(desktop.locator('[data-role="user"], [data-role="assistant"]').first()).toBeVisible();
  await desktop.getByRole('textbox', { name: 'Search sessions', exact: true }).fill('');
  const host = await page.getByRole('region', { name: 'Hermes Desktop workspace' }).boundingBox();
  expect(host!.width).toBeGreaterThan(300);
  expect(host!.height).toBeGreaterThan(160);
});

test('[AI Hermes] an unsent draft survives tab switches without creating a backend session', async ({ page }) => {
  // Catches remount destroying unsent work, and new-chat/draft actions accidentally dispatching paid work.
  const desktop = await companionPage(page, 'hermes');
  await expect(desktop.getByRole('button', { name: /^Gateway ready$/ })).toBeVisible({ timeout: 60_000 });
  const ids = () => desktop.evaluate(async () => {
    const body = await (window as any).hermesDesktop.api({ path: '/api/sessions?limit=100&archived=exclude' });
    return body.sessions.map((row: any) => row.id).sort();
  });
  const before = await ids();
  await desktop.getByRole('button', { name: /^New session/ }).first().click();
  const composer = desktop.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeVisible();
  expect((await composer.innerText()).trim(), 'refuse to overwrite an existing Hermes draft').toBe('');
  const draft = `[smoke] hermes ${randomUUID().slice(0, 8)} unsent`;
  try {
    await composer.fill(draft);
    await page.goto('rhythm://app/index.html#/tools/agent-tools');
    expect(desktop.isClosed()).toBe(false);
    const returned = await companionPage(page, 'hermes');
    expect(returned).toBe(desktop);
    await expect(composer).toHaveText(draft);
    expect(await ids()).toEqual(before);
  } finally {
    if (!desktop.isClosed() && (await composer.innerText()) === draft) await composer.fill('');
  }
});

test('[AI Hermes] notification overlay preserves a usable native workspace and restores it', async ({ page }) => {
  // Catches #1579: opening the bell made the embedded app vanish and never recover.
  const desktop = await companionPage(page, 'hermes');
  await expect(desktop.getByRole('button', { name: /^Gateway ready$/ })).toBeVisible({ timeout: 60_000 });
  const historyIds = () => desktop.evaluate(async () => {
    const body = await (window as any).hermesDesktop.api({ path: '/api/sessions?limit=20&archived=exclude' });
    return body.sessions.map((row: any) => row.id).sort();
  });
  const beforeIds = await historyIds();
  expect(beforeIds.length, 'UNVERIFIED: Hermes history fixture is empty').toBeGreaterThan(0);
  const host = page.getByRole('region', { name: 'Hermes Desktop workspace' });
  const before = await host.boundingBox();
  await page.getByTestId('notifications-button').click();
  try {
    await expect(page.locator('.notifications-menu')).toBeVisible();
    const during = await host.boundingBox();
    expect(during!.width).toBeGreaterThan(150);
    expect(during!.height).toBeGreaterThan(160);
    expect(desktop.isClosed()).toBe(false);
  } finally { await page.keyboard.press('Escape'); }
  await expect(page.locator('.notifications-menu')).toHaveCount(0);
  await expect.poll(async () => (await host.boundingBox())!.width).toBeCloseTo(before!.width, 0);
  // Observe the actual child service after the overlay, not a mocked attach receipt.
  expect(await historyIds()).toEqual(beforeIds);
  await expect(desktop.getByRole('textbox', { name: 'Search sessions', exact: true })).toBeVisible();
});

test('[AI Bot Crossing] actual pinned scene reads paged local inventory', async ({ page }) => {
  // Catches a healthy-looking React host with no real scene or disconnected multi-harness inventory service.
  const scene = await companionPage(page, 'colony');
  await expect(scene.getByRole('searchbox', { name: 'Search projects and sessions', exact: true })).toBeVisible({ timeout: 60_000 });
  const status = await page.evaluate(async () => (window as any).rhythmShell.colonyView.getStatus());
  expect(status).toMatchObject({ v: 1, available: true, enabled: true });
  let generation: string | undefined;
  try {
    const first = await page.evaluate(async () => (window as any).rhythmShell.colonyView.inventoryPage({ collection: 'threads', limit: 5 }));
    generation = first.generation;
    expect(first.collection).toBe('threads');
    expect(first.records.length).toBeLessThanOrEqual(5);
    expect(first.scannedAt).toBeGreaterThan(0);
    expect(first.records.length, 'UNVERIFIED: Bot Crossing inventory fixture is empty').toBeGreaterThan(0);
    for (const row of first.records) expect(typeof row.id).toBe('string');
    const fromScene = await scene.evaluate(async generation => (window as any).colonyEmbedded.request('inventory.page', { collection: 'threads', limit: 5, generation }), generation);
    expect(fromScene.records.map((row: any) => row.id)).toEqual(first.records.map((row: any) => row.id));
    if (first.nextCursor) {
      const next = await page.evaluate(async args => (window as any).rhythmShell.colonyView.inventoryPage(args), { collection: 'threads', limit: 5, generation, cursor: first.nextCursor });
      expect(next.generation).toBe(generation);
      expect(next.records.map((row: any) => row.id).some((id: string) => first.records.some((row: any) => row.id === id))).toBe(false);
    }
  } finally {
    if (generation) await page.evaluate(async generation => (window as any).rhythmShell.colonyView.inventoryCancel(generation), generation);
  }
});

test('[AI Bot Crossing] tab switch preserves one scene and restores usable inventory', async ({ page }) => {
  // The native service intentionally suspends the scene on departure; return must restore real data access.
  const old = await companionPage(page, 'colony');
  await expect(old.getByRole('searchbox', { name: 'Search projects and sessions', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.goto('rhythm://app/index.html#/tools/agent-tools');
  expect(old.isClosed()).toBe(false);
  const scene = await companionPage(page, 'colony');
  expect(scene).toBe(old);
  await expect(scene.getByRole('searchbox', { name: 'Search projects and sessions', exact: true })).toBeVisible({ timeout: 60_000 });
  let generation: string | undefined;
  try {
    const inventory = await scene.evaluate(async () => (window as any).colonyEmbedded.request('inventory.page', { collection: 'threads', limit: 5 }));
    generation = inventory.generation;
    expect(inventory.collection).toBe('threads');
    expect(inventory.records.length, 'UNVERIFIED: restored Bot Crossing inventory is empty').toBeGreaterThan(0);
    expect(inventory.scannedAt).toBeGreaterThan(0);
    for (const row of inventory.records) expect(typeof row.id).toBe('string');
  } finally {
    if (generation) await scene.evaluate(async generation => (window as any).colonyEmbedded.request('inventory.cancel', { generation }), generation);
  }
});

test('[AI Dayflow] advertised native workspace actually attaches', async ({ page }) => {
  // Deliberately fails a build that advertises Dayflow while silently omitting its native module.
  await page.goto('rhythm://app/index.html#/tools/dayflow');
  const host = page.getByTestId('dayflow-native-host');
  await expect(host).toBeVisible();
  const status = await page.evaluate(async () => (window as any).rhythmShell.dayflowView.getStatus());
  expect(status, 'Dayflow native module is unavailable in the locally built candidate').not.toMatchObject({ state: 'unavailable' });
  await expect(host).toHaveAttribute('data-phase', 'attached');
  const rect = await host.boundingBox();
  expect(rect!.height).toBeGreaterThan(160);
});

test('[AI Dayflow] original signed application artifact is ready', async ({ page }) => {
  // Catches invalid/missing Dayflow inputs before an Open button can promise a working application.
  const status = await page.evaluate(async () => (window as any).rhythmShell.dayflowDesktop.getDayflowDesktopStatus());
  expect(status, 'Dayflow artifact validation rejected this local candidate').toMatchObject({ status: 'ready', version: expect.any(String), identifier: expect.any(String) });
  // No launch or recording permission is granted by this readiness test.
  await page.goto('rhythm://app/index.html#/tools/agent-tools');
  await expect(page.getByTestId('agent-tool-dayflow')).toContainText('Dayflow');
});
