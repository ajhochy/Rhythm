import { expect, test } from '@playwright/test';
import { assertOwnedReviewerSchedule, terminalReviewerScheduleError,
  type ReviewerScheduleState } from '../packaged/org-evaluation-schedule-terminal';

const task: ReviewerScheduleState = {
  id: 'owned-reviewer', name: '[smoke] Org Reviewer nonce', createdByUserId: 42,
  lastRunStatus: 'error', lastError: '[infra_config] Bounded evaluation requires a pinned OpenCode fork binary',
};
const owner = { id: task.id, name: task.name, ownerUserId: 42 };

test('terminal owned Reviewer error fails before a missing evaluation cycle poll times out', () => {
  expect(assertOwnedReviewerSchedule(task, owner)).toBe(true);
  const error = terminalReviewerScheduleError(task, [{ id: 'run-1', taskId: task.id,
    status: 'error', error: task.lastError, rootSessionId: null }]);
  expect(error.message).toContain('[infra_config] Bounded evaluation requires a pinned OpenCode fork binary');
  expect(error.message).toContain('run=run-1');
  expect(error.message).toContain('before creating an evaluation cycle');
});

test('running owned Reviewer continues polling, and foreign task or run evidence is rejected', () => {
  expect(assertOwnedReviewerSchedule({ ...task, lastRunStatus: 'running' }, owner)).toBe(false);
  expect(() => assertOwnedReviewerSchedule({ ...task, createdByUserId: 99 }, owner)).toThrow('ownership changed');
  expect(() => terminalReviewerScheduleError(task, [{ id: 'other', taskId: 'foreign',
    status: 'error', error: null, rootSessionId: null }])).toThrow('foreign task');
});
