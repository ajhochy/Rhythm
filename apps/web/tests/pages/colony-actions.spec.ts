import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

type Call = { kind: string; id: string };
type Intent = { event: string; payload: Record<string, unknown> };

const threads = [
  { id: 'rhythm:parent', title: 'Exact parent', harness: 'rhythm', cwd: '/work/Rhythm', activity: 'quiet', running: false, archived: false, checkout: { repositoryId: 'repo', path: '/work/Rhythm', missing: false } },
  { id: 'opencode:worker', title: 'SDK worker', harness: 'opencode', parentId: 'rhythm:parent', cwd: '/work/Rhythm', activity: 'quiet', running: false, archived: false, checkout: { repositoryId: 'repo', path: '/work/Rhythm', missing: false } },
  { id: 'codex:exact', title: 'Exact Codex task', harness: 'codex', cwd: '/work/Rhythm', activity: 'quiet', running: false, archived: false, checkout: { repositoryId: 'repo', path: '/work/Rhythm', missing: false } },
  { id: 'hermes:no-open', title: 'Unavailable task', harness: 'hermes', navigationReason: 'Hermes exact opening is not qualified.', cwd: '/work/Rhythm', activity: 'quiet', running: false, archived: false, checkout: { repositoryId: 'repo', path: '/work/Rhythm', missing: false } },
];

async function mockColony(page: Page, failId = '') {
  await page.addInitScript(({ records, failId }) => {
    window.localStorage.setItem('colony.sceneUnavailable', '1');
    const calls: Call[] = [];
    const intents: Intent[] = [];
    const resetSubscribers: Array<() => void> = [];
    Object.assign(window, {
      __colonyActionCalls: calls,
      __colonyIntentCalls: intents,
      __colonyReset: () => resetSubscribers.forEach((callback) => callback()),
      __survivesNavigation: 'marker',
      rhythmShell: { colonyView: {
        getStatus: async () => ({ v: 1, available: true, enabled: true, sources: [] }),
        discoverSources: async () => [], setSource: async () => ({}), setEnabled: async () => ({ v: 1, available: true, enabled: true, sources: [] }),
        attach: async () => ({ ok: true }), setBounds: async () => true, detach: async () => true,
        inventoryPage: async (request: { collection?: string }) => ({ generation: 'generation-1', collection: request.collection ?? 'threads', scannedAt: 1, records: request.collection === 'threads' ? records : [], nextCursor: null }),
        inventoryCancel: async () => true, sendIntent: (intent: Intent) => { intents.push(intent); }, onEvent: () => () => {},
        onReset: (callback: () => void) => { resetSubscribers.push(callback); return () => resetSubscribers.splice(resetSubscribers.indexOf(callback), 1); },
        runAction: async (kind: string, id: string) => {
          calls.push({ kind, id });
          if (id === failId) return { ok: false, reason: 'Synthetic OS dispatch failed.' };
          if (kind === 'open' && id.startsWith('rhythm:')) return { ok: true, kind: 'rhythm-session', sessionId: 'local-session-42' };
          if (kind === 'showParent') return { ok: true, kind: 'select-thread', id: 'rhythm:parent', sessionId: 'local-parent' };
          return { ok: true, kind };
        },
      } },
    });
  }, { records: threads, failId });
}

const actionCalls = (page: Page) => page.evaluate(() => (window as Window & { __colonyActionCalls: Call[] }).__colonyActionCalls);
const intentCalls = (page: Page) => page.evaluate(() => (window as Window & { __colonyIntentCalls: Intent[] }).__colonyIntentCalls);

test('1531:inspector-actions-and-task-view-menus-ui:1 primary labels, unavailable reason, parent selection, and Colony-local archive labels', async ({ page }) => {
  // Regression caught: generic open/archive labels hide the exact destination or source-local scope.
  await mockColony(page);
  await openPage(page, '/colony');
  await page.getByTestId('rhythm:parent').click();
  await expect(page.getByRole('button', { name: 'Open in Rhythm' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Archive from Colony' })).toBeVisible();
  await page.getByTestId('opencode:worker').click();
  await page.getByRole('button', { name: 'Show parent task' }).click();
  await expect(page.getByTestId('rhythm:parent')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('hermes:no-open').click();
  await expect(page.getByRole('button', { name: /Open unavailable/i })).toBeDisabled();
  await expect(page.getByText('Hermes exact opening is not qualified.')).toBeVisible();
});

test('1531:inspector-actions-and-task-view-menus-ui:2 Open in Rhythm changes hash without reload or auth calls', async ({ page }) => {
  // Regression caught: exact open reloads/signs out or substitutes a nearby session.
  await mockColony(page);
  await openPage(page, '/colony');
  await page.getByTestId('rhythm:parent').click();
  await page.getByRole('button', { name: 'Open in Rhythm' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/agents?sessionId=local-session-42');
  expect(await page.evaluate(() => (window as Window & { __survivesNavigation?: string }).__survivesNavigation)).toBe('marker');
  expect(await actionCalls(page)).toEqual([{ kind: 'open', id: 'rhythm:parent' }]);
});

test('1531:inspector-actions-and-task-view-menus-ui:3 failed action shows only error and preserves selection', async ({ page }) => {
  // Regression caught: failed native dispatch shows success or changes the selected task.
  await mockColony(page, 'codex:exact');
  await openPage(page, '/colony');
  await page.getByTestId('codex:exact').click();
  await page.getByRole('button', { name: 'Open in Codex' }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic OS dispatch failed');
  await expect(page.getByText(/opened|copied|archived/i)).toHaveCount(0);
  await expect(page.getByTestId('codex:exact')).toHaveAttribute('aria-selected', 'true');
});

test('1531:inspector-actions-and-task-view-menus-ui:4 fallback menus stay honest and Escape restores trigger focus', async ({ page }) => {
  // Regression caught: list fallback labels look active while no scene intent can occur.
  await mockColony(page);
  await openPage(page, '/colony');
  await page.getByTestId('rhythm:parent').click();
  const view = page.getByRole('button', { name: 'View options' });
  await view.click();
  await expect(page.getByRole('menuitem', { name: 'Reset camera' })).toBeDisabled();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Reduced motion' })).toBeDisabled();
  await expect(page.getByRole('menuitemradio', { name: 'Quality: High' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: /Screenshot unavailable/i })).toBeDisabled();
  const intents = await intentCalls(page);
  expect(intents.filter(({ event }) => event === 'host.select')).toEqual([
    { event: 'host.select', payload: { threadId: 'rhythm:parent' } },
  ]);
  expect(intents.filter(({ event }) => event === 'host.view')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(view).toBeFocused();
  const task = page.getByRole('button', { name: 'Task actions' });
  await task.click();
  await expect(page.getByRole('menuitem', { name: 'Restore to Colony' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(task).toBeFocused();
});

test('1531:inspector-actions-and-task-view-menus-ui:5 fallback shortcuts never intercept editable inputs', async ({ page }) => {
  // Regression caught: fallback shortcuts archive or mark viewed while the user types in search.
  await mockColony(page);
  await openPage(page, '/colony');
  await page.getByTestId('rhythm:parent').click();
  const search = page.getByLabel('Search Bot Crossing tasks');
  await search.focus();
  await page.keyboard.type('AV');
  expect(await actionCalls(page)).toEqual([]);
  await expect(search).toHaveValue('AV');
});

test('review:apps/web/src/pages/colony/menus.tsx:20 outside click keeps the clicked control focused', async ({ page }) => {
  await mockColony(page);
  await openPage(page, '/colony');
  await page.getByRole('button', { name: 'View options' }).click();
  const search = page.getByLabel('Search Bot Crossing tasks');
  await search.click();
  await expect(search).toBeFocused();
  await expect(page.getByRole('menu', { name: 'View options' })).toHaveCount(0);
});

test('review:apps/web/src/pages/colony/index.tsx:267 action receipts stay inline and account reset clears selection', async ({ page }) => {
  await mockColony(page);
  await openPage(page, '/colony');
  await page.getByTestId('rhythm:parent').click();
  await page.getByRole('button', { name: 'Task actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark viewed' }).click();
  await expect(page.locator('.colony-action-status[role="status"]')).toContainText('Marked viewed');
  await expect(page.locator('.colony-action-toast')).toHaveCount(0);
  await page.evaluate(() => (window as Window & { __colonyReset(): void }).__colonyReset());
  await expect(page.getByTestId('rhythm:parent')).toHaveCount(0);
});
