/** D1.5 (#1430): the closed, display-only tool safety review boundary. */
import type { RevisionedAgentOrgProposal } from '../models/agent_org_proposal';
import type { ToolSafetyReport, ToolSafetyVerdict } from '../models/tool_safety_report';
import { ToolSafetyReportsRepository } from '../repositories/tool_safety_reports_repository';
import { isSafePackageSource, isSafeToolName } from './tool_install_safety';

export interface ToolSafetyReviewProjection {
  state: 'ready' | 'missing' | 'malformed';
  verdict: ToolSafetyVerdict;
  tool?: { name: string; packageSource: string };
  forbiddenPathViolations?: Array<{ label: string; count: number }>;
  networkCalls?: Array<{ host: string; count: number }>;
  workspaceWriteCount?: number;
  credentialAccessAttemptsCount?: number;
  scenarioAttemptsCount?: number;
  sandboxDurationMs?: number;
  reason?: string | null;
}

const FIXED_REASONS = new Set([
  'sandbox_unavailable', 'sandbox_start_failed', 'sandbox_terminated',
  'sandbox_evidence_incomplete', 'sandbox_candidate_failed',
  'sandbox_observer_unavailable', 'sandbox_error', 'unsafe_package_source',
  'tool_install_apply_unavailable',
]);
const SAFE_LABEL = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SAFE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MAX_AGGREGATE_COUNT = 1000000;

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_AGGREGATE_COUNT
    ? value : null;
}

function parseArray(raw: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function labels(raw: string): Array<{ label: string; count: number }> | null {
  const values = parseArray(raw);
  if (!values || !values.every((value) => typeof value === 'string' && SAFE_LABEL.test(value))) return null;
  const aggregate = new Map<string, number>();
  for (const value of values as string[]) aggregate.set(value, (aggregate.get(value) ?? 0) + 1);
  return [...aggregate.entries()].map(([label, total]) => ({ label, count: total }));
}

function networkCalls(raw: string): Array<{ host: string; count: number }> | null {
  const values = parseArray(raw);
  if (!values) return null;
  const aggregate = new Map<string, number>();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    const entryCount = count(entry.count);
    if (typeof entry.host !== 'string' || !SAFE_HOST.test(entry.host) || entryCount === null) return null;
    aggregate.set(entry.host, (aggregate.get(entry.host) ?? 0) + entryCount);
  }
  return [...aggregate.entries()].map(([host, total]) => ({ host, count: total }));
}

function workspaceWriteCount(raw: string): number | null {
  const values = parseArray(raw);
  if (!values) return null;
  let total = 0;
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entryCount = count((value as Record<string, unknown>).count);
    if (entryCount === null || total + entryCount > MAX_AGGREGATE_COUNT) return null;
    total += entryCount;
  }
  return total;
}

export function projectToolSafetyReview(report: ToolSafetyReport | null): ToolSafetyReviewProjection {
  if (!report) return { state: 'missing', verdict: 'unknown' };
  const forbiddenPathViolations = labels(report.forbiddenPathViolationsJson);
  const observedNetworkCalls = networkCalls(report.networkCallsObservedJson);
  const writes = workspaceWriteCount(report.fileSystemWritesObservedJson);
  const duration = count(report.sandboxDurationMs);
  const attempts = count(report.testPromptsRunCount);
  const credentialAttempts = count(report.credentialAccessAttemptsCount);
  if (
    !isSafeToolName(report.toolName) || !isSafePackageSource(report.packageSource) ||
    forbiddenPathViolations === null || observedNetworkCalls === null || writes === null ||
    duration === null || attempts === null || credentialAttempts === null ||
    (report.reason !== null && !FIXED_REASONS.has(report.reason))
  ) return { state: 'malformed', verdict: 'unknown' };

  return {
    state: 'ready', tool: { name: report.toolName, packageSource: report.packageSource },
    verdict: report.verdict, forbiddenPathViolations, networkCalls: observedNetworkCalls,
    workspaceWriteCount: writes, credentialAccessAttemptsCount: credentialAttempts,
    scenarioAttemptsCount: attempts, sandboxDurationMs: duration, reason: report.reason,
  };
}

/** Adds a review-safe field while preventing a tool proposal's raw apply JSON from leaving the API. */
export async function attachToolSafetyReviewProjectionsAsync<T extends RevisionedAgentOrgProposal>(
  proposals: T[],
): Promise<Array<T & { toolSafety?: ToolSafetyReviewProjection; changeJson: string | null }>> {
  const toolIds = proposals.filter((proposal) => proposal.kind === 'tool-install').map((proposal) => proposal.id);
  const reports = await new ToolSafetyReportsRepository().findLatestByProposalIdsAsync(toolIds);
  return proposals.map((proposal) => proposal.kind === 'tool-install'
    ? { ...proposal, changeJson: null, toolSafety: projectToolSafetyReview(reports.get(proposal.id) ?? null) }
    : { ...proposal, changeJson: proposal.changeJson });
}
