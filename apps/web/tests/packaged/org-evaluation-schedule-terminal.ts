export type ReviewerScheduleState = {
  id: string;
  name: string;
  createdByUserId: number | null;
  lastRunStatus: string | null;
  lastError: string | null;
};

export type ReviewerScheduleRun = {
  id: string;
  taskId: string;
  status: string;
  error: string | null;
  rootSessionId: string | null;
};

const terminalStatuses = new Set(['success', 'completed_no_op', 'error', 'blocked_on_approval', 'cancelled']);

export function assertOwnedReviewerSchedule(
  task: ReviewerScheduleState,
  expected: { id: string; name: string; ownerUserId: number },
): boolean {
  if (task.id !== expected.id || task.name !== expected.name || task.createdByUserId !== expected.ownerUserId) {
    throw new Error('Reviewer schedule ownership changed during the packaged evaluation');
  }
  return terminalStatuses.has(task.lastRunStatus ?? '');
}

export function terminalReviewerScheduleError(task: ReviewerScheduleState, runs: ReviewerScheduleRun[]): Error {
  if (!terminalStatuses.has(task.lastRunStatus ?? '')) throw new Error('Reviewer schedule is not terminal');
  if (runs.some(run => run.taskId !== task.id)) throw new Error('Reviewer run history contains a foreign task');
  const detail = (task.lastError ?? runs[0]?.error ?? 'no error detail').slice(0, 1024);
  const run = runs[0];
  return new Error(`Reviewer schedule ended ${task.lastRunStatus} before creating an evaluation cycle: ${detail}; ` +
    `task=${task.id}; run=${run?.id ?? 'none'}; runStatus=${run?.status ?? 'none'}; ` +
    `rootSession=${run?.rootSessionId ?? 'none'}`);
}
