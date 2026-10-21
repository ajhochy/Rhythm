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
    if (url.pathname === `/agent-sessions/${run.rootSessionId}`) {
      const session = { id: run.rootSessionId, name: 'C2h owned schedule root', ownerUserId: 7,
        category: 'scheduled', scheduledTaskId: task.id, status: 'error' };
      return fulfillJson(route, 200, url.searchParams.has('transcriptLimit')
        ? { session, messages: [] } : { session }).then(() => true);
    }
    return false;
  });

  await expect.poll(() => matching(seen, 'GET', `/agent-schedules/${task.id}/runs`).length).toBeGreaterThan(0);
  await expect(page.getByText(run.error)).toBeVisible();
  await page.getByTestId(`schedule-run-${run.id}`).click();
  await expect(page).toHaveURL(/\/#\/agents\?/);
  expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('sessionId')).toBe(run.rootSessionId);
  await expect(page.locator('.agents-workspace .session-header h1')).toHaveText('C2h owned schedule root');
  await expect.poll(() => matching(seen, 'GET', `/agent-sessions/${run.rootSessionId}`)
    .some(request => new URLSearchParams(request.search).get('transcriptLimit') === '50')).toBe(true);
});

test('issue-1513-c4: opening a schedule run selects its owned root session in Agents', async ({ page }) => {
  // Regression caught: the run lookup succeeds but generic /agents navigation
  // leaves the previously selected conversation in the inspector.
  const seen: SeenRequest[] = [];
  const run = { id: 'schedule-run-owned', taskId: task.id, startedAt: '2026-08-15T10:00:00.000Z', endedAt: null, status: 'completed', error: null, rootSessionId: 'root-session-owned', createdAt: '2026-08-15T10:00:00.000Z' };
  await openPhase7Live(page, '/tools/tasks', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-schedules') return fulfillJson(route, 200, [task]).then(() => true);
    if (url.pathname === `/agent-schedules/${task.id}/runs`) return fulfillJson(route, 200, [run]).then(() => true);
    if (url.pathname === `/agent-sessions/${run.rootSessionId}`) {
      const session = { id: run.rootSessionId, name: 'Owned schedule run', ownerUserId: 7, scope: 'scheduled', status: 'idle' };
      return fulfillJson(route, 200, url.searchParams.has('transcriptLimit') ? { session, messages: [] } : { session }).then(() => true);
    }
    return false;
  });

  await page.getByTestId(`schedule-run-${run.id}`).click();
  await expect(page).toHaveURL(/\/#\/agents\?/);
  expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('sessionId')).toBe(run.rootSessionId);
  await expect(page.locator('.agents-workspace .session-header h1')).toHaveText('Owned schedule run');
  await expect.poll(() => matching(seen, 'GET', `/agent-sessions/${run.rootSessionId}`)
    .some(request => new URLSearchParams(request.search).get('transcriptLimit') === '50')).toBe(true);
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

test('schedule editor keeps a failed update draft and retries the existing row', async ({ page }) => {
  const seen: SeenRequest[] = [];
  let reject = true;
  let stored = { ...task };
  await openPhase7Live(page, '/tools/tasks', seen, async (route, request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/agent-schedules') return fulfillJson(route, 200, [stored]).then(() => true);
    if (pathname === `/agent-schedules/${task.id}` && request.method() === 'PATCH') {
      if (reject) return fulfillJson(route, 503, { error: { code: 'UNAVAILABLE', message: 'Try saving again' } }).then(() => true);
      stored = { ...stored, ...request.postDataJSON() };
      return fulfillJson(route, 200, stored).then(() => true);
    }
    return false;
  });
  await page.getByTestId('schedule-edit').click();
  const editor = page.getByTestId('schedule-editor');
  await editor.getByLabel('Time', { exact: true }).fill('11:45');
  await editor.getByTestId('schedule-save').click();
  await expect(editor.getByTestId('schedule-timing-error')).toBeVisible();
  await expect(editor.getByLabel('Time', { exact: true })).toHaveValue('11:45');
  await expect(editor.getByLabel('Timezone')).toHaveValue(task.timezone);
  reject = false;
  await editor.getByTestId('schedule-save').click();
  await expect(editor).toHaveCount(0);
  expect(matching(seen, 'PATCH', `/agent-schedules/${task.id}`)).toHaveLength(2);
  expect(matching(seen, 'POST', '/agent-schedules')).toHaveLength(0);
  expect(stored).toMatchObject({ scheduledTime: '11:45', scheduledDay: 1, timezone: task.timezone });
});

test('schedule save without a next run warns after reopen and edits its real row without duplicate create', async ({ page }) => {
  const seen: SeenRequest[] = [];
  let stored: typeof task | undefined;
  await openPhase7Live(page, '/tools/tasks', seen, async (route, request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/agent-schedules' && request.method() === 'GET')
      return fulfillJson(route, 200, stored ? [stored] : []).then(() => true);
    if (pathname === '/agent-schedules' && request.method() === 'POST') {
      stored = { ...task, ...request.postDataJSON(), id: 'created-schedule', nextRunAt: null };
      return fulfillJson(route, 201, stored).then(() => true);
    }
    if (pathname === '/agent-schedules/created-schedule' && request.method() === 'PATCH') {
      stored = { ...stored!, ...request.postDataJSON(), nextRunAt: '2035-01-01T12:00:00.000Z' };
      return fulfillJson(route, 200, stored).then(() => true);
    }
    return false;
  });
  await page.getByTestId('schedule-new').click();
  let editor = page.getByTestId('schedule-editor');
  await editor.getByLabel('Name', { exact: true }).fill('Owned warning schedule');
  await editor.getByLabel('Instructions / Prompt').fill('Do the scheduled task');
  await editor.getByLabel('Time', { exact: true }).fill('12:00');
  await editor.getByLabel('Timezone').selectOption('UTC');
  await editor.getByTestId('schedule-save').click();
  await expect(page.getByTestId('schedule-timing-warning')).toContainText('no next run');
  await expect(page.getByTestId('schedule-created-schedule')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('schedule-timing-warning')).toContainText('no next run');
  await page.getByTestId('schedule-edit').click();
  editor = page.getByTestId('schedule-editor');
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Owned warning schedule');
  await editor.getByLabel('Time', { exact: true }).fill('13:00');
  await editor.getByTestId('schedule-save').click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId('schedule-timing-warning')).toHaveCount(0);
  expect(matching(seen, 'POST', '/agent-schedules')).toHaveLength(1);
  expect(matching(seen, 'PATCH', '/agent-schedules/created-schedule')).toHaveLength(1);
});

test('enabling an untimed saved draft opens timing repair without an enable write', async ({ page }) => {
  const seen: SeenRequest[] = [];
  const draft = { ...task, scheduleType: 'once', enabled: false, runAt: null, nextRunAt: null };
  let updated: Record<string, unknown> | undefined;
  await openPhase7Live(page, '/tools/tasks', seen, async (route, request) => {
    if (new URL(request.url()).pathname === '/agent-schedules')
      return fulfillJson(route, 200, [draft]).then(() => true);
    if (new URL(request.url()).pathname === `/agent-schedules/${draft.id}` && request.method() === 'PATCH') {
      const input = request.postDataJSON();
      updated = { ...draft, ...input, nextRunAt: input.runAt };
      return fulfillJson(route, 200, updated).then(() => true);
    }
    return false;
  });
  await page.getByTestId('schedule-toggle').click();
  const editor = page.getByTestId('schedule-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId('schedule-timing-error')).toBeVisible();
  await expect(editor.getByLabel("Run at (this Mac's local time)")).toHaveValue('');
  await expect(editor.getByLabel('Enabled', { exact: true })).toBeChecked();
  expect(matching(seen, 'PATCH', `/agent-schedules/${draft.id}`)).toHaveLength(0);
  expect(draft.enabled).toBe(false);
  await editor.getByLabel("Run at (this Mac's local time)").fill('2099-01-15T12:00');
  await editor.getByTestId('schedule-save').click();
  await expect(editor).toHaveCount(0);
  expect(matching(seen, 'PATCH', `/agent-schedules/${draft.id}`)).toHaveLength(1);
  expect(matching(seen, 'POST', '/agent-schedules')).toHaveLength(0);
  expect(updated).toMatchObject({ id: draft.id, enabled: true, runAt: '2099-01-15T20:00:00.000Z' });
});
