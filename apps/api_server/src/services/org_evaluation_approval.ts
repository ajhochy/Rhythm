import { createHash } from 'node:crypto';
import { AppError } from '../errors/app_error';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { OrgEvaluationJob } from '../models/org_evaluation';
import { OrgEvaluationRepository } from '../repositories/org_evaluation_repository';
import { captureOrgEvaluationTargetAsync, type OrgEvaluationTargetSnapshot } from './org_evaluation_fixture';
import { armOrgEvaluationApplyFence } from './org_evaluation_apply_fence';
import { evaluationCanonicalJson, evaluationDigest } from './org_evaluation_integrity';

type EvaluationProof = { evaluationId: string; originalHash: string; finalCandidateHash: string };
type Provenance = { source?: unknown; humanReviewRequired?: unknown; evaluation?: unknown };
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function provenance(proposal: AgentOrgProposal): Provenance | null {
  if (!proposal.provenanceJson) return null;
  try {
    const parsed: unknown = JSON.parse(proposal.provenanceJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Provenance : null;
  } catch { return null; }
}

function proof(value: unknown): EvaluationProof | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return typeof raw.evaluationId === 'string' && raw.evaluationId.length > 0 &&
    hash(raw.originalHash) && hash(raw.finalCandidateHash)
    ? { evaluationId: raw.evaluationId, originalHash: raw.originalHash, finalCandidateHash: raw.finalCandidateHash }
    : null;
}

function boundJob(jobs: OrgEvaluationJob[], proposalId: string): OrgEvaluationJob | null {
  const bound = jobs.filter(job => job.qualifiedProposalId === proposalId);
  if (bound.length > 1) throw AppError.conflict('Multiple evaluations are bound to this proposal');
  return bound[0] ?? null;
}

/** Closed DTO: no raw execution receipt or local fixture path reaches the queue row. */
export async function projectOrgEvaluationProposalsAsync<T extends AgentOrgProposal>(proposals: T[]): Promise<Array<T & {
  source: string | null;
  preReviewEvaluation: (EvaluationProof & { status: 'qualified' }) | null;
}>> {
  if (!proposals.length) return [];
  const repository = new OrgEvaluationRepository();
  const jobs = await repository.listJobsAsync();
  return Promise.all(proposals.map(async proposal => {
    const meta = provenance(proposal);
    const bound = boundJob(jobs, proposal.id);
    const evaluated = meta?.source === 'org-reviewer-evaluated' || bound !== null;
    const candidate = proof(meta?.evaluation);
    const validMeta = evaluated && meta?.source === 'org-reviewer-evaluated' &&
      meta.humanReviewRequired === true && candidate && bound?.id === candidate.evaluationId &&
      bound.status === 'qualified' && bound.originalHash === candidate.originalHash;
    const final = validMeta ? (await repository.listCandidatesAsync(bound!.id)).find(row =>
      row.id === bound!.finalCandidateId && row.role === 'final') : null;
    const valid = validMeta && final?.configHash === candidate.finalCandidateHash &&
      final.changeJson === proposal.changeJson && final.kind === proposal.kind &&
      final.targetRef === proposal.targetRef;
    return { ...proposal, source: evaluated ? 'org-reviewer-evaluated' : typeof meta?.source === 'string' ? meta.source : null,
      preReviewEvaluation: valid ? { ...candidate, status: 'qualified' as const } : null };
  }));
}

/** Must run before validateProposalChange or any live applier call. */
export async function assertOrgEvaluationApprovalAsync(
  proposal: AgentOrgProposal,
  body: Record<string, unknown>,
): Promise<void> {
  const repository = new OrgEvaluationRepository();
  const jobs = await repository.listJobsAsync();
  const bound = boundJob(jobs, proposal.id);
  const meta = provenance(proposal);
  if (meta?.source !== 'org-reviewer-evaluated' && !bound) return; // Legacy authority remains unchanged.
  const stored = proof(meta?.evaluation);
  if (meta?.source !== 'org-reviewer-evaluated' || meta.humanReviewRequired !== true || !stored || !bound) {
    throw AppError.conflict('Evaluated proposal proof is incomplete');
  }
  if (!proof({ evaluationId: body.expectedEvaluationId, originalHash: body.originalHash,
    finalCandidateHash: body.finalCandidateHash })) throw AppError.badRequest('Exact evaluated version proof is required');
  if (body.expectedEvaluationId !== stored.evaluationId || body.originalHash !== stored.originalHash ||
      body.finalCandidateHash !== stored.finalCandidateHash) throw AppError.conflict('Evaluated version differs from the reviewed proposal');
  const job = await repository.getJobAsync(stored.evaluationId);
  if (!job || job.id !== bound.id || job.status !== 'qualified' || job.qualifiedProposalId !== proposal.id ||
      job.originalHash !== stored.originalHash || job.targetRef !== proposal.targetRef) {
    throw AppError.conflict('Evaluated proposal is no longer qualified');
  }
  const root = job.budgetRootId ? await repository.getJobAsync(job.budgetRootId) : job;
  if (!root || root.status !== 'qualified' || root.budgetRootId ||
      jobs.some(sibling => sibling.budgetRootId === root.id &&
        ['planning', 'exploring', 'validating'].includes(sibling.status))) {
    throw AppError.conflict('Evaluation cycle is still active or no longer qualified');
  }
  const candidates = await repository.listCandidatesAsync(job.id);
  const final = candidates.find(candidate => candidate.id === job.finalCandidateId && candidate.role === 'final');
  if (!final || final.kind !== proposal.kind || final.targetRef !== proposal.targetRef ||
      final.configHash !== stored.finalCandidateHash || digest(final.effectiveConfigJson) !== final.configHash ||
      !proposal.changeJson || final.changeJson !== proposal.changeJson) {
    throw AppError.conflict('Proposal does not match the exact tested final configuration');
  }
  const budget = await repository.getBudgetAsync(job.id);
  if (budget.hasUnknownUsage || budget.outstandingTokens > 0 || budget.settledTokens > budget.maxTokens) {
    throw AppError.conflict('Evaluation token accounting is incomplete');
  }
  try {
    const input = JSON.parse(job.inputJson) as { snapshot?: OrgEvaluationTargetSnapshot; problem?: {
      evidence?: Array<{ sessionId?: unknown }>;
      change?: unknown;
    } };
    const evidence = input.problem?.evidence;
    const evidenceSessionIds = Array.isArray(evidence) && evidence.every((item) =>
      item && typeof item.sessionId === 'string' && item.sessionId.length > 0)
      ? evidence.map((item) => item.sessionId as string) : [];
    const originalChange = input.problem?.change;
    if (!originalChange || typeof originalChange !== 'object' || Array.isArray(originalChange)) {
      throw Error('Original diagnosis change is unavailable');
    }
    const current = await captureOrgEvaluationTargetAsync({
      kind: final.kind, targetRef: job.targetRef, expectedRevision: job.targetRevision,
      ownerUserId: job.ownerUserId, change: originalChange as Record<string, unknown>,
      evidenceSessionIds,
    });
    if (evaluationDigest(evaluationCanonicalJson(current)) !== job.originalHash ||
        !input.snapshot || evaluationCanonicalJson(input.snapshot) !== evaluationCanonicalJson(current))
      throw Error('Target bytes changed');
    armOrgEvaluationApplyFence(proposal, input.snapshot);
  } catch {
    throw AppError.conflict('Evaluated target changed before approval');
  }
}
