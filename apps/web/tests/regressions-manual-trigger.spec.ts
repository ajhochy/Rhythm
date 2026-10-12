import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { fulfillJson, matching, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

const task = { id: 'c1-review', name: 'Synthetic Org Reviewer', scheduleType: 'daily', timezone: 'UTC', prompt: 'Read only synthetic review', agentKind: 'opencode', agentConfigId: 'org-reviewer', enabled: false, nextRunAt: null, lastRunAt: null, lastRunStatus: null, lastError: null };

test('C1 rendered ToolWorkspace holds duplicate clicks and displays persisted progress after reopen', async ({ page }) => {
  // Regression: acceptance is silent, repeat clicks POST twice, and running is invisible until terminal history.
  const seen: SeenRequest[] = [];
  let status: string | null = null;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await openPhase7Live(page, '/tools/tasks', seen, async (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/agent-schedules') return fulfillJson(route, 200, [{ ...task, lastRunStatus: status }]).then(() => true);
    if (path.endsWith('/runs')) return fulfillJson(route, 200, []).then(() => true);
    if (path.endsWith('/trigger-now')) {
      await held;
      status = 'queued';
      await fulfillJson(route, 200, { ...task, lastRunStatus: status });
      return true;
    }
    return false;
  });
  const button = page.getByTestId('schedule-trigger');
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveText(/Queueing/);
  await button.evaluate((node: HTMLButtonElement) => node.click());
  release();
  await expect(page.getByTestId('schedule-progress')).toHaveText(/queued/i);
  await expect(button).toBeDisabled();
  expect(matching(seen, 'POST', `/agent-schedules/${task.id}/trigger-now`)).toHaveLength(1);
  status = 'running';
  await expect(page.getByTestId('schedule-progress')).toHaveText(/running/i);
  await page.reload();
  await expect(page.getByTestId('schedule-progress')).toHaveText(/running/i);
  status = 'completed_no_op';
  await expect(page.getByTestId('schedule-progress')).toHaveText(/completed_no_op/);
  await expect(button).toBeEnabled();
  await expect(page.getByTestId('schedule-toggle')).toHaveText('Enable');
  await page.reload();
  await expect(page.getByTestId('schedule-progress')).toHaveText(/completed_no_op/);
});

for (const failure of [
  { code: 400, message: 'Retired optimizer configuration: use supported Org Reviewer configuration.', expected: /Retired optimizer configuration.*Org Reviewer/ },
  { code: 400, message: 'agent security-locked: synthetic-c1 (review required)', expected: /security-locked.*review required/ },
  { code: 401, message: 'hidden detail', expected: /Authentication required/ },
  { code: 403, message: 'hidden detail', expected: /Forbidden/ },
  { code: 503, message: 'hidden detail', expected: /Trigger scheduled task failed \(503\)/ },
]) test(`C1 rendered ToolWorkspace makes rejection ${failure.code} ${failure.message} visible and retryable`, async ({ page }) => {
  const seen: SeenRequest[] = [];
  await openPhase7Live(page, '/tools/tasks', seen, (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/agent-schedules') return fulfillJson(route, 200, [task]).then(() => true);
    if (path.endsWith('/runs')) return fulfillJson(route, 200, []).then(() => true);
    if (path.endsWith('/trigger-now')) return fulfillJson(route, failure.code, { error: { message: failure.message } }).then(() => true);
    return false;
  });
  await page.getByTestId('schedule-trigger').click();
  await expect(page.getByTestId('schedule-trigger-error')).toHaveText(failure.expected);
  await expect(page.getByTestId('schedule-trigger')).toBeEnabled();
});

test('C1 repair live Queueing announcement and keyboard focus survive acceptance and failure', async ({ page }) => {
  const seen: SeenRequest[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await openPhase7Live(page, '/tools/tasks', seen, async (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/agent-schedules') return fulfillJson(route, 200, [task]).then(() => true);
    if (path.endsWith('/runs')) return fulfillJson(route, 200, []).then(() => true);
    if (path.endsWith('/trigger-now')) { await held; return fulfillJson(route, 503, {}).then(() => true); }
    return false;
  });
  const button = page.getByTestId('schedule-trigger');
  const progress = page.getByTestId('schedule-progress');
  await expect(progress).toHaveAttribute('role', 'status'); // Regression: conditional region is absent before click.
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(progress).toHaveText('Queueing…');
  await expect(page.getByTestId('schedule-run-context')).toHaveAttribute('aria-busy', 'true');
  await expect(button).toBeFocused();
  await page.keyboard.press('Space');
  release();
  await expect(page.getByTestId('schedule-trigger-error')).toHaveAttribute('role', 'alert');
  await expect(progress).not.toHaveText(/Queueing/);
  await expect(button).toBeFocused();
  expect(matching(seen, 'POST', `/agent-schedules/${task.id}/trigger-now`)).toHaveLength(1);
});

for (const first of ['a', 'b']) test(`C1 repair overlapping A/B completion ${first} only clears its own pending/error`, async ({ page }) => {
  const seen: SeenRequest[] = [];
  const tasks = [{ ...task, id: 'a', name: 'Synthetic A' }, { ...task, id: 'b', name: 'Synthetic B' }];
  const releases: Record<string, () => void> = {};
  const held = Object.fromEntries(tasks.map(item => [item.id, new Promise<void>(resolve => { releases[item.id] = resolve; })]));
  await openPhase7Live(page, '/tools/tasks', seen, async (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/agent-schedules') return fulfillJson(route, 200, tasks).then(() => true);
    if (path.endsWith('/runs')) return fulfillJson(route, 200, []).then(() => true);
    if (path.endsWith('/trigger-now')) {
      const id = path.split('/')[2]; await held[id];
      return fulfillJson(route, 400, { error: { message: `Configuration ${id}: review model settings.` } }).then(() => true);
    }
    return false;
  });
  const button = page.getByTestId('schedule-trigger');
  const select = async (id: string) => { await page.getByRole('option', { name: new RegExp(`Synthetic ${id.toUpperCase()}`) }).click(); };
  await button.click(); await select('b'); await button.click(); await select('a');
  await expect(button).toBeDisabled(); // Regression: single triggeringId incorrectly enables pending A.
  releases[first](); await select(first);
  await expect(page.getByTestId('schedule-trigger-error')).toHaveText(`Configuration ${first}: review model settings.`);
  const other = first === 'a' ? 'b' : 'a'; await select(other);
  await expect(button).toBeDisabled(); await expect(button).toHaveText(/Queueing/);
  await expect(page.getByTestId('schedule-trigger-error')).toHaveCount(0);
  await button.evaluate((node: HTMLButtonElement) => node.click());
  releases[other]();
  await expect(page.getByTestId('schedule-trigger-error')).toHaveText(`Configuration ${other}: review model settings.`);
  await select(first);
  await expect(page.getByTestId('schedule-trigger-error')).toHaveText(`Configuration ${first}: review model settings.`);
  for (const id of ['a', 'b']) expect(matching(seen, 'POST', `/agent-schedules/${id}/trigger-now`)).toHaveLength(1);
});

test('C1 repair polling failure retains inspector/progress and recovers with manual refresh', async ({ page }) => {
  const seen: SeenRequest[] = [];
  let reads = 0;
  let recover = false;
  await openPhase7Live(page, '/tools/tasks', seen, (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/agent-schedules') {
      reads++;
      if (reads > 1 && !recover) return fulfillJson(route, 503, {}).then(() => true);
      return fulfillJson(route, 200, [{ ...task, lastRunStatus: recover ? 'failed' : 'running', lastError: recover ? 'Synthetic model unavailable: review model settings.' : null }]).then(() => true);
    }
    if (path.endsWith('/runs')) return fulfillJson(route, 200, []).then(() => true);
    return false;
  });
  await expect(page.getByTestId('schedule-refresh-error')).toHaveText(/stale.*retrying.*Refresh/i); // Regression: fatal list error hides inspector.
  await expect(page.getByTestId('schedule-refresh-error')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('schedule-progress')).toHaveText(/running/);
  await expect(page.getByTestId('schedule-trigger')).toBeDisabled();
  recover = true;
  await page.getByTestId('schedules-refresh').click();
  await expect(page.getByTestId('schedule-refresh-error')).toHaveCount(0);
  await expect(page.getByTestId('schedule-progress')).toHaveText(/failed.*review model settings/);
  await expect(page.getByTestId('schedule-progress')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Environment receipt' })).toHaveText(/Live.*healthy.*healthy/);
  if (process.env.RHYTHM_CAPTURE_EVIDENCE === '1') {
    await page.screenshot({ path: fileURLToPath(new URL('../../../docs/ai/artifacts/c1-manual-trigger-20261001/recovered-failed.png', import.meta.url)), fullPage: true });
  }
});

test('C1 repair aborted accepted POST reconciles durable task/runs without blind retry', async ({ page }) => {
  const seen: SeenRequest[] = [];
  let accepted = false;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await openPhase7Live(page, '/tools/tasks', seen, async (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/agent-schedules') { if (accepted) await held; return fulfillJson(route, 200, [{ ...task, lastRunStatus: accepted ? 'queued' : null }]).then(() => true); }
    if (path.endsWith('/runs')) return fulfillJson(route, 200, []).then(() => true);
    if (path.endsWith('/trigger-now')) { accepted = true; await route.abort('failed'); return true; }
    return false;
  });
  const button = page.getByTestId('schedule-trigger');
  await button.click();
  await expect(page.getByTestId('schedule-trigger-error')).toHaveText(/may have been accepted.*Refresh/i);
  await expect(button).toBeDisabled(); // Regression: lost HTTP response enables duplicate trigger.
  release();
  await expect(page.getByTestId('schedule-progress')).toHaveText(/queued/);
  await expect(page.getByTestId('schedule-trigger-error')).toHaveCount(0);
  await expect(button).toBeDisabled();
  expect(matching(seen, 'POST', `/agent-schedules/${task.id}/trigger-now`)).toHaveLength(1);
  expect(matching(seen, 'GET', `/agent-schedules/${task.id}/runs`).length).toBeGreaterThan(1);
});

for (const code of [401, 403, 404, 503]) test(`C1 repair ${code} safe next step and successful keyboard retry`, async ({ page }) => {
  const seen: SeenRequest[] = [];
  let attempts = 0;
  await openPhase7Live(page, '/tools/tasks', seen, (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/agent-schedules') return fulfillJson(route, 200, [task]).then(() => true);
    if (path.endsWith('/runs')) return fulfillJson(route, 200, []).then(() => true);
    if (path.endsWith('/trigger-now')) return (++attempts === 1 ? fulfillJson(route, code, { error: { message: 'SECRET hidden detail' } }) : fulfillJson(route, 200, { ...task, lastRunStatus: 'queued' })).then(() => true);
    return false;
  });
  const button = page.getByTestId('schedule-trigger');
  await button.click();
  await expect(page.getByTestId('schedule-trigger-error')).toHaveText(code === 401 ? /sign in/i : code === 403 ? /request access/i : code === 404 ? /Refresh/i : /service.*retry/i);
  await expect(page.getByTestId('schedule-trigger-error')).not.toHaveText(/SECRET/);
  await button.focus(); await page.keyboard.press('Space');
  await expect(page.getByTestId('schedule-progress')).toHaveText(/queued/);
  await expect(page.getByTestId('schedule-trigger-error')).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(matching(seen, 'POST', `/agent-schedules/${task.id}/trigger-now`)).toHaveLength(2);
});
