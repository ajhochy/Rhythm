import type { GatewayMode } from '.';

export type ToolSafetyProjection = {
  state: 'ready' | 'missing' | 'malformed'; verdict: 'safe' | 'conditional' | 'unsafe' | 'unknown';
  tool?: { name: string; packageSource: string }; forbiddenPathViolations?: Array<{ label: string; count: number }>;
  networkCalls?: Array<{ host: string; count: number }>; workspaceWriteCount?: number; credentialAccessAttemptsCount?: number;
  scenarioAttemptsCount?: number; sandboxDurationMs?: number; reason?: string | null;
};
export type ExperimentSummary = { collectingProgress: 'no_experiment' | 'collecting' | 'decided'; eligibleCount: number; missingCount: number; treatmentIntegrity: 'ok' | 'degraded' | 'unknown'; guardrailStatus: 'ok' | 'breached' | 'unknown'; terminalReason: string | null; staleBeforeApplyConflict: boolean; calibrationStatus: string; calibratedConfidence: number | null; };
export type OrgProposal = { id: string; title: string; kind: string; risk: string; status: string; outcomeStatus: string; rationale: string | null; createdAt: string | null; updatedAt: string | null; changeJson: string | null; toolSafety?: ToolSafetyProjection; experimentSummary: ExperimentSummary | null; };
export interface OrgProposalsGateway { readonly mode: GatewayMode; list(status: string): Promise<OrgProposal[]>; approve(id: string, conditionalToolInstall?: boolean): Promise<OrgProposal>; reject(id: string): Promise<OrgProposal>; revert(id: string): Promise<OrgProposal>; }
export class OrgProposalsGatewayError extends Error { constructor(readonly status: number, message: string) { super(message); } }

const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === 'string' ? value : null;
const nonnegative = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const failureText = (status: number) => ({ 0: 'Proposal service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Proposal not found', 409: 'Proposal cannot be changed in its current state' })[status] ?? `Proposal request failed (${status})`;

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
  return { id: text(raw.id) ?? '', title: text(raw.title) ?? 'Untitled proposal', kind, risk: text(raw.risk) ?? 'unknown', status: text(raw.status) ?? 'unknown', outcomeStatus: text(raw.outcomeStatus) ?? 'unknown', rationale: text(raw.rationale), createdAt: text(raw.createdAt), updatedAt: text(raw.updatedAt), changeJson: kind === 'tool-install' ? null : text(raw.changeJson), ...(kind === 'tool-install' ? { toolSafety: toolSafety(raw.toolSafety) } : {}), experimentSummary: experimentSummary(raw.experimentSummary) };
}

export function createLiveOrgProposalsGateway(apiBase: string, _token: string | undefined, fetcher: typeof fetch = fetch): OrgProposalsGateway {
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers });
  const decode = async (pending: Promise<Response>) => { try { const response = await pending; if (!response.ok) throw new OrgProposalsGatewayError(response.status, failureText(response.status)); return normalize(await response.json()); } catch (error) { if (error instanceof OrgProposalsGatewayError) throw error; throw new OrgProposalsGatewayError(0, failureText(0)); } };
  const mutate = (id: string, action: 'approve' | 'reject' | 'revert', conditional = false) => decode(request(`/agent-org-proposals/${encodeURIComponent(id)}/${action}`, { method: 'POST', ...(conditional ? { body: JSON.stringify({ toolSafetyConfirmation: 'approve-conditional-tool-install' }) } : {}) }));
  return { mode: 'live', async list(status) { try { const response = await request(`/agent-org-proposals?status=${encodeURIComponent(status)}`); if (!response.ok) throw new OrgProposalsGatewayError(response.status, failureText(response.status)); const body = await response.json(); return Array.isArray(body) ? body.map(normalize) : []; } catch (error) { if (error instanceof OrgProposalsGatewayError) throw error; throw new OrgProposalsGatewayError(0, failureText(0)); } }, approve: (id, conditional = false) => mutate(id, 'approve', conditional), reject: (id) => mutate(id, 'reject'), revert: (id) => mutate(id, 'revert') };
}
