import { expect, test } from '@playwright/test';
import { fulfillJson, matching, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

const task = {
  id: 'schedule-7', name: 'Phase 7 schedule', description: null, scheduleType: 'weekly',
  scheduledTime: '09:30', scheduledDay: 1, cronExpression: null, runAt: null,
  timezone: 'America/Los_Angeles', prompt: 'Run Phase 7', agentKind: 'research', agentConfigId: 'research',
  allowedMcpsJson: '["rhythm"]', allowedSkillsJson: '["verification"]', modelProvider: 'openai', modelId: 'gpt-5.6-terra',
  enabled: true, nextRunAt: '2026-08-17T16:30:00.000Z', lastRunAt: null, lastRunStatus: null, lastError: null,
  createdByUserId: 7, createdAt: '2026-08-15T09:00:00.000Z', updatedAt: '2026-08-15T09:00:00.000Z',
};

test('post-m1-p7-c2g: live scheduled-task CRUD trigger preserves canonical recurrence profile model and allowlists', async ({ page }) => {
  // Regression caught: schedule controls mutate fixture-only type/lastRun/runState fields.
  const seen: SeenRequest[] = [];
  await openPhase7Live(page, '/tools/tasks', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-schedules') return fulfillJson(route, 200, [task]).then(() => true);
    if (url.pathname === `/agent-schedules/${task.id}/trigger-now`) return fulfillJson(route, 200, { ...task, lastRunStatus: 'queued' }).then(() => true);
    return false;
  });

  await expect.poll(() => matching(seen, 'GET', '/agent-schedules').length).toBeGreaterThan(0);
  await expect(page.getByTestId(`schedule-${task.id}`)).toBeVisible();
  await page.getByTestId('schedule-trigger').click();
  await expect.poll(() => matching(seen, 'POST', `/agent-schedules/${task.id}/trigger-now`).length).toBe(1);
  await expect(page.getByText(task.timezone, { exact: true })).toBeVisible();
});

test('post-m1-p7-c2h: durable schedule history uses canonical run rows and owned rootSessionId navigation', async ({ page }) => {
  // Regression caught: clicking synthetic history records /agent-sessions?scheduledTaskId instead of reading durable run rows.
  const seen: SeenRequest[] = [];
  const run = { id: 'schedule-run-7', taskId: task.id, startedAt: '2026-08-15T10:00:00.000Z', endedAt: '2026-08-15T10:01:00.000Z', status: 'error', error: 'bounded failure', rootSessionId: 'root-session-7', createdAt: '2026-08-15T10:01:00.000Z' };
  await openPhase7Live(page, '/tools/tasks', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-schedules') return fulfillJson(route, 200, [task]).then(() => true);
    if (url.pathname === `/agent-schedules/${task.id}/runs`) return fulfillJson(route, 200, [run]).then(() => true);
    if (url.pathname === `/agent-sessions/${run.rootSessionId}`) return fulfillJson(route, 200, { id: run.rootSessionId, ownerUserId: 7, status: 'error' }).then(() => true);
    return false;
  });

  await expect.poll(() => matching(seen, 'GET', `/agent-schedules/${task.id}/runs`).length).toBeGreaterThan(0);
  await expect(page.getByText(run.error)).toBeVisible();
  await page.getByTestId(`schedule-run-${run.id}`).click();
  await expect.poll(() => matching(seen, 'GET', `/agent-sessions/${run.rootSessionId}`).length).toBe(1);
});

test('post-m1-p7-c2i: live report card renders nullable and unmeasured owner-scoped run evidence', async ({ page }) => {
  // Regression caught: fixed 89%/83% scorecards are presented as live evidence.
  const seen: SeenRequest[] = [];
  const rollup = {
    windowDays: 30,
    agents: [{ agentKind: 'research', totalRuns: 2, completedRuns: 0, escalatedRuns: 0, inProgressRuns: 1, unmeasuredRuns: 1, completionRate: null, escalationRate: null, notEnoughData: true, totalTokens: 120, wastedTokens: 20, wastedTokenRate: null, totalUserCorrections: 1, averageCorrectionsPerRun: null, repeatedMistakes: [{ mistake: 'Missing source', count: 2 }] }],
  };
  await openPhase7Live(page, '/tools/report-card', seen, async (route, request) => {
    if (new URL(request.url()).pathname === '/agents/run-quality') return fulfillJson(route, 200, rollup).then(() => true);
    return false;
  });

  await expect.poll(() => matching(seen, 'GET', '/agents/run-quality').length).toBeGreaterThan(0);
  await expect(page.getByText(/not enough data/i)).toBeVisible();
  await expect(page.getByText(/1 unmeasured/i)).toBeVisible();
  await expect(page.getByText('Missing source')).toBeVisible();
  await expect(page.getByText('89%', { exact: true })).toHaveCount(0);
});
