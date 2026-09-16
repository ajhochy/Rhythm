import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Real signed-in renderer and gateways; only HTTP/auth-provider boundaries are faked.
async function openDashboard(page: Page, supplementalFailure = false, options: { permissions?: boolean; empty?: boolean; context?: boolean; contextCount?: number; focusRows?: string[]; largeQueues?: boolean; summaryFailure?: boolean; delay?: Promise<void>; writeDelay?: Promise<void>; writeFailure?: boolean; refreshFailure?: boolean; artifacts?: boolean } = {}) {
  const task = (id: string, scheduledDate: string | null, extra = {}) => ({
    id, title: `Work ${id}`, status: 'open', sourceType: 'manual', sourceId: null,
    scheduledDate, dueDate: null, notes: '', ownerId: 81, ...extra,
  });
  const overdue = Array.from({ length: 30 }, (_, i) => task(`overdue-${i}`, '2026-09-08'));
  const today = Array.from({ length: 15 }, (_, i) => task(`today-${i}`, '2026-09-09'));
  if (options.focusRows) today.splice(0, today.length, ...options.focusRows.map((sourceType, i) => task(`today-${i}`, '2026-09-09', { sourceType })));
  if (options.permissions) {
    Object.assign(today[0], { sourceType: 'calendar_shadow_event' });
    Object.assign(today[1], { sourceType: 'prod_mirror' });
    Object.assign(today[2], { ownerId: 82, isShared: true });
  }
  const deadline = task('deadline', '2026-09-10', { dueDate: '2026-09-08' });
  const waiting = task('outside-summary', '2026-10-01', { status: 'waiting_for_reply' });
  overdue[0].status = 'waiting_for_reply';
  const later = [deadline, task('step-a', '2026-09-10', { sourceType: 'project_step', sourceId: 'same-instance' }), task('step-b', '2026-09-10', { sourceType: 'project_step', sourceId: 'same-instance' })];
  const unscheduled = [task('unscheduled', null)];
  if (options.largeQueues) {
    later.push(...Array.from({ length: 3 }, (_, i) => task(`later-extra-${i}`, '2026-09-10')));
    unscheduled.push(...Array.from({ length: 4 }, (_, i) => task(`unscheduled-extra-${i}`, null)));
  }
  const all = options.empty ? [] : [...overdue, ...today, ...later, ...unscheduled, waiting];
  const contextSteps = Array.from({ length: options.contextCount ?? 5 }, (_, i) => ({ id: `context-${i}`, title: `Context step ${i}`, status: 'open', notes: '', dueDate: '2026-09-10', assigneeName: 'Riley' }));
  if (options.empty) { overdue.length = 0; today.length = 0; later.length = 0; unscheduled.length = 0; }
  const writes: Array<{ path: string; body: unknown }> = [];
  await page.clock.setFixedTime(new Date('2026-09-09T12:00:00-07:00'));
  await page.addInitScript((artifacts) => {
    Object.defineProperty(window, 'rhythmShell', { value: {
      version: 8,
      gateway: { apiBase: 'http://127.0.0.1:4287', engineBase: 'http://127.0.0.1:4288', productionApiBase: 'https://design-fixture.invalid' },
      auth: { signInWithGoogle: async () => ({ sessionToken: 'synthetic-dashboard-only', user: { id: 81, name: 'Dashboard Owner', email: 'dashboard@example.test', role: 'admin', artifactTabIds: artifacts ? ['00000000-0000-4000-8000-000000000801'] : [] } }) },
    } });
  }, options.artifacts);
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4286') return route.continue();
    if (!['http://127.0.0.1:4287', 'http://127.0.0.1:4288', 'https://design-fixture.invalid'].includes(url.origin)) return route.abort();
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4286', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': 'authorization,content-type' };
    const json = (value: unknown, status = 200) => route.fulfill({ status, headers, json: value });
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      writes.push({ path: url.pathname, body });
      if (options.writeDelay) await options.writeDelay;
      if (options.writeFailure) return json({ error: 'write failed' }, 503);
      if (url.pathname === '/users/me/preferences') return json({ id: 81, ...body });
      const item = [...all, ...contextSteps].find(item => item.id === url.pathname.split('/').at(-1));
      if (item) Object.assign(item, body);
      return json(item ?? {});
    }
    if (url.pathname.startsWith('/live-artifacts/')) {
      if (url.pathname.endsWith('/render')) return route.fulfill({ headers, contentType: 'text/html', body: '<!doctype html><input aria-label="Artifact draft" value="Original"><p>Owned artifact</p>' });
      return json({ id: '00000000-0000-4000-8000-000000000801', type: 'html', title: 'Owned artifact', ownerUserId: 81, workspaceId: 8, visibility: 'private', declaredCapabilities: [], currentBundleRevision: 1, currentStateRevision: 1, updatedAt: '2026-09-09T12:00:00Z', state: {} });
    }
    const open = (items: typeof all) => options.empty ? [] : items.filter(item => item.status !== 'done');
    if (url.pathname === '/dashboard/summary') {
      if (options.delay) await options.delay;
      if (options.summaryFailure || (options.refreshFailure && writes.length)) return json({ error: 'summary failed' }, 503);
      return json({
      tasks: { openCount: open(all).length, pastDueCount: open(overdue).length, pastDeadlineCount: open([deadline]).length,
        pastDeadlineTasks: open([deadline]), todayRemainingCount: open(today).length, todayTotalCount: today.length,
        thisWeekRemainingCount: open(later).length, thisWeekTotalCount: later.length, unscheduledCount: open(unscheduled).length,
        recent: today.slice(0, 5), pastDue: open(overdue), today: open(today), thisWeek: open([...today, ...later]), unscheduled: open(unscheduled) },
       projects: { activeCount: options.context ? 1 : 0, items: options.context ? [{ id: 'project', title: 'Sunday service', ownerId: 81, onDeckSteps: contextSteps.filter(step => step.status !== 'done') }] : [] },
      rhythms: { activeCount: 0, items: [] }, goals: { activeCount: 0, items: [] }, messages: { threadCount: options.context ? 5 : 0, unreadPreviews: options.context ? Array.from({ length: 5 }, (_, i) => ({ threadId: i + 1, threadTitle: `Message ${i}`, senderName: 'Riley', preview: 'Context', unreadCount: 1 })) : [] },
    }); }
    if (url.pathname === '/tasks') return json(supplementalFailure ? { error: 'unavailable' } : all, supplementalFailure ? 503 : 200);
    if (url.pathname === '/weekly-plan') return json({ weekLabel: '2026-W37', weekStart: '2026-09-07', days: [], backlog: [] });
    if (url.pathname === '/health') return json({ healthy: true });
    return json([]);
  });
  await page.goto('/#/dashboard');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByTestId('page-dashboard')).toBeVisible();
  return writes;
}

test('dashboard-c1: signed-in work-first geometry, local date and quiet artifact chrome', async ({ page }) => {
  // Catches redesign wired only into the fixture, or a hero pushing real work below the fold.
  await openDashboard(page);
  await expect(page.locator('.live-artifact-shell')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.dashboard-heading')).toContainText('Sep 9');
  await expect(page.locator('.dashboard-heading')).not.toContainText('Planning workspace');
  await expect(page.locator('.dashboard-toolbar').getByRole('button', { name: 'Open planner', exact: true })).toBeVisible();
  await expect(page.getByTestId('dashboard-header-add-task')).toBeEnabled();
  await expect(page.locator('.pg-dashboard .focus-shell, .pg-dashboard .progress-card')).toHaveCount(0);
  expect((await page.locator('.dashboard-toolbar').boundingBox())!.height).toBeLessThanOrEqual(64);
  await expect(page.getByTestId('dashboard-work')).toBeVisible();
  const pane = await page.getByTestId('page-dashboard').boundingBox();
  const rows = await page.getByTestId('dashboard-work').locator('[data-task-key]').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom };
  }));
  expect(rows[0].top - pane!.y).toBeLessThanOrEqual(220);
  expect(rows.filter(r => r.top >= 0 && r.bottom <= 900).length).toBeGreaterThanOrEqual(8);
  expect((await page.locator('.artifact-tablist-row').boundingBox())!.height).toBeLessThanOrEqual(44);
  expect((await page.getByTestId('dashboard-counts').boundingBox())!.height).toBeLessThanOrEqual(44);
  const work = (await page.getByTestId('dashboard-work').boundingBox())!;
  const context = (await page.locator('.dashboard-context').boundingBox())!;
  expect(context.width).toBeGreaterThanOrEqual(320);
  expect(context.width).toBeLessThanOrEqual(360);
  expect(context.x).toBeGreaterThan(work.x + work.width);
  await test.info().attach('dashboard-layout', { body: JSON.stringify({ pane, work, context, firstRowOffset: rows[0].top - pane!.y, fullyVisibleRows: rows.filter(r => r.top >= 0 && r.bottom <= 900).length }), contentType: 'application/json' });
  await page.screenshot({ path: test.info().outputPath('dashboard-auth-1440.png') });
});

test('dashboard-c2: exact linked counts, disjoint allocation and complete waiting beyond summary', async ({ page }) => {
  // Catches recent[5] masquerading as all waiting and duplicate same-instance steps.
  await openDashboard(page);
  const counts = page.getByTestId('dashboard-counts');
  for (const [queue, count] of [['planning-past-due', 5], ['planning-today', 6], ['planning-week', 2], ['planning-unscheduled', 1]] as const) {
    await expect(page.getByTestId(queue).locator('[data-task-key]')).toHaveCount(count);
  }
  for (const label of ['Overdue 30', 'Today 15', 'Waiting 2', 'Unscheduled 1']) await expect(counts.getByRole('button', { name: label, exact: true })).toBeVisible();
  await counts.getByRole('button', { name: 'Waiting 2', exact: true }).click();
  await expect(page.getByTestId('planning-past-due').getByRole('heading')).toBeFocused();
  await page.getByTestId('planning-past-due').getByRole('button', { name: 'Show all 32', exact: true }).click();
  await expect(page.getByTestId('task-row-deadline')).toContainText('Past deadline');
  await expect(page.getByTestId('task-row-outside-summary')).toContainText('Waiting for reply');
  await expect(page.getByTestId('task-row-overdue-0')).toContainText('Overdue');
  await expect(page.getByTestId('task-row-overdue-0')).toContainText('Waiting for reply');
  const keys = await page.getByTestId('dashboard-work').locator('[data-task-key]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-task-key')));
  expect(new Set(keys).size).toBe(keys.length);
  await expect(page.getByTestId('task-row-step-a')).toHaveCount(1);
  await expect(page.getByTestId('task-row-step-b')).toHaveCount(1);
});

test('dashboard-c3: supplemental failure cannot erase summary or publish false waiting zero', async ({ page }) => {
  await openDashboard(page, true);
  await expect(page.getByTestId('task-row-overdue-0')).toBeVisible();
  await expect(page.getByTestId('dashboard-counts')).not.toContainText('Waiting 0');
  await expect(page.getByText('Waiting tasks unavailable', { exact: false })).toBeVisible();
  await expect(page.getByTestId('dashboard-work')).toBeVisible();
});

test('dashboard-c4: status-only canonical writes and inspector Reopen preserve unsaved notes', async ({ page }) => {
  const writes = await openDashboard(page);
  await page.getByTestId('task-row-today-0').click();
  await page.getByTestId('task-inspector-notes').fill('Unsaved local note');
  const complete = page.getByTestId('task-detail-complete');
  await expect(complete).toBeInViewport({ ratio: 1 });
  await complete.click();
  await expect(complete).toHaveText('Reopen task');
  await expect(page.getByTestId('task-inspector-notes')).toHaveValue('Unsaved local note');
  expect(writes).toEqual([{ path: '/tasks/today-0', body: { status: 'done' } }]);
  await complete.click();
  await expect(complete).toHaveText('Complete task');
  expect(writes.at(-1)).toEqual({ path: '/tasks/today-0', body: { status: 'open' } });
  await page.keyboard.press('Escape');
  await page.getByTestId('task-toggle-step-a').click();
  expect(writes.at(-1)).toEqual({ path: '/project-instances/steps/step-a', body: { status: 'done' } });
});

test('dashboard-c6: readonly source cannot write; shared non-owner can complete but cannot manage people', async ({ page }) => {
  const writes = await openDashboard(page, false, { permissions: true });
  for (const id of ['today-0', 'today-1']) {
    await expect(page.getByTestId(`task-toggle-${id}`)).toBeDisabled();
    await expect(page.getByTestId(`task-row-${id}`)).toContainText('Read only');
  }
  await page.getByTestId('planning-today').getByTestId('task-row-today-2').click();
  await expect(page.getByTestId('task-inspector-collaborator-add')).toBeDisabled();
  await page.getByTestId('task-detail-complete').click();
  await expect(page.getByTestId('task-detail-complete')).toHaveText('Reopen task');
  expect(writes).toEqual([{ path: '/tasks/today-2', body: { status: 'done' } }]);
});

test('dashboard-c7: failed status preserves queue, draft and focused action; retry writes only once', async ({ page }) => {
  const options = { writeFailure: true, context: true };
  const writes = await openDashboard(page, false, options);
  await page.getByTestId('planning-today').getByTestId('task-row-today-0').click();
  await page.getByTestId('task-inspector-notes').fill('Keep on failure');
  await page.getByTestId('task-detail-complete').click();
  await expect(page.getByTestId('task-inspector')).toContainText('failed');
  await expect(page.getByTestId('task-detail-complete')).toBeFocused();
  await expect(page.getByTestId('task-inspector-notes')).toHaveValue('Keep on failure');
  await expect(page.getByTestId('dashboard-work')).toBeVisible();
  options.writeFailure = false;
  await page.getByTestId('task-detail-complete').click();
  await expect(page.getByTestId('task-detail-complete')).toHaveText('Reopen task');
  expect(writes).toEqual(Array(2).fill({ path: '/tasks/today-0', body: { status: 'done' } }));
  await page.keyboard.press('Escape');
  await page.getByTestId('project-step-row-context-0').click();
  const stepDialog = page.getByTestId('dashboard-project-step-dialog');
  await stepDialog.getByLabel('Notes').fill('Keep step draft');
  options.writeFailure = true;
  await page.getByTestId('project-step-detail-complete').click();
  await expect(stepDialog).toContainText('failed');
  await expect(page.getByTestId('project-step-detail-complete')).toBeFocused();
  options.writeFailure = false;
  await stepDialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('project-step-detail-complete')).toHaveText('Reopen step');
  await expect(stepDialog.getByLabel('Notes')).toHaveValue('Keep step draft');
  expect(writes.slice(2)).toEqual(Array(2).fill({ path: '/project-instances/steps/context-0', body: { status: 'done' } }));
});

test('dashboard-c8: committed status survives failed refresh and Retry never replays PATCH', async ({ page }) => {
  const options = { refreshFailure: true };
  const writes = await openDashboard(page, false, options);
  await page.getByTestId('planning-today').getByTestId('task-row-today-0').click();
  await page.getByTestId('task-inspector-notes').fill('Still unsaved');
  await page.getByTestId('task-detail-complete').click();
  await expect(page.getByTestId('task-detail-complete')).toHaveText('Reopen task');
  await expect(page.getByTestId('task-inspector')).toContainText('refresh');
  options.refreshFailure = false;
  await page.getByTestId('task-inspector').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('task-inspector-notes')).toHaveValue('Still unsaved');
  await expect(page.getByTestId('task-row-today-0')).toHaveCount(0);
  expect(writes).toEqual([{ path: '/tasks/today-0', body: { status: 'done' } }]);
});

test('dashboard-c9: pending status blocks repeated intent without permission lies', async ({ page }) => {
  let release!: () => void;
  const writeDelay = new Promise<void>(resolve => { release = resolve; });
  const writes = await openDashboard(page, false, { writeDelay });
  await page.getByTestId('planning-today').getByTestId('task-row-today-0').click();
  await page.getByTestId('task-detail-complete').click();
  await expect(page.getByTestId('task-detail-complete')).toBeDisabled();
  await expect(page.getByTestId('task-detail-complete')).toContainText('Completing');
  expect(writes).toHaveLength(1);
  release();
  await expect(page.getByTestId('task-detail-complete')).toHaveText('Reopen task');
});

test('dashboard-c10: context is secondary, capped, truthful, and no redundant project read', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await openDashboard(page, false, { context: true });
  await expect(page.getByTestId('planning-project-steps').locator('.task-entry')).toHaveCount(3);
  await expect(page.getByTestId('planning-project-steps')).toContainText('Sunday service');
  await expect(page.getByTestId('planning-project-steps')).toContainText('Riley');
  await expect(page.locator('[data-testid^="unread-preview-thread-"]')).toHaveCount(3);
  const actions = page.getByTestId('dashboard-agent-actions');
  await expect(actions).not.toHaveAttribute('open', '');
  await actions.getByText('Agent actions', { exact: true }).click();
  await expect(actions).toContainText('Work today-0');
  await expect(actions.locator('[data-testid^="quick-action-"]')).toHaveCount(4);
  await expect(page.getByTestId('dashboard-goals')).not.toHaveAttribute('open', '');
  expect(requests).not.toContain('/project-instances');
  await expect(page.getByTestId('page-trace')).toHaveCount(0);
});

test('dashboard-c11: empty still allows creation and explicitly unbound agent actions', async ({ page }) => {
  await openDashboard(page, false, { empty: true });
  await expect(page.getByTestId('dashboard-header-add-task')).toBeEnabled();
  await page.getByTestId('dashboard-agent-actions').getByText('Agent actions', { exact: true }).click();
  await expect(page.getByTestId('dashboard-agent-actions')).toContainText('No task selected');
  await expect(page.getByTestId('dashboard-agent-actions')).toContainText('unbound');
});

test('dashboard-c12: loading and summary failure never publish false zero counts', async ({ page }) => {
  let release!: () => void;
  const delay = new Promise<void>(resolve => { release = resolve; });
  await openDashboard(page, false, { delay, summaryFailure: true });
  await expect(page.getByTestId('dashboard-counts')).not.toContainText('Overdue 0');
  release();
  await expect(page.getByTestId('page-state-server-error')).toBeVisible();
  await expect(page.getByTestId('dashboard-counts')).not.toContainText('Overdue 0');
});

test('dashboard-c13: artifact and Dashboard keep DOM identity and drafts; return refresh consumes external change', async ({ page }) => {
  await openDashboard(page, false, { artifacts: true });
  const pane = page.getByTestId('page-dashboard');
  await pane.evaluate(node => { node.setAttribute('data-mount-proof', 'original'); });
  const artifact = page.getByRole('tab', { name: 'Owned artifact', exact: true });
  await artifact.click();
  const frame = page.getByTestId('live-artifact-frame').contentFrame();
  await frame.getByLabel('Artifact draft').fill('Keep artifact draft');
  await page.evaluate(async () => { await fetch('https://design-fixture.invalid/tasks/today-0', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done' }) }); });
  await page.getByRole('tab', { name: 'Dashboard', exact: true }).click();
  await expect(pane).toHaveAttribute('data-mount-proof', 'original');
  await expect(page.getByTestId('task-row-today-0')).toHaveCount(0);
  await artifact.click();
  await expect(frame.getByLabel('Artifact draft')).toHaveValue('Keep artifact draft');
  await artifact.press('Delete');
  await expect(page.getByRole('tab', { name: 'Dashboard', exact: true })).toBeFocused();
  await page.evaluate(() => { window.location.hash = '/planner'; });
  await expect(page.getByTestId('page-planner')).toBeVisible();
  await page.evaluate(async () => { await fetch('https://design-fixture.invalid/tasks/today-1', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done' }) }); });
  await page.evaluate(() => { window.location.hash = '/dashboard'; });
  await expect(pane).toHaveAttribute('data-mount-proof', 'original');
  await expect(page.getByTestId('task-row-today-1')).toHaveCount(0);
});

test('dashboard-c5: narrow first work, keyboard targets and accessible zoomed surface', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  const complete = page.getByTestId('task-toggle-overdue-0');
  await expect(complete).toBeInViewport({ ratio: 1 });
  const box = await complete.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await complete.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dashboard-auth-390.png') });
  await complete.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('task-row-overdue-0')).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include('.live-artifact-shell').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('dashboard-repair-focus-singleton: Space completion focuses the empty context heading, not body', async ({ page }) => {
  const writes = await openDashboard(page, false, { context: true, contextCount: 1 });
  const section = page.getByTestId('planning-project-steps');
  await expect(section.locator('.task-entry')).toHaveCount(1);
  await section.locator('.task-toggle').focus();
  await page.keyboard.press('Space');
  await expect(section.locator('.task-entry')).toHaveCount(0);
  await expect(section.getByRole('heading')).toBeFocused();
  expect(writes).toEqual([{ path: '/project-instances/steps/context-0', body: { status: 'done' } }]);
});

for (const scenario of [
  { name: 'next', sources: ['manual', 'calendar_shadow_event', 'prod_mirror', 'manual'], complete: 0, target: 3 },
  { name: 'previous', sources: ['manual', 'calendar_shadow_event', 'manual', 'prod_mirror'], complete: 2, target: 0 },
  { name: 'heading', sources: ['calendar_shadow_event', 'manual', 'prod_mirror'], complete: 1, target: null },
]) test(`dashboard-repair-focus-${scenario.name}: skip disabled neighbors after completion`, async ({ page }) => {
  await openDashboard(page, false, { focusRows: scenario.sources });
  const section = page.getByTestId('planning-today');
  for (const [i, source] of scenario.sources.entries()) {
    if (source !== 'manual') await expect(page.getByTestId(`task-toggle-today-${i}`)).toBeDisabled();
  }
  await page.getByTestId(`task-toggle-today-${scenario.complete}`).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId(`task-row-today-${scenario.complete}`)).toHaveCount(0);
  await expect(scenario.target === null ? section.getByRole('heading') : page.getByTestId(`task-toggle-today-${scenario.target}`)).toBeFocused();
});

test('dashboard-repair-focus-failure: failed row completion retains original enabled trigger', async ({ page }) => {
  const writes = await openDashboard(page, false, { writeFailure: true });
  const trigger = page.getByTestId('task-toggle-today-0');
  await trigger.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('dashboard-mutation-error')).toContainText('failed');
  await expect(trigger).toBeEnabled();
  await expect(trigger).toBeFocused();
  expect(writes).toEqual([{ path: '/tasks/today-0', body: { status: 'done' } }]);
});

test('dashboard-repair-counts: capped headers distinguish shown rows from totals before and after expansion', async ({ page }) => {
  await openDashboard(page, false, { largeQueues: true });
  for (const [id, cap, total] of [['planning-past-due', 5, 32], ['planning-today', 6, 15], ['planning-week', 3, 5], ['planning-unscheduled', 3, 5]] as const) {
    const section = page.getByTestId(id);
    await expect(section.locator('[data-task-key]')).toHaveCount(cap);
    await expect(section.locator('.list-head')).toContainText(`${cap} of ${total} shown`);
    await section.getByRole('button', { name: `Show all ${total}`, exact: true }).click();
    await expect(section.locator('[data-task-key]')).toHaveCount(total);
    await expect(section.locator('.list-head')).toContainText(`${total} of ${total} shown`);
    await section.getByRole('button', { name: 'Show fewer', exact: true }).click();
    await expect(section.locator('[data-task-key]')).toHaveCount(cap);
    await expect(section.locator('.list-head')).toContainText(`${cap} of ${total} shown`);
  }
});

test('dashboard-evidence-contract: c7 maps to its signed-in executable proof and c12 is honestly manual', () => {
  // Regression: evidence can appear green while c7 points elsewhere or c12 has no executable/manual disposition.
  const contract = JSON.parse(readFileSync(resolve(webRoot, '../../docs/ai/contracts/manual-smoke-daily-work-dashboard-20260912.json'), 'utf8'));
  const criterion = (id: string) => contract.criteria.find((row: { criterion_id: string }) => row.criterion_id === id);
  expect(criterion('dashboard-c7').test).toBe('apps/web/tests/contract/daily-work-dashboard-20260912.spec.ts');
  expect(criterion('dashboard-c12')).toMatchObject({ mode: 'manual', test: null, status: 'UNVERIFIED' });
  expect(contract.not_tested).toContain('dashboard-c12');
});

test('dashboard-evidence-live-config: runner and live spec bind assigned API, engine and gateway bases', () => {
  // Regression: a green command silently targets a retired sandbox instead of assigned ports.
  const runner = readFileSync(resolve(webRoot, 'tests/dashboard-daily-work-runner.mjs'), 'utf8');
  const liveSpec = readFileSync(resolve(webRoot, 'tests/contract/daily-work-dashboard-live-20260912.spec.ts'), 'utf8');
  for (const name of ['RHYTHM_LIVE_API_URL', 'RHYTHM_LIVE_ENGINE_URL', 'RHYTHM_LIVE_GATEWAY_URL']) {
    expect(runner).toContain(name);
    expect(liveSpec).toContain(name);
  }
  expect(`${runner}\n${liveSpec}`).not.toMatch(/127\.0\.0\.1:629[789]/);
});
