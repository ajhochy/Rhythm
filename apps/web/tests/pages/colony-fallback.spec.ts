import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

type Call = { action: string; payload?: unknown };
type ColonyWindow = Window & {
  __colonyCalls: Call[];
  __colonyEmit(message: { event: 'scene.select' | 'scene.status'; payload: Record<string, unknown> }): void;
};

const threads = [
  { id: 'task-active', title: 'Active repository task', harness: 'codex', projectName: 'Rhythm', cwd: '/work/Rhythm', gitBranch: 'main', activity: 'running', running: true, hasError: false, checkout: { repositoryId: 'repo-1', missing: false } },
  { id: 'task-quiet', title: 'Quiet repository task', harness: 'hermes', projectName: 'Rhythm', cwd: '/work/Rhythm', activity: 'idle', running: false, hasError: false, checkout: { repositoryId: 'repo-1', missing: false } },
];

async function mockColony(page: Page, options: { warnings?: string[]; pageDelayMs?: number } = {}) {
  await page.addInitScript((init) => {
    const calls: Call[] = [];
    const subscribers = new Set<(message: { event: 'scene.select' | 'scene.status'; payload: Record<string, unknown> }) => void>();
    Object.assign(window, {
      __colonyCalls: calls,
      __colonyEmit: (message: { event: 'scene.select' | 'scene.status'; payload: Record<string, unknown> }) => subscribers.forEach((subscriber) => subscriber(message)),
      rhythmShell: { colonyView: {
        getStatus: async () => ({ v: 1, available: true, enabled: true, sources: [] }),
        discoverSources: async () => [],
        setSource: async () => ({}),
        setEnabled: async () => ({ v: 1, available: true, enabled: true, sources: [] }),
        attach: async (attachOptions?: { headless?: boolean }) => { calls.push({ action: 'attach', payload: attachOptions ?? {} }); return { ok: true }; },
        setBounds: async () => true,
        detach: async () => { calls.push({ action: 'detach' }); return true; },
        inventoryPage: async (page: { collection?: string }) => {
          calls.push({ action: 'inventoryPage', payload: page });
          // Only the collection(s) after 'threads' stall, so a generation is already known
          // (and some rows already visible) by the time the load is judged stale.
          if (init.pageDelayMs && page.collection !== 'threads') await new Promise((resolve) => window.setTimeout(resolve, init.pageDelayMs));
          if (page.collection === 'threads' || !page.collection) return { generation: 'generation-1', collection: 'threads', scannedAt: Date.now(), records: init.threads, nextCursor: null };
          if (page.collection === 'warnings') return { generation: 'generation-1', collection: 'warnings', scannedAt: Date.now(), records: init.warnings ?? [], nextCursor: null };
          return { generation: 'generation-1', collection: page.collection, scannedAt: Date.now(), records: [], nextCursor: null };
        },
        inventoryCancel: async (generation: string) => { calls.push({ action: 'inventoryCancel', payload: generation }); return true; },
        runAction: async (kind: string, id: string) => { calls.push({ action: 'runAction', payload: { kind, id } }); return { ok: true, kind: 'noop' }; },
        sendIntent: (intent: unknown) => calls.push({ action: 'intent', payload: intent }),
        onEvent: (subscriber: (message: { event: 'scene.select' | 'scene.status'; payload: Record<string, unknown> }) => void) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
        onReset: () => () => {},
      } },
    });
  }, { threads, warnings: options.warnings ?? [], pageDelayMs: options.pageDelayMs ?? 0 });
}

const calls = (page: Page, action: string) => page.evaluate((name) => (window as unknown as ColonyWindow).__colonyCalls.filter((call) => call.action === name), action);

test('1533:list-fallback:1 webgl loss switches to a keyboard-operable, axe-clean list-only layout', async ({ page }) => {
  await mockColony(page);
  await openPage(page, '/colony');
  await page.getByTestId('task-active').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Active repository task' })).toBeVisible();
  await page.evaluate(() => (window as unknown as ColonyWindow).__colonyEmit({ event: 'scene.status', payload: { webgl: 'lost' } }));
  await expect(page.getByRole('region', { name: 'Bot Crossing scene' })).toHaveCount(0);
  await expect(page.getByText(/3D scene unavailable/i)).toBeVisible();
  await page.getByRole('button', { name: 'Archive from Colony' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await calls(page, 'runAction')).length).toBeGreaterThan(0);
  expect(await new AxeBuilder({ page }).include('.colony-page').analyze()).toMatchObject({ violations: [] });
});

test('1533:list-fallback:2 a session that previously lost WebGL starts headless with no scene view next time', async ({ page }) => {
  await mockColony(page);
  await page.addInitScript(() => window.localStorage.setItem('colony.sceneUnavailable', '1'));
  await openPage(page, '/colony');
  await expect(page.getByRole('region', { name: 'Bot Crossing scene' })).toHaveCount(0);
  await expect.poll(async () => calls(page, 'attach')).toEqual([{ action: 'attach', payload: { headless: true } }]);
  await expect(page.getByTestId('task-active')).toBeVisible();
});

test('1533:list-fallback:3 progress appears immediately and a stale load offers cancel/retry at 60s', async ({ page }) => {
  // A delay far longer than the 60s window under test guarantees the page request is still
  // outstanding when the stale/cancel/retry assertions run, regardless of clock-jump timer
  // coalescing semantics.
  await mockColony(page, { pageDelayMs: 120_000 });
  await openPage(page, '/colony');
  await expect(page.getByText('Reading local Bot Crossing sources…')).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(page.getByText('Bot Crossing inventory is taking longer than expected.')).toBeVisible();
  const pageRequestsBeforeRetry = (await calls(page, 'inventoryPage')).length;
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(async () => (await calls(page, 'inventoryCancel')).length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(async () => (await calls(page, 'inventoryPage')).length).toBe(pageRequestsBeforeRetry + 1);
});

test('1533:list-fallback:4 a partial source failure names the failed source in text while healthy rows remain', async ({ page }) => {
  await mockColony(page, { warnings: ['hermes: scan failed'] });
  await openPage(page, '/colony');
  await expect(page.getByRole('alert').filter({ hasText: 'Hermes' })).toBeVisible();
  await expect(page.getByTestId('task-active')).toBeVisible();
  await expect(page.getByTestId('task-quiet')).toBeVisible();
});

test('1533:list-fallback:5 prefers-reduced-motion sends host.view motion off once attached', async ({ page }) => {
  await mockColony(page);
  await openPage(page, '/colony');
  await expect.poll(async () => (await calls(page, 'intent')).some((call) => JSON.stringify(call.payload).includes('"motion":"reduced"'))).toBe(true);
});

test('1533:list-fallback:6 a headless attach keeps the View menu scene controls honestly disabled', async ({ page }) => {
  // Regression: a headless attach resolving `{ ok: true }` used to mark the scene "available",
  // which left Reset camera/Focus/Reduced motion/Ambient sound/Quality enabled in list-only mode
  // even though headless never creates a scene channel for those intents to reach.
  await mockColony(page);
  await page.addInitScript(() => window.localStorage.setItem('colony.sceneUnavailable', '1'));
  await openPage(page, '/colony');
  await expect.poll(async () => calls(page, 'attach')).toEqual([{ action: 'attach', payload: { headless: true } }]);
  await page.getByRole('button', { name: 'View options' }).click();
  const resetCamera = page.getByRole('menuitem', { name: 'Reset camera' });
  await expect(resetCamera).toBeDisabled();
  await expect(resetCamera).toHaveAttribute('title', /list view/i);
  const reducedMotion = page.getByRole('menuitemcheckbox', { name: 'Reduced motion' });
  await expect(reducedMotion).toBeDisabled();
  await expect(reducedMotion).toHaveAttribute('title', /list view/i);
  const quality = page.getByRole('menuitemradio', { name: 'Quality: Auto' });
  await expect(quality).toBeDisabled();
  await expect(quality).toHaveAttribute('title', /list view/i);
  // No host.view intent was ever sent for the reduced-motion preference: a headless scene
  // has nothing listening for it.
  expect((await calls(page, 'intent')).some((call) => JSON.stringify(call.payload).includes('host.view'))).toBe(false);
});
