import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

async function expectNoOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(widths.scroll, JSON.stringify(widths)).toBeLessThanOrEqual(widths.client + 1);
}

test('Dashboard distributes the dense task week across its planning queues', async ({ page }) => {
  await openPage(page, '/dashboard');

  await expect(page.getByTestId('planning-past-due').locator('[data-testid^="task-row-density-"]')).toHaveCount(30);
  await expect(page.getByTestId('planning-today').locator('[data-testid^="task-row-density-"]')).toHaveCount(15);
  await expect(page.getByTestId('planning-week').locator('[data-testid^="task-row-density-"]')).toHaveCount(60);
  await expect(page.getByTestId('planning-handoffs')).toContainText('Wednesday: Confirm room access plan');
});

test('Dashboard click-through covers refresh, capture, inspectors, completion, handoff, and shortcuts', async ({ page }) => {
  await openPage(page, '/dashboard');
  await expect(page.getByTestId('page-trace')).toContainText('GET /dashboard/summary → 200');

  await page.getByTestId('dashboard-refresh').click();
  await expect(page.getByTestId('page-state-loading')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Focus for this week' })).toBeVisible();

  await page.getByTestId('dashboard-header-add-task').click();
  await page.getByTestId('task-title').fill('Confirm interpretation handoff 🌏');
  await page.getByTestId('task-notes').fill('Review the long CJK and RTL copy.');
  await page.getByTestId('task-schedule').fill('2026-08-12');
  await page.getByTestId('task-due-date').fill('2026-08-13');
  await page.getByTestId('task-collaborator').selectOption('workspace-user-2');
  await page.getByTestId('task-add').click();
  await expect(page.getByTestId('planning-today')).toContainText('Confirm interpretation handoff 🌏');
  await expect(page.getByTestId('page-trace')).toContainText('POST /tasks {title,notes,scheduledDate,dueDate} → 201');

  const taskRow = page.getByTestId('task-row-team-briefing');
  await taskRow.focus();
  await taskRow.click();
  await expect(page.getByTestId('task-inspector-title')).toBeFocused();
  await page.getByTestId('task-inspector-notes').fill('Owner confirmed for the final briefing.');
  await page.getByTestId('task-inspector-save').click();
  await expect(page.getByTestId('page-trace')).toContainText('PATCH /tasks/task-team-briefing {title,notes,dueDate,scheduledDate,preferredAgent,energy} → 200');

  await page.getByTestId('task-toggle-team-briefing').click();
  await expect(taskRow).toHaveAttribute('data-status', 'done');
  await page.getByTestId('project-step-toggle-volunteer-check-in').click();
  await expect(page.getByTestId('project-step-row-volunteer-check-in')).toHaveAttribute('data-status', 'done');

  await page.getByTestId('quick-action-draft-next-steps').click();
  await expect(page.getByTestId('quick-action-handoff')).toContainText('Local preview · no request sent');
  await expect(page.getByTestId('page-trace')).not.toContainText('agent-sessions');

  await page.getByTestId('open-projects').click();
  await expect(page).toHaveURL(/#\/projects$/);
  await openPage(page, '/dashboard');
  await page.getByTestId('unread-preview-thread-weekend-team').click();
  await expect(page).toHaveURL(/#\/messages\/thread-weekend-team$/);
});

for (const state of ['ready', 'server-error', 'readonly'] as const) {
  test(`Dashboard ${state} representative state has no serious or critical axe violations`, async ({ page }) => {
    await openPage(page, '/dashboard', state === 'ready' ? '' : `?state=${state}`);
    await expect(page.getByTestId(state === 'ready' ? 'page-dashboard' : `page-state-${state}`)).toBeVisible();
    const result = await new AxeBuilder({ page }).exclude('.traffic-lights').analyze();
    const blocking = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''));
    expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
  });
}

for (const viewport of [
  { width: 1024, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Dashboard remains usable without horizontal overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openPage(page, '/dashboard');
    await expectNoOverflow(page);
    await expect(page.getByText('跟进供应商')).toBeVisible();
    await page.getByTestId('dashboard-header-add-task').click();
    await expect(page.getByTestId('task-add')).toBeVisible();
    await page.keyboard.press('Escape');

    const undersized = await page.locator('.pg-dashboard button:visible, .pg-dashboard input:visible, .pg-dashboard select:visible, .pg-dashboard textarea:visible').evaluateAll((controls) => controls.flatMap((element) => {
      const control = element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const rect = control.getBoundingClientRect();
      if (control.disabled || rect.width === 0 || rect.height === 0) return [];
      return rect.width < 44 || rect.height < 44 ? [{ label: control.dataset.testid ?? control.getAttribute('aria-label') ?? control.tagName, width: rect.width, height: rect.height }] : [];
    }));
    expect(undersized).toEqual([]);
  });
}

test('Dashboard survives 200% text, RTL, forced colors, and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, '/dashboard');
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.style.fontSize = '200%'; });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.getByTestId('dashboard-header-add-task').click();
  await expect(page.getByTestId('task-title')).toBeVisible();
  await expectNoOverflow(page);
});
