/** D1.4 (#1429) — durable creation, sandbox vetting, human decision, apply. */
import type { AgentOrgProposal, AgentOrgProposalInput, RevisionedAgentOrgProposal } from '../models/agent_org_proposal';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { ToolSafetyReportsRepository } from '../repositories/tool_safety_reports_repository';
import {
  buildToolInstallProposalFingerprint,
  evaluateToolInstallSafetyAsync,
  readValidatedToolInstallInputs,
  type ToolInstallSafetyDeps,
} from './tool_install_safety_policy';
import { validateToolInstallChange } from './tool_install_proposal_validator';
import { applyVettedToolInstallAsync, type ToolInstallApplier } from './tool_install_apply';
import { sanitizeD1Json, sanitizeD1PlainText } from './d1_secret_sanitizer';

const creationVettingInFlight = new Map<string, Promise<RevisionedAgentOrgProposal>>();

export interface CreateToolInstallProposalInput {
  title: string;
  change: Record<string, unknown>;
  rationale?: string | null;
  signalRef?: string | null;
  targetRef?: string | null;
  dedupKey?: string | null;
  ownerUserId?: number | null;
}

export interface ToolInstallProposalLifecycleDeps extends ToolInstallSafetyDeps {
  proposals?: AgentOrgProposalsRepository;
  reports?: ToolSafetyReportsRepository;
  installer?: ToolInstallApplier;
}

function lifecycleRepos(deps: ToolInstallProposalLifecycleDeps) {
  return {
    proposals: deps.proposals ?? new AgentOrgProposalsRepository(),
    reports: deps.reports ?? new ToolSafetyReportsRepository(),
  };
}

function unknownOutcome(scenarioCount: number) {
  return {
    verdict: 'unknown' as const,
    reason: 'sandbox_error',
    sandboxDurationMs: 0,
    testPromptsRunCount: scenarioCount,
    forbiddenPathViolationsJson: '[]',
    networkCallsObservedJson: '[]',
    fileSystemWritesObservedJson: '[]',
    credentialAccessAttemptsCount: 0,
    evidenceJson: '{}',
  };
}

function sanitizedChange(input: CreateToolInstallProposalInput): Record<string, unknown> {
  const text = sanitizeD1Json(JSON.stringify(input.change));
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('tool-install proposal validation failed');
  }
  return parsed as Record<string, unknown>;
}

function preflightProposal(input: CreateToolInstallProposalInput, change: Record<string, unknown>): AgentOrgProposal {
  return {
    id: 'tool-install-preflight', auditRunId: null, kind: 'tool-install', risk: 'high', external: 0,
    status: 'proposed', title: sanitizeD1PlainText(input.title) ?? '', rationale: sanitizeD1PlainText(input.rationale ?? null),
    signalRef: sanitizeD1PlainText(input.signalRef ?? null), targetRef: sanitizeD1PlainText(input.targetRef ?? null),
    changeJson: JSON.stringify(change), beforeSnapshotJson: null, provenanceJson: null,
    dedupKey: input.dedupKey ?? null, baselineScore: null, postScore: null, measureReason: null,
    decidedByUserId: null, ownerUserId: input.ownerUserId ?? null,
    diagnosisConfidence: null, diagnosisConfidenceVersion: null, createdAt: '', updatedAt: '',
  };
}

async function requireTransition(
  proposals: AgentOrgProposalsRepository,
  proposal: RevisionedAgentOrgProposal,
  next: string,
  patch?: Partial<AgentOrgProposalInput>,
): Promise<RevisionedAgentOrgProposal> {
  const transitioned = await proposals.updateStatusAsync(proposal.id, next, patch, proposal.revision);
  if (!transitioned) throw new Error('tool-install lifecycle proposal disappeared');
  return transitioned;
}

/**
 * The single production creation seam. It persists `proposed`, CAS-transitions
 * to `sandbox-running` before invoking the vetter, persists the report, then
 * re-reads that durable report before selecting the next lifecycle status.
 */
export async function createAndVetToolInstallProposalAsync(
  input: CreateToolInstallProposalInput,
  deps: ToolInstallProposalLifecycleDeps = {},
): Promise<RevisionedAgentOrgProposal> {
  const { proposals, reports } = lifecycleRepos(deps);
  // Validate BEFORE persisting a caller's JSON. In particular, an invalid
  // request must not gain a durable `change_json` field that could contain a
  // raw prompt or secret-shaped value rejected by the closed D1 schema.
  const change = sanitizedChange(input);
  const preflight = preflightProposal(input, change);
  const preflightValidation = validateToolInstallChange(preflight);
  if (!preflightValidation.valid) throw new Error('tool-install proposal validation failed');
  const proposal = await proposals.createAsync({
    kind: 'tool-install', risk: 'high', status: 'proposed', title: input.title,
    changeJson: JSON.stringify(change), rationale: sanitizeD1PlainText(input.rationale ?? null),
    signalRef: sanitizeD1PlainText(input.signalRef ?? null), targetRef: sanitizeD1PlainText(input.targetRef ?? null),
    dedupKey: input.dedupKey ?? null, ownerUserId: input.ownerUserId ?? null,
  });

  // A duplicate dedup-key request returns the same durable proposal rather
  // than launching a second vet. Concurrent callers that both observe the
  // just-created `proposed` row share the one in-flight promise below.
  if (proposal.status !== 'proposed') return proposal;
  let inFlight = creationVettingInFlight.get(proposal.id);
  if (!inFlight) {
    inFlight = vetCreatedToolInstallProposalAsync(proposal, deps, proposals, reports)
      .finally(() => creationVettingInFlight.delete(proposal.id));
    creationVettingInFlight.set(proposal.id, inFlight);
  }
  return inFlight;
}

async function vetCreatedToolInstallProposalAsync(
  proposal: RevisionedAgentOrgProposal,
  deps: ToolInstallProposalLifecycleDeps,
  proposals: AgentOrgProposalsRepository,
  reports: ToolSafetyReportsRepository,
): Promise<RevisionedAgentOrgProposal> {

  const validation = validateToolInstallChange(proposal);
  if (!validation.valid) {
    return requireTransition(proposals, proposal, 'rejected');
  }
  const inputs = readValidatedToolInstallInputs(proposal);
  const fingerprint = buildToolInstallProposalFingerprint(proposal);
  if (!inputs || !fingerprint) return requireTransition(proposals, proposal, 'rejected');

  const running = await requireTransition(proposals, proposal, 'sandbox-running');
  let outcome;
  try {
    const vet = deps.vet ?? (await import('./tool_sandbox_vetter')).vetToolInSandboxAsync;
    outcome = await vet({
      candidate: {
        toolName: inputs.toolName,
        packageSource: inputs.packageSource,
        installMethod: inputs.installMethod,
      },
      scenarioIds: inputs.scenarioIds,
    });
  } catch {
    outcome = unknownOutcome(inputs.scenarioIds.length);
  }

  await reports.createAsync({
    proposalId: running.id, proposalFingerprint: fingerprint,
    toolName: inputs.toolName, packageSource: inputs.packageSource,
    installMethod: inputs.installMethod, ...outcome,
  });

  // Re-read is mandatory: report contents from the vetter are never trusted
  // until the sanitized, fingerprinted database row is the one being judged.
  const safety = await evaluateToolInstallSafetyAsync(running, { deps: { reports, vet: deps.vet } });
  if (safety.verdict === 'unsafe') return requireTransition(proposals, running, 'rejected');
  if (safety.verdict === 'safe' || safety.verdict === 'conditional') {
    return requireTransition(proposals, running, 'sandbox-vetted');
  }
  return requireTransition(proposals, running, 'pending');
}

/** Human rejection is terminal and is legal for both reviewable and unavailable states. */
export async function denyToolInstallProposalAsync(
  proposalId: string,
  decidedByUserId: number,
  deps: ToolInstallProposalLifecycleDeps = {},
): Promise<RevisionedAgentOrgProposal> {
  const { proposals } = lifecycleRepos(deps);
  const proposal = await proposals.findByIdAsync(proposalId);
  if (!proposal || proposal.kind !== 'tool-install') throw new Error('tool-install proposal not found');
  if (proposal.status !== 'sandbox-vetted' && proposal.status !== 'pending') {
    throw new Error('tool-install proposal is not awaiting a human decision');
  }
  return requireTransition(proposals, proposal, 'rejected', { decidedByUserId });
}

/**
 * Claims `sandbox-vetted -> approved` with the proposal revision BEFORE the
 * apply boundary. That durable CAS is what prevents a second concurrent human
 * approval from invoking the installer a second time.
 */
export async function approveVettedToolInstallProposalAsync(
  proposalId: string,
  decidedByUserId: number,
  explicitHumanConfirmation: boolean,
  deps: ToolInstallProposalLifecycleDeps = {},
): Promise<RevisionedAgentOrgProposal> {
  const { proposals, reports } = lifecycleRepos(deps);
  const proposal = await proposals.findByIdAsync(proposalId);
  if (!proposal || proposal.kind !== 'tool-install') throw new Error('tool-install proposal not found');
  if (proposal.status !== 'sandbox-vetted') throw new Error('tool-install proposal is not sandbox-vetted');

  const safety = await evaluateToolInstallSafetyAsync(proposal, {
    explicitHumanConfirmation,
    deps: { reports, vet: deps.vet },
  });
  if (!safety.allowed) throw new Error(`tool-install safety policy refused approval: ${safety.reason}`);

  const approved = await requireTransition(proposals, proposal, 'approved', { decidedByUserId });
  let result;
  try {
    result = await applyVettedToolInstallAsync(approved, deps.installer);
  } catch {
    result = { applied: false, reason: 'tool_install_apply_unavailable' as const };
  }
  if (result.applied) return requireTransition(proposals, approved, 'applied');
  return requireTransition(proposals, approved, 'failed', { measureReason: 'tool_install_apply_unavailable' });
}
