import type { GatewayMode } from '.';

export type ToolSafetyProjection = {
  state: 'ready' | 'missing' | 'malformed'; verdict: 'safe' | 'conditional' | 'unsafe' | 'unknown';
  tool?: { name: string; packageSource: string }; forbiddenPathViolations?: Array<{ label: string; count: number }>;
  networkCalls?: Array<{ host: string; count: number }>; workspaceWriteCount?: number; credentialAccessAttemptsCount?: number;
  scenarioAttemptsCount?: number; sandboxDurationMs?: number; reason?: string | null;
};
export type ExperimentSummary = { collectingProgress: 'no_experiment' | 'collecting' | 'decided'; eligibleCount: number; missingCount: number; treatmentIntegrity: 'ok' | 'degraded' | 'unknown'; guardrailStatus: 'ok' | 'breached' | 'unknown'; terminalReason: string | null; staleBeforeApplyConflict: boolean; calibrationStatus: string; calibratedConfidence: number | null; };
export type PreReviewEvaluation = { evaluationId: string; originalHash: string; finalCandidateHash: string; status: 'qualified' };
export type EvaluationSettings = { tokenLimit: number; candidateCount: 2 | 3 };
export type EvaluationJob = { id: string; budgetRootId: string | null; status: 'planning' | 'exploring' | 'validating' | 'qualified' | 'inconclusive' | 'failed'; maxTokens: number; validationReserveTokens: number; originalHash: string; targetRef: string; targetRevision: string; finalCandidateId: string | null; qualifiedProposalId: string | null; failureReason: string | null; createdAt: string; updatedAt: string };
export type EvaluationCompositionPart = { sourceCandidateId: string; changePath: string; retained: boolean; reason: string; evidenceResultIds: string[] };
export type EvaluationCandidate = { id: string; role: 'original' | 'variant' | 'composition' | 'final'; ordinal: number; configHash: string; changeJson?: string; parentCandidateIds?: string[]; compositionParts?: EvaluationCompositionPart[] };
export type EvaluationResult = { id: string; candidateId: string; phase: 'probe' | 'validation'; status: 'pass' | 'fail' | 'inconclusive'; score: number | null; taskKey: string; receiptHash: string; receiptJson: string; tokenUsage: { totalTokens: number; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; reasoningTokens: number | null } | null; failureReason?: string | null };
export type EvaluationBudget = { maxTokens: number; validationReserveTokens: number; settledTokens: number; outstandingTokens: number; explorationAvailableTokens: number; totalAvailableTokens: number; hasUnknownUsage: boolean };
export type EvaluationDetail = { job: EvaluationJob; candidates: EvaluationCandidate[]; results: EvaluationResult[]; budget: EvaluationBudget };
export type OrgProposal = { id: string; title: string; kind: string; risk: string; status: string; outcomeStatus: string; rationale: string | null; createdAt: string | null; updatedAt: string | null; changeJson: string | null; toolSafety?: ToolSafetyProjection; experimentSummary: ExperimentSummary | null; source?: string | null; preReviewEvaluation?: PreReviewEvaluation | null; evaluationProofInvalid?: boolean };
export interface OrgProposalsGateway { readonly mode: GatewayMode; list(status: string): Promise<OrgProposal[]>; approve(id: string, conditionalToolInstall?: boolean, evaluated?: { expectedEvaluationId: string; finalCandidateHash: string; originalHash: string }): Promise<OrgProposal>; reject(id: string): Promise<OrgProposal>; revert(id: string): Promise<OrgProposal>; getEvaluationSettings(): Promise<EvaluationSettings>; updateEvaluationSettings(input: EvaluationSettings): Promise<EvaluationSettings>; listEvaluations(): Promise<{ jobs: EvaluationJob[] }>; getEvaluation(id: string): Promise<EvaluationDetail>; }
export class OrgProposalsGatewayError extends Error { constructor(readonly status: number, message: string) { super(message); } }

const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === 'string' ? value : null;
const nonnegative = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value : null;
const failureText = (status: number) => ({ 0: 'Proposal service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Proposal not found', 409: 'Proposal cannot be changed in its current state' })[status] ?? `Proposal request failed (${status})`;

function evaluationSettings(value: unknown): EvaluationSettings {
  const raw = record(value);
  if (!raw || nonnegative(raw.tokenLimit) === null || raw.tokenLimit === 0 || ![2, 3].includes(Number(raw.candidateCount))) throw new OrgProposalsGatewayError(0, 'Evaluation settings response is malformed');
  return { tokenLimit: raw.tokenLimit as number, candidateCount: raw.candidateCount as 2 | 3 };
}

function evaluationJob(value: unknown): EvaluationJob {
  const raw = record(value);
  if (!raw || !text(raw.id) || !(raw.budgetRootId === null || text(raw.budgetRootId)) || !['planning', 'exploring', 'validating', 'qualified', 'inconclusive', 'failed'].includes(String(raw.status)) || nonnegative(raw.maxTokens) === null || nonnegative(raw.validationReserveTokens) === null || !hash(raw.originalHash) || !text(raw.targetRef) || !text(raw.targetRevision) || !text(raw.createdAt) || !text(raw.updatedAt)) throw new OrgProposalsGatewayError(0, 'Evaluation job response is malformed');
  return raw as EvaluationJob;
}

function evaluationDetail(value: unknown): EvaluationDetail {
  const raw = record(value); const budget = record(raw?.budget);
  if (!raw || !Array.isArray(raw.candidates) || !Array.isArray(raw.results) || !budget || ['maxTokens', 'validationReserveTokens', 'settledTokens', 'outstandingTokens', 'explorationAvailableTokens', 'totalAvailableTokens'].some(key => nonnegative(budget[key]) === null) || typeof budget.hasUnknownUsage !== 'boolean') throw new OrgProposalsGatewayError(0, 'Evaluation detail response is malformed');
  const job = evaluationJob(raw.job);
  if (raw.candidates.some(row => { const item = record(row); const parts = item?.compositionParts; return !item || !text(item.id) || !['original', 'variant', 'composition', 'final'].includes(String(item.role)) || nonnegative(item.ordinal) === null || !hash(item.configHash) || parts !== undefined && (!Array.isArray(parts) || parts.some(part => { const value = record(part); return !value || !text(value.sourceCandidateId) || !text(value.changePath) || typeof value.retained !== 'boolean' || !text(value.reason) || !Array.isArray(value.evidenceResultIds) || value.evidenceResultIds.some(id => !text(id)); })); }) || raw.results.some(row => { const item = record(row); return !item || !text(item.id) || !text(item.candidateId) || !['probe', 'validation'].includes(String(item.phase)) || !['pass', 'fail', 'inconclusive'].includes(String(item.status)) || !text(item.taskKey) || !hash(item.receiptHash) || !text(item.receiptJson); })) throw new OrgProposalsGatewayError(0, 'Evaluation evidence response is malformed');
  return { job, candidates: raw.candidates as EvaluationCandidate[], results: raw.results as EvaluationResult[], budget: budget as EvaluationBudget };
}

function toolSafety(value: unknown): ToolSafetyProjection {
  const raw = record(value);
  if (!raw || raw.state === 'missing') return { state: 'missing', verdict: 'unknown' };
  const tool = record(raw.tool);
  const paths = Array.isArray(raw.forbiddenPathViolations) ? raw.forbiddenPathViolations.map(record) : null;
  const hosts = Array.isArray(raw.networkCalls) ? raw.networkCalls.map(record) : null;
  if (raw.state !== 'ready' || !['safe', 'conditional', 'unsafe', 'unknown'].includes(String(raw.verdict)) || !tool || !text(tool.name) || !text(tool.packageSource) || !paths || paths.some((entry) => !entry || !text(entry.label) || nonnegative(entry.count) === null) || !hosts || hosts.some((entry) => !entry || !text(entry.host) || nonnegative(entry.count) === null) || nonnegative(raw.workspaceWriteCount) === null || nonnegative(raw.credentialAccessAttemptsCount) === null || nonnegative(raw.scenarioAttemptsCount) === null || nonnegative(raw.sandboxDurationMs) === null || (raw.reason !== null && raw.reason !== undefined && !text(raw.reason))) return { state: 'malformed', verdict: 'unknown' };
  return { state: 'ready', verdict: raw.verdict as ToolSafetyProjection['verdict'], tool: { name: text(tool.name)!, packageSource: text(tool.packageSource)! }, forbiddenPathViolations: paths.map((entry) => ({ label: text(entry!.label)!, count: nonnegative(entry!.count)! })), networkCalls: hosts.map((entry) => ({ host: text(entry!.host)!, count: nonnegative(entry!.count)! })), workspaceWriteCount: nonnegative(raw.workspaceWriteCount)!, credentialAccessAttemptsCount: nonnegative(raw.credentialAccessAttemptsCount)!, scenarioAttemptsCount: nonnegative(raw.scenarioAttemptsCount)!, sandboxDurationMs: nonnegative(raw.sandboxDurationMs)!, reason: text(raw.reason) };
}

function experimentSummary(value: unknown): ExperimentSummary | null {
  const raw = record(value);
  const confidence = raw?.calibratedConfidence;
  if (!raw || !['no_experiment', 'collecting', 'decided'].includes(String(raw.collectingProgress)) || nonnegative(raw.eligibleCount) === null || nonnegative(raw.missingCount) === null || !['ok', 'degraded', 'unknown'].includes(String(raw.treatmentIntegrity)) || !['ok', 'breached', 'unknown'].includes(String(raw.guardrailStatus)) || (raw.terminalReason !== null && !text(raw.terminalReason)) || typeof raw.staleBeforeApplyConflict !== 'boolean' || !text(raw.calibrationStatus) || !(confidence === null || typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1)) return null;
  return { collectingProgress: raw.collectingProgress as ExperimentSummary['collectingProgress'], eligibleCount: nonnegative(raw.eligibleCount)!, missingCount: nonnegative(raw.missingCount)!, treatmentIntegrity: raw.treatmentIntegrity as ExperimentSummary['treatmentIntegrity'], guardrailStatus: raw.guardrailStatus as ExperimentSummary['guardrailStatus'], terminalReason: text(raw.terminalReason), staleBeforeApplyConflict: raw.staleBeforeApplyConflict, calibrationStatus: text(raw.calibrationStatus)!, calibratedConfidence: confidence as number | null };
}

function normalize(value: unknown): OrgProposal {
  const raw = record(value) ?? {}; const kind = text(raw.kind) ?? 'unknown';
  const evaluation = record(raw.preReviewEvaluation);
  const validEvaluation = evaluation && text(evaluation.evaluationId) && hash(evaluation.originalHash) && hash(evaluation.finalCandidateHash) && evaluation.status === 'qualified';
  const evaluationProofInvalid = raw.source === 'org-reviewer-evaluated' && !validEvaluation || raw.preReviewEvaluation != null && !validEvaluation;
  return { id: text(raw.id) ?? '', title: text(raw.title) ?? 'Untitled proposal', kind, risk: text(raw.risk) ?? 'unknown', status: text(raw.status) ?? 'unknown', outcomeStatus: text(raw.outcomeStatus) ?? 'unknown', rationale: text(raw.rationale), createdAt: text(raw.createdAt), updatedAt: text(raw.updatedAt), changeJson: kind === 'tool-install' ? null : text(raw.changeJson), ...(kind === 'tool-install' ? { toolSafety: toolSafety(raw.toolSafety) } : {}), experimentSummary: experimentSummary(raw.experimentSummary), source: text(raw.source), preReviewEvaluation: validEvaluation ? { evaluationId: text(evaluation!.evaluationId)!, originalHash: hash(evaluation!.originalHash)!, finalCandidateHash: hash(evaluation!.finalCandidateHash)!, status: 'qualified' } : null, evaluationProofInvalid };
}

export function createLiveOrgProposalsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): OrgProposalsGateway {
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetcher(`${apiBase}${path}`, { ...init, headers });
  };
  const decode = async (pending: Promise<Response>) => { try { const response = await pending; if (!response.ok) throw new OrgProposalsGatewayError(response.status, failureText(response.status)); return normalize(await response.json()); } catch (error) { if (error instanceof OrgProposalsGatewayError) throw error; throw new OrgProposalsGatewayError(0, failureText(0)); } };
  const mutate = (id: string, action: 'approve' | 'reject' | 'revert', body?: Record<string, unknown>) => decode(request(`/agent-org-proposals/${encodeURIComponent(id)}/${action}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }));
  const json = async (path: string, init?: RequestInit) => { try { const response = await request(path, init); if (!response.ok) throw new OrgProposalsGatewayError(response.status, failureText(response.status)); return await response.json() as unknown; } catch (error) { if (error instanceof OrgProposalsGatewayError) throw error; throw new OrgProposalsGatewayError(0, failureText(0)); } };
  return { mode: 'live', async list(status) { const body = await json(`/agent-org-proposals?status=${encodeURIComponent(status)}`); return Array.isArray(body) ? body.map(normalize) : []; }, approve: (id, conditional = false, evaluated) => mutate(id, 'approve', conditional || evaluated ? { ...(conditional ? { toolSafetyConfirmation: 'approve-conditional-tool-install' } : {}), ...evaluated } : undefined), reject: (id) => mutate(id, 'reject'), revert: (id) => mutate(id, 'revert'), getEvaluationSettings: async () => evaluationSettings(await json('/agent-org-proposals/evaluations/settings')), updateEvaluationSettings: async (input) => evaluationSettings(await json('/agent-org-proposals/evaluations/settings', { method: 'PATCH', body: JSON.stringify(input) })), listEvaluations: async () => { const raw = record(await json('/agent-org-proposals/evaluations')); if (!raw || !Array.isArray(raw.jobs)) throw new OrgProposalsGatewayError(0, 'Evaluation list response is malformed'); return { jobs: raw.jobs.map(evaluationJob) }; }, getEvaluation: async (id) => evaluationDetail(await json(`/agent-org-proposals/evaluations/${encodeURIComponent(id)}`)) };
}
