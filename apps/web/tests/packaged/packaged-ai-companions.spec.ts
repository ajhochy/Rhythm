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

async function waitForColonyReady(scene: Page) {
  // Do not acquire or cancel an inventory generation while the scene owns its initial poll.
  await expect.poll(() => scene.evaluate(() => {
    const bootCount = document.querySelectorAll('.boot').length;
    const notice = document.querySelector('.scan-notice');
    const noticeHidden = !notice || notice instanceof HTMLElement && notice.hidden;
    const noticeKind = noticeHidden ? 'hidden' : notice?.textContent?.startsWith('Scan unavailable.') ? 'scan-unavailable' : 'benign-notice';
    const projectCount = document.querySelectorAll('.projects .repo').length;
    return bootCount === 0 && noticeKind !== 'scan-unavailable' && projectCount > 0;
  }), { timeout: 60_000, message: 'Bot Crossing did not reach a populated, non-failing scene state' }).toBe(true);
}

async function readPostReturnColonyInventory(scene: Page) {
  // The returning host and retained scene each own a snapshot slot. Observe only after
  // one completes; a third read cannot fit the worker's unchanged two-slot cap.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await scene.evaluate(async () => (window as any).colonyEmbedded.request('inventory.page', { collection: 'threads', limit: 5 }));
    } catch (error) {
      if (!(error instanceof Error) || !/(?:^|: )\[colony:oversize\] Colony operation exceeds its size or capacity limit$/.test(error.message) || Date.now() >= deadline) throw error;
      await scene.waitForTimeout(Math.min(500, deadline - Date.now()));
    }
  }
}

async function colonyOverview(scene: Page) {
  return scene.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('.projects .repo')];
    const text = rows.map(row => row.innerText).join('\n');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    const notes = [...document.querySelectorAll<HTMLElement>('.projects .project-category-note')].map(note => note.textContent?.trim() ?? '');
    return {
      projectCount: rows.length,
      rowsDigest: (hash >>> 0).toString(16),
      noLocationsMatch: notes.includes('No locations match these filters.'),
    };
  });
}

test('[AI CROSS] cold Hermes startup remains usable across immediate Colony inventory', async ({ page }) => {
  // Open the real child, then leave before waiting for its backend. This covers
  // the startup overlap missed by the warm retained-child test below.
  const hermes = await companionPage(page, 'hermes');
  const openedAt = Date.now();
  const scene = await companionPage(page, 'colony');
  await waitForColonyReady(scene);
  expect(hermes.isClosed(), 'Hermes child should remain retained during startup').toBe(false);
  let generation: string | undefined;
  try {
    const inventory = await readPostReturnColonyInventory(scene);
    generation = inventory.generation;
    expect(inventory.records.length, 'real Colony inventory is empty').toBeGreaterThan(0);
  } finally {
    if (generation) await scene.evaluate(async value => (window as any).colonyEmbedded.request('inventory.cancel', { generation: value }), generation);
  }
  await scene.waitForTimeout(Math.max(0, 17_000 - (Date.now() - openedAt)));
  const returned = await companionPage(page, 'hermes');
  expect(returned, 'the same Hermes child should resume').toBe(hermes);
  await expect(returned.getByRole('button', { name: /^Gateway ready$/ })).toBeVisible({ timeout: 60_000 });
  const historyCount = await returned.evaluate(async () => {
    const body = await (window as any).hermesDesktop.api({ path: '/api/sessions?limit=20&min_messages=2&archived=exclude' });
    return body.sessions.length;
  });
  expect(historyCount, 'Hermes saved history fixture is empty').toBeGreaterThan(0);
});

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

test('[AI CROSS] Hermes remains responsive after Colony inventory while hidden beyond the backend timeout', async ({ page }) => {
  // Keep history identities inside the native renderer so test output contains only counts/status.
  const historySlot = `__rhythmCrossHistory_${randomUUID().replaceAll('-', '')}`;
  const hermes = await companionPage(page, 'hermes');
  let scene: Page | undefined;
  let generation: string | undefined;
  try {
    await expect(hermes.getByRole('button', { name: /^Gateway ready$/ })).toBeVisible({ timeout: 60_000 });
    const baselineCount = await hermes.evaluate(async slot => {
      const body = await (window as any).hermesDesktop.api({ path: '/api/sessions?limit=20&min_messages=2&archived=exclude' });
      const ids = body.sessions.map((row: { id: string }) => row.id).sort();
      Object.defineProperty(window, slot, { value: ids, configurable: true });
      return ids.length;
    }, historySlot);
    expect(baselineCount, 'Hermes saved history fixture is empty').toBeGreaterThan(0);

    scene = await companionPage(page, 'colony');
    await waitForColonyReady(scene);
    expect(hermes.isClosed(), 'Hermes child should remain alive off-tab').toBe(false);
    const hiddenAt = Date.now();
    try {
      // The scene and host may already own both snapshot slots; retry only that
      // documented capacity response, for at most 30 seconds.
      const inventory = await readPostReturnColonyInventory(scene);
      generation = inventory.generation;
      expect(inventory.collection).toBe('threads');
      expect(inventory.records.length, 'real Colony inventory is empty').toBeGreaterThan(0);
      expect(inventory.scannedAt).toBeGreaterThan(0);
    } finally {
      if (generation) {
        await scene.evaluate(async value => (window as any).colonyEmbedded.request('inventory.cancel', { generation: value }), generation);
        generation = undefined;
      }
    }
    // No test-initiated Hermes API calls while hidden. The strict main and
    // native renderer audits still reject any background failure.
    await scene.waitForTimeout(Math.max(0, 16_500 - (Date.now() - hiddenAt)));
    expect(Date.now() - hiddenAt).toBeGreaterThanOrEqual(16_500);

    const returned = await companionPage(page, 'hermes');
    expect(returned, 'the retained Hermes child should resume').toBe(hermes);
    await expect(returned.getByRole('button', { name: /^Gateway ready$/ })).toBeVisible({ timeout: 60_000 });
    const resumed = await returned.evaluate(async slot => {
      const body = await (window as any).hermesDesktop.api({ path: '/api/sessions?limit=20&min_messages=2&archived=exclude' });
      const ids = body.sessions.map((row: { id: string }) => row.id).sort();
      const before = (window as any)[slot] as string[] | undefined;
      return { count: ids.length, same: Array.isArray(before) && JSON.stringify(ids) === JSON.stringify(before) };
    }, historySlot);
    expect(resumed).toEqual({ count: baselineCount, same: true });
  } finally {
    if (generation && scene && !scene.isClosed()) {
      await scene.evaluate(async value => (window as any).colonyEmbedded.request('inventory.cancel', { generation: value }), generation);
    }
    if (!hermes.isClosed()) await hermes.evaluate(slot => { delete (window as any)[slot]; }, historySlot);
  }
});

test('[AI Bot Crossing] actual pinned scene reads paged local inventory', async ({ page }) => {
  // Catches a healthy-looking React host with no real scene or disconnected multi-harness inventory service.
  const scene = await companionPage(page, 'colony');
  await waitForColonyReady(scene);
  await expect(scene.getByRole('searchbox', { name: 'Search projects and sessions', exact: true })).toBeVisible({ timeout: 60_000 });
  const status = await page.evaluate(async () => (window as any).rhythmShell.colonyView.getStatus());
  expect(status).toMatchObject({ v: 1, available: true, enabled: true });
  let generation: string | undefined;
  try {
    // The retained scene and host may already occupy both worker snapshot slots.
    // Acquire one bounded scene generation, then exercise the host against that same snapshot.
    const acquired = await readPostReturnColonyInventory(scene);
    generation = acquired.generation;
    expect(typeof generation).toBe('string');
    const first = await page.evaluate(async generation => (window as any).rhythmShell.colonyView.inventoryPage({ collection: 'threads', limit: 5, generation }), generation);
    expect(first.collection).toBe('threads');
    expect(first.records.length).toBeLessThanOrEqual(5);
    expect(first.scannedAt).toBeGreaterThan(0);
    expect(first.records.length, 'UNVERIFIED: Bot Crossing inventory fixture is empty').toBeGreaterThan(0);
    for (const row of first.records) expect(typeof row.id).toBe('string');
    expect(acquired.records.map((row: any) => row.id)).toEqual(first.records.map((row: any) => row.id));
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
  await waitForColonyReady(old);
  await expect(old.getByRole('searchbox', { name: 'Search projects and sessions', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.goto('rhythm://app/index.html#/tools/agent-tools');
  expect(old.isClosed()).toBe(false);
  const scene = await companionPage(page, 'colony');
  expect(scene).toBe(old);
  await waitForColonyReady(scene);
  await expect(scene.getByRole('searchbox', { name: 'Search projects and sessions', exact: true })).toBeVisible({ timeout: 60_000 });
  let generation: string | undefined;
  try {
    const inventory = await readPostReturnColonyInventory(scene);
    generation = inventory.generation;
    expect(inventory.collection).toBe('threads');
    expect(inventory.records.length, 'UNVERIFIED: restored Bot Crossing inventory is empty').toBeGreaterThan(0);
    expect(inventory.scannedAt).toBeGreaterThan(0);
    for (const row of inventory.records) expect(typeof row.id).toBe('string');
  } finally {
    if (generation) await scene.evaluate(async generation => (window as any).colonyEmbedded.request('inventory.cancel', { generation }), generation);
  }
});

test('[AI Bot Crossing] no-match search clears back to the retained populated scene and live inventory', async ({ page }) => {
  const originalScene = await companionPage(page, 'colony');
  await waitForColonyReady(originalScene);
  const before = await colonyOverview(originalScene);
  expect(before.projectCount).toBeGreaterThan(0);

  await page.goto('rhythm://app/index.html#/tools/agent-tools');
  expect(originalScene.isClosed()).toBe(false);
  const returnedScene = await companionPage(page, 'colony');
  expect(returnedScene).toBe(originalScene);
  await waitForColonyReady(returnedScene);
  const afterReturn = await colonyOverview(returnedScene);
  expect(afterReturn.projectCount).toBe(before.projectCount);
  expect(afterReturn.rowsDigest).toBe(before.rowsDigest);

  const search = returnedScene.getByRole('searchbox', { name: 'Search projects and sessions', exact: true });
  await expect(search).toBeVisible();
  let smokeQuery: string | null = null;
  try {
    smokeQuery = `[smoke] no-match ${randomUUID().slice(0, 8)}`;
    await search.fill(smokeQuery);
    await expect.poll(async () => {
      const observed = await colonyOverview(returnedScene);
      return observed.projectCount === 0 && observed.noLocationsMatch;
    }, { timeout: 15_000, message: 'unique local search should display the real no-locations state' }).toBe(true);
  } finally {
    if (smokeQuery && !returnedScene.isClosed() && await search.inputValue().catch(() => '') === smokeQuery) {
      await search.fill('');
    }
  }
  await expect.poll(async () => {
    const observed = await colonyOverview(returnedScene);
    return observed.projectCount === before.projectCount && observed.rowsDigest === before.rowsDigest && !observed.noLocationsMatch;
  }, { timeout: 15_000, message: 'clearing the local search should restore the same populated projects' }).toBe(true);

  // Read the actual post-return scene service after readiness and cancel only this observer's generation.
  let generation: string | undefined;
  try {
    const inventory = await readPostReturnColonyInventory(returnedScene);
    generation = typeof inventory.generation === 'string' ? inventory.generation : undefined;
    expect(inventory.collection).toBe('threads');
    expect(Array.isArray(inventory.records)).toBe(true);
    expect(inventory.records.length).toBeGreaterThan(0);
    expect(inventory.records.length).toBeLessThanOrEqual(5);
    expect(inventory.scannedAt).toBeGreaterThan(0);
  } finally {
    if (generation && !returnedScene.isClosed()) {
      await returnedScene.evaluate(async value => (window as any).colonyEmbedded.request('inventory.cancel', { generation: value }), generation);
    }
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
