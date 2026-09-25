import { expect, test, type Page } from '@playwright/test';
import { buildColonyRailModel, reconcileColonySelection, type ColonyThread } from '../../src/pages/colony/model';
import { openPage } from '../helpers';

type Call = { action: string; payload?: unknown };
type ColonyWindow = Window & {
  __colonyCalls: Call[];
  __colonyEmit(message: { event: 'scene.select' | 'scene.status'; payload: Record<string, unknown> }): void;
};

const threads: ColonyThread[] = [
  { id: 'task-active', title: 'Active repository task', harness: 'codex', projectName: 'Rhythm', cwd: '/work/Rhythm', gitBranch: 'feature/very-long-branch-name', activity: 'running', running: true, hasError: false, checkout: { repositoryId: 'repo-1', missing: false } },
  { id: 'task-unknown', title: 'Unknown repository task', harness: 'hermes', projectName: 'Rhythm', cwd: '/work/Rhythm', activity: 'unknown', running: null, hasError: true, checkout: { repositoryId: 'repo-1', missing: false } },
  { id: 'task-attention', title: 'Workspace needs attention', harness: 'rhythm', projectName: 'Planning', cwd: '/work/planning', activity: 'quiet', running: false, hasError: true, checkout: { repositoryId: '', missing: false, kind: 'directory' } },
  { id: 'task-history', title: 'Historical running error', harness: 'codex', projectName: 'Old repo', cwd: '/missing/old', activity: 'running', running: true, hasError: true, checkout: { repositoryId: 'repo-old', missing: true } },
];

async function mockColony(page: Page) {
  await page.addInitScript((records) => {
    const calls: Call[] = [];
    const subscribers = new Set<(message: { event: 'scene.select' | 'scene.status'; payload: Record<string, unknown> }) => void>();
    Object.assign(window, {
      __colonyCalls: calls,
      __colonyEmit: (message: { event: 'scene.select' | 'scene.status'; payload: Record<string, unknown> }) => subscribers.forEach((subscriber) => subscriber(message)),
      rhythmShell: { colonyView: {
        getStatus: async () => ({ v: 1, available: true, enabled: true, sources: [] }),
        discoverSources: async () => [], setSource: async () => ({}), setEnabled: async () => ({ v: 1, available: true, enabled: true, sources: [] }),
        attach: async () => ({ ok: true }), setBounds: async () => true, detach: async () => true,
        inventoryPage: async (page: { collection?: string }) => {
          calls.push({ action: 'inventoryPage', payload: page });
          return { generation: 'generation-1', collection: page.collection ?? 'threads', scannedAt: Date.now(), records: page.collection === 'threads' || !page.collection ? records : [], nextCursor: null };
        },
        inventoryCancel: async (generation: string) => { calls.push({ action: 'inventoryCancel', payload: generation }); return true; },
        sendIntent: (intent: unknown) => calls.push({ action: 'intent', payload: intent }),
        onEvent: (subscriber: (message: { event: 'scene.select' | 'scene.status'; payload: Record<string, unknown> }) => void) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
      } },
    });
  }, threads);
}

const calls = (page: Page, action: string) => page.evaluate((name) => (window as unknown as ColonyWindow).__colonyCalls.filter((call) => call.action === name), action);

test('1530:host-inventory-path-task-rail-and-inspector:3 groups honest rows and excludes historical or unknown work from summary counts', async ({ page }) => {
  await mockColony(page);
  await openPage(page, '/colony');
  await expect(page.getByRole('group', { name: 'Repositories' })).toContainText('Active repository task');
  await expect(page.getByRole('group', { name: 'Other workspaces' })).toContainText('Workspace needs attention');
  await expect(page.getByText('Activity unknown')).toBeVisible();
  await expect(page.getByText('Historical running error')).toHaveCount(0);
  await expect(page.getByTestId('colony-active-count')).toHaveText('Active 1');
  await expect(page.getByTestId('colony-attention-count')).toHaveText('Needs attention 1');
  await page.getByLabel('Include historical locations').check();
  await expect(page.getByRole('group', { name: 'Historical locations' })).toContainText('Folder missing');
  await expect(page.getByTestId('colony-active-count')).toHaveText('Active 1');
  await expect(page.getByTestId('colony-attention-count')).toHaveText('Needs attention 1');
})

test('1530:host-inventory-path-task-rail-and-inspector:4 shares filters and exact selection while clearing filtered or removed inspectors', async ({ page }) => {
  await mockColony(page);
  await openPage(page, '/colony');
  await page.getByTestId('task-active').click();
  await expect(page.getByRole('heading', { name: 'Active repository task' })).toBeVisible();
  await expect.poll(async () => (await calls(page, 'intent')).some((call) => JSON.stringify(call.payload).includes('host.select'))).toBe(true);

  await page.evaluate(() => (window as unknown as ColonyWindow).__colonyEmit({ event: 'scene.select', payload: { threadId: 'task-attention' } }));
  await expect(page.getByTestId('task-attention')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Workspace needs attention' })).toBeVisible();

  await page.getByLabel('Harness').selectOption('codex');
  await expect(page.getByRole('heading', { name: 'Workspace needs attention' })).toHaveCount(0);
  await expect.poll(async () => (await calls(page, 'intent')).some((call) => JSON.stringify(call.payload).includes('host.filter'))).toBe(true);
  await page.getByLabel('Search Bot Crossing tasks').fill('no matching task');
  await expect(page.getByText('No results match your filters.')).toBeVisible();

  await page.getByLabel('Search Bot Crossing tasks').fill('');
  await page.getByLabel('Harness').selectOption('');
  await page.getByLabel('Status').selectOption('blocked');
  await expect(page.getByTestId('task-attention')).toBeVisible();
  await expect(page.getByTestId('task-active')).toHaveCount(0);
  await expect.poll(async () => (await calls(page, 'intent')).some((call) => JSON.stringify(call.payload).includes('"activity":["blocked"]'))).toBe(true);

  expect(reconcileColonySelection('task-active', threads.slice(1))).toBeNull();
})

test('1530:host-inventory-path-task-rail-and-inspector:5 splitters persist/reset and controls do not overlap at approved sizes, zoom, or theme', async ({ page }) => {
  await mockColony(page);
  await openPage(page, '/colony');
  const railSplitter = page.getByRole('separator', { name: 'Resize Bot Crossing tasks list' });
  await railSplitter.focus();
  const initial = Number(await railSplitter.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await expect(railSplitter).toHaveAttribute('aria-valuenow', String(initial + 16));
  await page.reload();
  await expect(page.getByRole('separator', { name: 'Resize Bot Crossing tasks list' })).toHaveAttribute('aria-valuenow', String(initial + 16));
  await page.getByRole('separator', { name: 'Resize Bot Crossing tasks list' }).dblclick();
  await expect(page.getByRole('separator', { name: 'Resize Bot Crossing tasks list' })).toHaveAttribute('aria-valuenow', '304');

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }, { width: 800, height: 600 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => { document.body.style.zoom = '1'; });
      const boxes = await page.locator('.colony-page button:visible, .colony-page input:visible, .colony-page select:visible, .colony-page [role="separator"]:visible').evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      }));
      for (let left = 0; left < boxes.length; left++) for (let right = left + 1; right < boxes.length; right++) {
        const overlap = Math.min(boxes[left].right, boxes[right].right) - Math.max(boxes[left].left, boxes[right].left) > 1
          && Math.min(boxes[left].bottom, boxes[right].bottom) - Math.max(boxes[left].top, boxes[right].top) > 1;
        expect(overlap, `controls ${left} and ${right} overlap at ${viewport.width}x${viewport.height} ${colorScheme}`).toBe(false);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  }

  await page.setViewportSize({ width: 1024, height: 700 });
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
})

test('model contract keeps historical and stale/unknown rows out of active and attention counts', () => {
  const model = buildColonyRailModel(threads, { query: '', harness: [], activity: [], includeHistorical: true });
  expect(model.counts).toEqual({ active: 1, needsAttention: 1 });
})
