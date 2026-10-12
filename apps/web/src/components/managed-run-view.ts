/**
 * Pure display derivation for one server-reported managed run
 * (GET /agent-workstreams/:id status view). Everything here is read from the
 * server record; nothing is inferred from local button clicks.
 */
export type ManagedRunStatus = {
  workstream: { id: string; state: string; stateReason?: string | null; lastJobId?: string | null };
  jobs: unknown[];
  budget: Record<string, unknown>;
};

export type ManagedRunView = {
  /** True while the server reports a queued/running worker, or cannot confirm one ended. */
  active: boolean;
  state: string;
  kind: string;
  usage: string;
  result: string | null;
};

const ACTIVE_JOB_STATES = new Set(['queued', 'claimed', 'running', 'unknown']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function count(value: Record<string, unknown> | null, key: string): number | null {
  const result = value?.[key];
  return typeof result === 'number' && Number.isFinite(result) ? result : null;
}

function text(value: Record<string, unknown> | null, key: string): string | null {
  const result = value?.[key];
  return typeof result === 'string' && result ? result : null;
}

const words = (value: string) => value.replace(/_/g, ' ');

function kindLabel(purpose: string | undefined): string {
  if (purpose === 'decompose' || purpose === 'continue') {
    return 'Read-only planning run. It cannot change files and is not approved coding execution.';
  }
  if (purpose === 'execute') return 'Scoped-workspace execution run.';
  return 'Managed run.';
}

export function managedRunView(status: ManagedRunStatus, purpose?: string): ManagedRunView {
  const jobs = status.jobs.map(record).filter((job): job is Record<string, unknown> => job !== null);
  const job = jobs.find((item) => item.id === status.workstream.lastJobId) ?? jobs[jobs.length - 1] ?? null;
  const jobState = text(job, 'state');
  const active = status.workstream.state === 'queued' || status.workstream.state === 'running' ||
    (jobState !== null && ACTIVE_JOB_STATES.has(jobState));

  const jobTokens = count(record(job?.usage), 'totalTokens');
  const budgetTokens = count(status.budget, 'actualTokens');
  const authorized = count(record(job?.usage), 'authorizedTokens') ?? count(status.budget, 'authorizedTokens');
  const tokens = jobTokens ?? (active ? null : budgetTokens);
  const of = authorized !== null ? ` of ${authorized.toLocaleString()} authorized` : '';
  const usage = tokens !== null
    ? `Usage: ${tokens.toLocaleString()} actual tokens${of}.`
    : active
      ? 'Usage: not reported until the worker finishes.'
      : 'Usage: actual usage unavailable from the server.';

  let result: string | null = null;
  const application = record(job?.application);
  const applicationStatus = text(application, 'status');
  const reason = text(application, 'reason');
  if (applicationStatus === 'quarantined') {
    result = 'Result quarantined: the worker finished, but its output was held for review and not applied. It is unverified' +
      (reason ? ` (${words(reason)}).` : '.');
  } else if (applicationStatus === 'stale') {
    result = 'Result discarded as stale: controls changed before the worker returned. Nothing was applied.';
  } else if (jobState === 'failed') {
    result = 'The worker failed. Nothing was applied.';
  } else if (jobState === 'cancelled') {
    result = 'The worker was cancelled. Nothing was applied.';
  } else if (jobState === 'unknown') {
    result = 'Worker outcome is unknown and needs review. No new work starts until it is resolved.';
  }

  const state = active
    ? jobState === 'unknown' ? 'Needs review' : 'Running'
    : jobState === 'succeeded' ? 'Finished' : jobState ? words(jobState) : words(status.workstream.state);
  const stateReason = status.workstream.stateReason ? ` · ${words(status.workstream.stateReason)}` : '';
  return { active, state: state.charAt(0).toUpperCase() + state.slice(1) + stateReason, kind: kindLabel(purpose), usage, result };
}
