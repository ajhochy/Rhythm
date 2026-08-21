/**
 * D1.4 (#1429) — the single approval policy for executable tool proposals.
 *
 * This is deliberately called from the reusable proposal apply seam, not
 * only from HTTP: a future automation consumer therefore gets safe-only
 * behavior by default. A conditional verdict can cross this boundary only
 * when the authenticated controller supplies the fixed human confirmation.
 */
import { createHash } from 'node:crypto';

import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { ToolSafetyReport } from '../models/tool_safety_report';
import { ToolSafetyReportsRepository } from '../repositories/tool_safety_reports_repository';
import { vetToolInSandboxAsync, type ToolVettingOutcome } from './tool_sandbox_vetter';
import { validateToolInstallChange } from './tool_install_proposal_validator';

export const CONDITIONAL_TOOL_INSTALL_CONFIRMATION = 'approve-conditional-tool-install';

export type ToolInstallSafetyReason =
  | 'invalid_proposal'
  | 'report_missing'
  | 'report_mismatch'
  | 'report_malformed'
  | 'conditional_confirmation_required'
  | 'safety_verdict_blocked'
  | 'vetting_unavailable';

export interface ToolInstallSafetyResult {
  allowed: boolean;
  reason: ToolInstallSafetyReason | null;
  verdict: 'safe' | 'conditional' | 'unsafe' | 'unknown';
}

export interface ToolInstallSafetyDeps {
  reports?: ToolSafetyReportsRepository;
  vet?: (input: {
    candidate: { toolName: string; packageSource: string; installMethod: string };
    scenarioIds: string[];
  }) => Promise<ToolVettingOutcome>;
}

export interface ToolInstallSafetyOptions {
  /** Set only after the route checks an authenticated, exact confirmation token. */
  explicitHumanConfirmation?: boolean;
  deps?: ToolInstallSafetyDeps;
}

export interface ValidatedToolInstallInputs {
  toolName: string;
  packageSource: string;
  installMethod: string;
  scenarioIds: string[];
}

const vettingInFlight = new Map<string, Promise<void>>();

export function readValidatedToolInstallInputs(proposal: AgentOrgProposal): ValidatedToolInstallInputs | null {
  if (!proposal.changeJson) return null;
  try {
    const change = JSON.parse(proposal.changeJson) as Record<string, unknown>;
    if (
      typeof change.toolName !== 'string' ||
      typeof change.packageSource !== 'string' ||
      typeof change.installMethod !== 'string' ||
      !Array.isArray(change.testPrompts) ||
      !change.testPrompts.every((scenario): scenario is string => typeof scenario === 'string')
    ) {
      return null;
    }
    return {
      toolName: change.toolName,
      packageSource: change.packageSource,
      installMethod: change.installMethod,
      scenarioIds: [...change.testPrompts],
    };
  } catch {
    return null;
  }
}

/** Deterministic binding: proposal id plus exact closed candidate inputs. */
export function buildToolInstallProposalFingerprint(proposal: AgentOrgProposal): string | null {
  const inputs = readValidatedToolInstallInputs(proposal);
  if (!inputs) return null;
  return createHash('sha256')
    .update(JSON.stringify({
      proposalId: proposal.id,
      toolName: inputs.toolName,
      packageSource: inputs.packageSource,
      installMethod: inputs.installMethod,
      scenarioIds: [...inputs.scenarioIds].sort(),
    }))
    .digest('hex');
}

function isJson(value: string, expected: 'array' | 'object'): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return expected === 'array'
      ? Array.isArray(parsed)
      : !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function assessReport(
  report: ToolSafetyReport | null,
  proposal: AgentOrgProposal,
  inputs: ValidatedToolInstallInputs,
  fingerprint: string,
): ToolInstallSafetyReason | null {
  if (!report) return 'report_missing';
  if (
    report.proposalId !== proposal.id ||
    report.proposalFingerprint !== fingerprint ||
    report.toolName !== inputs.toolName ||
    report.packageSource !== inputs.packageSource ||
    report.installMethod !== inputs.installMethod
  ) return 'report_mismatch';
  if (
    !Number.isFinite(report.sandboxDurationMs) || report.sandboxDurationMs < 0 ||
    !Number.isInteger(report.testPromptsRunCount) || report.testPromptsRunCount !== inputs.scenarioIds.length ||
    !Number.isInteger(report.credentialAccessAttemptsCount) || report.credentialAccessAttemptsCount < 0 ||
    !isJson(report.forbiddenPathViolationsJson, 'array') ||
    !isJson(report.networkCallsObservedJson, 'array') ||
    !isJson(report.fileSystemWritesObservedJson, 'array') ||
    !isJson(report.evidenceJson, 'object')
  ) return 'report_malformed';
  return null;
}

async function vetAndPersistAsync(
  proposal: AgentOrgProposal,
  inputs: ValidatedToolInstallInputs,
  fingerprint: string,
  reports: ToolSafetyReportsRepository,
  vet: NonNullable<ToolInstallSafetyDeps['vet']>,
): Promise<void> {
  const key = `${proposal.id}:${fingerprint}`;
  let inFlight = vettingInFlight.get(key);
  if (!inFlight) {
    inFlight = (async () => {
      const outcome = await vet({
        candidate: {
          toolName: inputs.toolName,
          packageSource: inputs.packageSource,
          installMethod: inputs.installMethod,
        },
        scenarioIds: inputs.scenarioIds,
      });
      await reports.createAsync({
        proposalId: proposal.id,
        proposalFingerprint: fingerprint,
        toolName: inputs.toolName,
        packageSource: inputs.packageSource,
        installMethod: inputs.installMethod,
        ...outcome,
      });
    })().finally(() => vettingInFlight.delete(key));
    vettingInFlight.set(key, inFlight);
  }
  await inFlight;
}

/**
 * Central fail-closed policy. It never accepts report/verdict data from a
 * request: only a re-read durable report can authorize an apply operation.
 */
export async function evaluateToolInstallSafetyAsync(
  proposal: AgentOrgProposal,
  options: ToolInstallSafetyOptions = {},
): Promise<ToolInstallSafetyResult> {
  if (!validateToolInstallChange(proposal).valid) {
    return { allowed: false, reason: 'invalid_proposal', verdict: 'unknown' };
  }
  const inputs = readValidatedToolInstallInputs(proposal);
  const fingerprint = buildToolInstallProposalFingerprint(proposal);
  if (!inputs || !fingerprint) return { allowed: false, reason: 'invalid_proposal', verdict: 'unknown' };

  const reports = options.deps?.reports ?? new ToolSafetyReportsRepository();
  const vet = options.deps?.vet ?? vetToolInSandboxAsync;
  let report: ToolSafetyReport | null;
  try {
    report = await reports.findByProposalIdAsync(proposal.id);
  } catch {
    return { allowed: false, reason: 'vetting_unavailable', verdict: 'unknown' };
  }

  const initialIssue = assessReport(report, proposal, inputs, fingerprint);
  if (initialIssue === 'report_missing') {
    try {
      await vetAndPersistAsync(proposal, inputs, fingerprint, reports, vet);
      report = await reports.findByProposalIdAsync(proposal.id);
    } catch {
      return { allowed: false, reason: 'vetting_unavailable', verdict: 'unknown' };
    }
  } else if (initialIssue) {
    return { allowed: false, reason: initialIssue, verdict: 'unknown' };
  }

  const reportIssue = assessReport(report, proposal, inputs, fingerprint);
  if (reportIssue) return { allowed: false, reason: reportIssue, verdict: 'unknown' };
  if (report!.verdict === 'safe') return { allowed: true, reason: null, verdict: 'safe' };
  if (report!.verdict === 'conditional') {
    return options.explicitHumanConfirmation
      ? { allowed: true, reason: null, verdict: 'conditional' }
      : { allowed: false, reason: 'conditional_confirmation_required', verdict: 'conditional' };
  }
  return { allowed: false, reason: 'safety_verdict_blocked', verdict: report!.verdict };
}
