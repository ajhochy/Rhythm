import { test as gap } from '@playwright/test';
import { test, expect, responseFor, assertResponse } from './feature-test';
import { openExistingPrimary, openRuns } from './primary-read';

test('[P0] coordinator: Runs rows agree with the authoritative run list', async ({ page, sessions }) => {
  // Catches a fabricated/obsolete bounded-coding card, stale status or a run from a foreign Coordinator.
  await sessions.open();
  const pending = responseFor(page, 'POST', '/coordinator-conversations/runs');
  const { root } = await openExistingPrimary(page);
  const response = await pending; await assertResponse(response, 'POST', '/coordinator-conversations/runs', 200);
  const body = await response.json();
  expect(body).toMatchObject({ kind: 'runs', runs: expect.any(Array) });
  expect(body.runs.length, 'UNVERIFIED: existing-run status agreement needs a real run; no disposable primary/run fixture is configured').toBeGreaterThan(0);
  await openRuns(page);
  const labels: Record<string, string> = { running: 'Running', needs_you: 'Needs you', finished: 'Finished', failed: 'Failed', cancelled: 'Stopped', unknown: 'Status unknown' };
  await expect(page.getByTestId('coordinator-run-open')).toHaveCount(body.runs.length);
  for (const run of body.runs) {
    expect(run).toMatchObject({ goalId: expect.any(String), objective: expect.any(String), status: expect.any(String) });
    const row = page.getByTestId('coordinator-run-open').filter({ hasText: run.objective });
    await expect(row).toContainText(labels[run.status]);
    if (!run.childSessionId) await expect(row).toBeDisabled();
  }
  if (!body.runs.length) await expect(page.getByTestId('coordinator-conversation-card')).toContainText('No coding runs yet');
  expect((await sessions.api!.json<{ session: { id: string } }>(`/agent-sessions/${root.id}`)).session.id).toBe(root.id);
});

gap('[P0] coordinator: UNVERIFIED two simultaneous repo goals, confined branches and once-only reports', () => {
  // Would catch orphaned concurrent starts, edits in the original repo and duplicate/stale completion claims.
  throw new Error('UNVERIFIED: real-model opt-in is authorized, but goal admission writes the existing permanent primary and its non-deletable journal — requires a disposable signed-in primary/database plus two nonce-owned git fixtures and app-matched model credentials');
});

gap('[P0] coordinator: UNVERIFIED needs-you, open-run and confirmed Stop cancel the whole run tree', () => {
  // Would catch stopping only the root while specialists keep running or stale question/approval cards remain actionable.
  throw new Error('UNVERIFIED: no nonce-owned active Coordinator run can be created and removed from the real primary safely — requires the disposable run fixture, deterministic pending question and assertion of withdrawn requests/no completion report');
});

gap('[P0] coordinator: UNVERIFIED restart preserves runs and emits no duplicate report', () => {
  // Would catch losing durable membership or replaying notifications after restart.
  throw new Error('UNVERIFIED: restarting the real runtime with existing user jobs is not a disposable test fixture — requires the synthetic primary/run database and a full owned app restart against this exact mega bundle');
});
