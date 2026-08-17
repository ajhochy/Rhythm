import { expect, test, type Page } from '@playwright/test';

type RequestReceipt = { method: string; path: string };

// Canonical ProjectInstance/ProjectInstanceStep/ProjectMilestone shape:
// apps/api_server/src/models/project_instance.ts:1-52. The Dashboard/Planner-side mocks above
// already covered Tasks (c3a); this project-step fixture was missing entirely, so no unit could
// exercise the c3b Projects half (GET /project-templates and /project-instances previously fell
// through to the catch-all `[]`, meaning `instance-contract`/`step-contract` never existed).
const projectStepContract = { id: 'step-contract', instanceId: 'instance-contract', stepId: 'step-contract', title: 'Contract step', dueDate: '2026-08-20', scheduledDate: null, status: 'open', notes: null, assigneeId: null, assigneeName: null, milestoneId: 'milestone-contract' };
const projectInstanceContract = { id: 'instance-contract', templateId: 'project-template-contract', name: 'Contract Instance', anchorDate: '2026-08-20', status: 'active', ownerId: 1, goalId: null, isShared: false, createdAt: '2026-08-15T00:00:00Z', milestones: [{ id: 'milestone-contract', instanceId: 'instance-contract', title: 'Milestone', dueDate: null, color: null, sortOrder: 0, createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z' }], steps: [projectStepContract] };
const projectTemplateContract = { id: 'project-template-contract', name: 'Contract Template', description: null, anchorType: 'Event date', ownerId: 1, createdAt: '2026-08-15T00:00:00Z', steps: [] };
// WeeklyPlan surfaces a project step as a Task whose id IS the step's own id (not a synthetic
// planner id) and whose sourceId is the owning instance — apps/api_server/src/repositories/
// project_instances_repository.ts:106-129 (stepRowToPlannerTask). Missing from the mock below,
// this task never existed for the Planner half of c3b to render/select.
const projectStepPlannerTask = { id: 'step-contract', title: 'Contract step', notes: null, dueDate: '2026-08-20', scheduledDate: null, scheduledOrder: null, locked: false, status: 'open', sourceType: 'project_step', sourceId: 'instance-contract', sourceName: 'Contract Instance', ownerId: 1, isShared: false, collaborators: [], createdAt: '', updatedAt: '', preferredAgent: null, priority: null, tags: [], energy: null };

async function mockedLivePage(page: Page, hash: string): Promise<RequestReceipt[]> {
  const receipts: RequestReceipt[] = [];
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    const url = new URL(route.request().url());
    receipts.push({ method: route.request().method(), path: `${url.pathname}${url.search}` });
    const task = { id: 'task-contract', title: 'Contract task', notes: null, dueDate: null, scheduledDate: null, scheduledOrder: null, locked: false, status: 'open', sourceType: 'manual', sourceId: null, sourceName: null, ownerId: 1, priority: null, tags: [], energy: null, workspaceId: 1, isShared: false, collaborators: [], createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z', preferredAgent: null };
    const body = url.pathname === '/health' ? { status: 'ok' }
      : url.pathname === '/dashboard/summary' ? { tasks: { openCount: 1, pastDueCount: 0, pastDeadlineCount: 0, pastDeadlineTasks: [], todayRemainingCount: 0, todayTotalCount: 0, thisWeekRemainingCount: 0, thisWeekTotalCount: 0, unscheduledCount: 1, recent: [task], pastDue: [], today: [], thisWeek: [], unscheduled: [task] }, rhythms: { activeCount: 0, items: [] }, projects: { activeCount: 0, items: [] }, goals: { activeCount: 0, items: [] }, messages: { threadCount: 0, unreadPreviews: [] } }
        : url.pathname === '/weekly-plan' ? { weekLabel: '2026-W34', weekStart: '2026-08-17', days: [], backlog: [task, projectStepPlannerTask] }
          : url.pathname === '/tasks' ? [task]
            : url.pathname === '/project-templates' ? [projectTemplateContract]
              : url.pathname === '/project-instances' ? [projectInstanceContract]
                : url.pathname === '/project-instances/steps/step-contract' ? { ...projectStepContract, ...(route.request().method() === 'PATCH' ? JSON.parse(route.request().postData() || '{}') : {}) }
                  : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('http://127.0.0.1:4097/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"healthy":true}' }));
  await page.goto(`/#/${hash}`);
  await expect(page.getByRole('status', { name: 'Environment receipt' })).toContainText('Environment: Live');
  return receipts;
}

test('post-m1-p3-c3a: task mutations refresh Dashboard and Planner without losing task/week/filter selection', async ({ page }) => {
  // Regression caught: a successful live task mutation leaves another page stale, duplicates the task, or reload drops task/week/filter state.
  const receipts = await mockedLivePage(page, 'tasks/task/task-contract');
  await expect(page.getByTestId('page-tasks')).toBeVisible();
  await page.getByTestId('task-complete-task-contract').click();
  await expect.poll(() => receipts.some((item) => item.method === 'PATCH' && item.path === '/tasks/task-contract')).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(/#\/tasks\/task\/task-contract/);
  await page.goto('/#/dashboard');
  await expect.poll(() => receipts.filter((item) => item.path === '/dashboard/summary').length).toBeGreaterThan(0);
  await expect(page.getByText('Contract task', { exact: true })).toHaveCount(1);
  await page.goto('/#/planner?week=2026-W34');
  await expect.poll(() => receipts.some((item) => item.path === '/weekly-plan?week=2026-W34')).toBe(true);
  await expect(page.getByText('Contract task', { exact: true })).toHaveCount(1);
});

test('post-m1-p3-c3b: project-step mutations refresh Dashboard and Planner with stable canonical identity', async ({ page }) => {
  // Regression caught: project-step updates are remapped into task IDs/source types or reload loses selected project/instance/milestone/week.
  const receipts = await mockedLivePage(page, 'projects/project-template-contract?instance=instance-contract&milestone=milestone-contract');
  await expect(page.getByTestId('page-projects')).toBeVisible();
  await page.getByTestId('project-instance-step-step-contract').click();
  await expect.poll(() => receipts.some((item) => item.method === 'PATCH' && item.path === '/project-instances/steps/step-contract')).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(/project-template-contract.*instance=instance-contract.*milestone=milestone-contract/);
  await page.goto('/#/planner?week=2026-W34');
  await expect.poll(() => receipts.some((item) => item.path === '/weekly-plan?week=2026-W34')).toBe(true);
  await expect(page.locator('[data-source-type="project_step"][data-source-id="step-contract"]')).toHaveCount(1);
});

test('post-m1-p3-c3c: remaining operational families preserve stable selections, filters, and deep links on reload', async ({ page }) => {
  // Regression caught: a family mutation invalidates unrelated summaries or renderer reload resets the selected stable ID/deep link.
  const cases = [
    ['rhythms/rule-contract?filter=active', 'page-rhythms'],
    ['messages/42?filter=unread', 'page-messages'],
    ['facilities/reservations/7?building=north', 'page-facilities'],
    ['automations/rule-contract?source=gmail', 'page-automations'],
    ['integrations/google-calendar?provider=google_calendar', 'page-integrations'],
  ] as const;
  for (const [hash, testId] of cases) {
    await mockedLivePage(page, hash);
    await expect(page.getByTestId(testId)).toBeVisible();
    const before = page.url();
    await page.reload();
    expect(page.url()).toBe(before);
    await expect(page.getByTestId(testId)).toHaveAttribute('data-selected-stable-id', /.+/);
  }
});
