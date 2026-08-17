import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openPage } from '../helpers';

test('issue-2001-c1: dashboard route renders the real page contract in the selected shell', async ({ page }) => {
  // Regression caught: #/dashboard falls through to ModulePlaceholder or the shell selects the wrong destination.
  await openPage(page, '/dashboard');
  const dashboard = page.getByTestId('page-dashboard');
  await expect(dashboard).toBeVisible();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Dashboard', exact: true })).toHaveCount(1);
  await expect(page.getByTestId('nav-dashboard')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('module-placeholder')).toHaveCount(0);
});

test('issue-2001-c2: ready composition and fixture values cover focus planning unread and empties', async ({ page }) => {
  // Regression caught: a summary adapter renders generic cards while dropping Flutter's progress, planning, unread, or empty sections.
  await openPage(page, '/dashboard');
  const dashboard = page.getByTestId('page-dashboard');
  await expect(dashboard.getByRole('heading', { name: 'Focus for this week' })).toBeVisible();
  await expect(page.getByTestId('dashboard-open-count')).toHaveText('110 open');
  await expect(page.getByTestId('dashboard-thread-count')).toHaveText('6 threads');
  await expect(page.getByTestId('today-progress')).toContainText(/1\/17|6%/);
  await expect(page.getByTestId('week-progress')).toContainText(/2\/4|50%/);
  await expect(page.getByTestId('project-progress-weekend-service')).toContainText(/3\/4|75%/);
  await expect(page.getByTestId('planning-past-due')).toContainText('Review AV inventory');
  await expect(page.getByTestId('planning-handoffs')).toContainText('Team briefing ✅');
  await expect(page.getByTestId('planning-today')).toContainText('Team briefing ✅');
  await expect(page.getByTestId('planning-week')).toContainText('Finalize launch notes 📝');
  await expect(page.getByTestId('planning-unscheduled')).toContainText('跟进供应商');
  await expect(page.getByTestId('unread-preview-thread-weekend-team')).toContainText(/Weekend team|6 unread/);
});

test('issue-2001-c3: refresh and deterministic state matrix recover without reload', async ({ page }) => {
  // Regression caught: Refresh skips visible loading, Retry reloads the app, or a required query state falls back to ready content.
  await openPage(page, '/dashboard');
  await page.getByTestId('dashboard-refresh').click();
  await expect(page.getByTestId('page-state-loading')).toBeVisible();
  await expect(page.getByTestId('page-dashboard')).toContainText('Focus for this week');
  await expect(page.getByTestId('page-trace')).toContainText('GET /dashboard/summary → 200');
  await expect(page.getByTestId('page-trace')).toContainText('GET /project-instances → 200');

  for (const state of ['loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly']) {
    await openPage(page, '/dashboard', `?state=${state}`);
    await expect(page.getByTestId(`page-state-${state}`)).toBeVisible();
  }
  await expect(page.getByTestId('page-state-readonly')).toContainText(/permission|read-only/i);
  await expect(page.getByTestId('dashboard-mutations')).toBeDisabled();

  await openPage(page, '/dashboard', '?state=empty');
  await page.getByTestId('dashboard-empty-primary').click();
  await expect(page.getByTestId('task-title')).toBeFocused();

  await openPage(page, '/dashboard', '?state=server-error');
  const before = await page.evaluate(() => performance.getEntriesByType('navigation').length);
  await page.getByTestId('page-retry').click();
  await expect(page.getByTestId('page-dashboard')).toContainText('Focus for this week');
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(before);
  await expect(page).toHaveURL(/#\/dashboard\?state=ready$/);
});

test('issue-2001-c4: every enabled Dashboard control has an outcome and dialogs restore focus', async ({ page }) => {
  // Regression caught: a visible row/button is inert, lacks a stable selector, or closing its inspector loses keyboard focus.
  await openPage(page, '/dashboard');
  const dashboard = page.getByTestId('page-dashboard');
  const enabled = dashboard.locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
  expect(await enabled.count()).toBeGreaterThan(8);
  expect(await enabled.evaluateAll((controls) => controls.filter((control) => !(control as HTMLElement).dataset.testid).length)).toBe(0);

  const row = page.getByTestId('task-row-team-briefing');
  await row.focus();
  await row.click();
  await expect(page.getByTestId('task-inspector')).toBeVisible();
  await expect(page.getByLabel('Task title')).toHaveValue('Team briefing ✅');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-inspector')).toHaveCount(0);
  await expect(row).toBeFocused();
});

test('issue-2001-c5: add task validates and applies scheduling and collaborator selections', async ({ page }) => {
  // Regression caught: Add task accepts whitespace, drops schedule/collaborator data, or changes a card without exact POST receipts.
  await openPage(page, '/dashboard');
  await page.getByTestId('dashboard-header-add-task').click();
  await page.getByTestId('task-title').fill('   ');
  await page.getByTestId('task-add').click();
  await expect(page.getByTestId('task-title')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('task-title-error')).toHaveText('Enter a task title.');
  await expect(page.getByTestId('task-title')).toBeFocused();

  await page.getByTestId('task-title').fill('Confirm translation handoff 🌏');
  await page.getByTestId('task-notes').fill('Coordinate the final CJK copy review.');
  await page.getByTestId('task-schedule').fill('2026-08-12');
  await page.getByTestId('task-collaborator').selectOption('workspace-user-2');
  await page.getByTestId('task-add').click();

  await expect(page.getByTestId('planning-today')).toContainText('Confirm translation handoff 🌏');
  await expect(page.getByTestId('dashboard-open-count')).toHaveText('111 open');
  await expect(page.getByTestId('page-trace')).toContainText('POST /tasks {title,notes,scheduledDate} → 201');
  await expect(page.getByTestId('page-trace')).toContainText('POST /tasks/task-dashboard-new/collaborators {userId} → 201');
});

test('issue-2001-c6: task completion updates the row and summary with the exact PATCH receipt', async ({ page }) => {
  // Regression caught: completing a task toggles the wrong duplicate row, leaves progress stale, or records the wrong task endpoint.
  await openPage(page, '/dashboard');
  await page.getByTestId('task-toggle-team-briefing').click();
  await expect(page.getByTestId('task-row-team-briefing')).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('today-progress')).toContainText(/2\/17|12%/);
  await expect(page.getByTestId('dashboard-open-count')).toHaveText('109 open');
  await expect(page.getByTestId('page-trace')).toContainText('PATCH /tasks/task-team-briefing {status:"done"} → 200');
});

test('issue-2001-c7: project-step completion updates only its project and summary', async ({ page }) => {
  // Regression caught: a project-step checkbox mutates a similarly named task or sends PATCH to /tasks instead of the project-step route.
  await openPage(page, '/dashboard');
  await page.getByTestId('project-step-toggle-volunteer-check-in').click();
  await expect(page.getByTestId('project-step-row-volunteer-check-in')).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('project-progress-weekend-service')).toContainText(/4\/4|100%/);
  await expect(page.getByTestId('task-row-team-briefing')).toHaveAttribute('data-status', 'open');
  await expect(page.getByTestId('page-trace')).toContainText('PATCH /project-instances/steps/step-volunteer-check-in {status:"done"} → 200');
});

test('issue-2001-c8: Planner Projects Messages and thread shortcuts use exact routes', async ({ page }) => {
  // Regression caught: Dashboard shortcuts stop at a toast, use Flutter labels as invalid paths, or lose the selected thread slug.
  await openPage(page, '/dashboard');
  await page.getByTestId('open-planner').click();
  await expect(page).toHaveURL(/#\/planner$/);

  await openPage(page, '/dashboard');
  await page.getByTestId('open-projects').click();
  await expect(page).toHaveURL(/#\/projects$/);

  await openPage(page, '/dashboard');
  await page.getByTestId('open-messages').click();
  await expect(page).toHaveURL(/#\/messages$/);

  await openPage(page, '/dashboard');
  await page.getByTestId('unread-preview-thread-weekend-team').click();
  await expect(page).toHaveURL(/#\/messages\/thread-weekend-team$/);
});

test('issue-2001-c9: quick actions expose one explicit client-side handoff at a time', async ({ page }) => {
  // Regression caught: Quick Action only raises a toast, allows concurrent selections, or fabricates a production endpoint receipt.
  await openPage(page, '/dashboard');
  const help = page.getByTestId('quick-action-help-finish');
  await help.click();
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('quick-action-draft-next-steps')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('quick-action-handoff')).toContainText('Help me finish this');
  await expect(page.getByTestId('quick-action-handoff')).toContainText('Team briefing ✅');
  await expect(page.getByTestId('quick-action-handoff')).toContainText('Local preview · no request sent');
  await expect(page.getByTestId('page-trace')).not.toContainText(/agent-sessions|quick-action/i);

  await page.getByTestId('quick-action-summarize').click();
  await expect(help).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('quick-action-summarize')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('quick-action-handoff')).toContainText('Summarize');
});

test('issue-2001-c10: ready Dashboard has no serious or critical axe violations', async ({ page }) => {
  // Regression caught: the dense Dashboard ships unlabeled controls, broken landmarks, or contrast/ARIA defects hidden by visual review.
  await openPage(page, '/dashboard');
  await expect(page.getByTestId('page-dashboard')).toBeVisible();
  const result = await new AxeBuilder({ page }).exclude('.traffic-lights').analyze();
  expect(result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
});

test('issue-2001-c11: Dashboard is responsive under narrow and edge-case presentation modes', async ({ page }) => {
  // Regression caught: progress/planning grids create page overflow at a supported width or edge-case text/presentation mode.
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await openPage(page, '/dashboard');
    await expect(page.getByTestId('page-dashboard')).toContainText('跟进供应商');
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.client + 1);
  }

  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.style.fontSize = '200%';
  });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await expect(page.getByTestId('page-dashboard')).toBeVisible();
  const edgeOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(edgeOverflow.scroll, JSON.stringify(edgeOverflow)).toBeLessThanOrEqual(edgeOverflow.client + 1);
});

test('issue-2001-c12: fixture data is reload-stable and network-isolated', async ({ page }) => {
  // Regression caught: Dashboard calls production during fixture mode or seeds timestamps/IDs randomly so reload changes the visible result.
  const nonLoopback: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') nonLoopback.push(request.url());
  });
  await openPage(page, '/dashboard');
  const before = await page.getByTestId('page-dashboard').innerText();
  await page.reload();
  await expect(page.getByTestId('page-dashboard')).toBeVisible();
  const after = await page.getByTestId('page-dashboard').innerText();
  expect(after).toBe(before);
  expect(nonLoopback).toEqual([]);
  await expect(page.getByTestId('page-trace')).toContainText('GET /dashboard/summary → 200');
});
