import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import cron from 'node-cron';
import { AppError } from '../errors/app_error';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import { agentOrgProposalToJson } from '../models/agent_org_proposal';
import type { AgentSession, StructuredAgentSessionMessage } from '../models/agent_session';
import { AgentConfigsRepository, type AgentConfig } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository, flattenAgentSessionTree } from '../repositories/agent_sessions_repository';
import { AgentScheduledTasksRepository, type AgentScheduledTask } from '../repositories/agent_scheduled_tasks_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { classifyProposalRisk } from './org_risk_classifier';
import {
  hasSecurityNote,
  requiresSecurityNote,
  validateProposalChange,
} from './org_proposal_apply_service';
import { readAgentConfigField, readScheduledTaskField } from './org_proposal_apply';
import { CONFIG_PATCH_FIELDS, CORE_PERMISSION_NAMES, TASK_PATCH_FIELDS } from './org_diagnosis_types';
import { resolveCoreCapabilitySurface } from './profile_capability_surface';
import { readManagedSkillBody, readManagedSkillBytes } from './rhythm_managed_skills';
import { parseScopeMutation } from './scope_mutation_contract';
import type { TrustedMcpCallIdentity } from '../security/trusted_mcp_call';
import { opencodeClient } from './opencode_engine';
import {
  ORG_REVIEWER_ALLOWED_MCPS_JSON,
  ORG_REVIEWER_ALLOWED_SKILLS_JSON,
  ORG_REVIEWER_CORE_PERMISSIONS_JSON,
  ORG_REVIEWER_PROFILE_ID,
} from './org_reviewer_seed';

export const ORG_REVIEWER_READ_TOOL = 'rhythm_read_org_review_context';
export const ORG_REVIEWER_SUBMIT_TOOL = 'rhythm_submit_org_review_proposal';

const SUPPORTED_KINDS = new Set([
  'refine-config',
  'refine-scope',
  'refine-skill',
  'refine-task',
]);
const ALL_PROPOSAL_STATUSES = [
  'proposed', 'sandbox-running', 'sandbox-vetted', 'pending', 'approved',
  'rejected', 'applied', 'measuring', 'active', 'reverted', 'failed',
  'reconciliation-required',
];
// The engine truncates MCP tool output at 50 KiB. Keep the complete fenced JSON
// below that hard boundary so hashes and evidence references are never cut.
const MAX_TRANSCRIPT_BYTES = 14_000;
const MAX_CONTEXT_BYTES = 44_000;
const MAX_SUBMISSION_BYTES = 64 * 1024;
const MAX_EVIDENCE_QUOTE = 4_000;
const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 14;
const REVIEW_PIPELINE_PROFILE_IDS = new Set([
  ORG_REVIEWER_PROFILE_ID,
  'org-optimizer',
  'org-external-discovery',
  '8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f',
  '9a2d3e4f-5b6c-4d7e-8f9a-1b2c3d4e5f6a',
]);

type JsonRecord = Record<string, unknown>;

export interface AuthorizedOrgReviewer {
  session: AgentSession;
  ownerUserId: number | null;
}

interface CurrentTarget {
  targetRef: string;
  targetRevision: number | string;
  targetStateHash: string;
  state: JsonRecord;
}

interface EvidenceInput {
  sessionId: string;
  messageId: string;
  quote: string;
}

interface CurrentStateInput {
  targetRevision: number | string;
  targetStateHash: string;
  checks: Array<{ source: string; ref: string; observed: string }>;
}

interface VerificationPlanInput {
  steps: string[];
  expectedOutcome: string;
  rollback: string;
  risk: string;
}

interface SubmissionInput {
  kind: string;
  title: string;
  rationale: string;
  evidence: EvidenceInput[];
  targetRef: string;
  change: JsonRecord;
  currentState: CurrentStateInput;
  confidence: number;
  dedupKey: string;
  verificationPlan: VerificationPlanInput;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: JsonRecord, keys: readonly string[], label: string): void {
  const extras = Object.keys(value).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (extras.length > 0 || missing.length > 0) {
    throw AppError.badRequest(`${label} must use the closed reviewer schema`);
  }
}

function exactString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.trim() !== value) {
    throw AppError.badRequest(`${label} must be an exact non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw AppError.badRequest('Reviewer payload contains a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw AppError.badRequest(`Reviewer payload contains unsupported ${typeof value} data`);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('base64url');
}

function parseJsonObject(raw: string | null): JsonRecord {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(raw: string | null): JsonRecord {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeRootCauseKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function ownerCanRead(ownerUserId: number | null, rowOwnerUserId: number | null): boolean {
  return ownerUserId === null ? rowOwnerUserId === null : rowOwnerUserId === null || rowOwnerUserId === ownerUserId;
}

function stableConfig(config: AgentConfig): JsonRecord {
  return {
    id: config.id,
    label: config.label,
    enabled: config.enabled,
    isAgent: config.isAgent,
    isManager: config.isManager,
    sessionSelectable: config.sessionSelectable,
    schedulable: config.schedulable ?? config.sessionSelectable,
    systemPrompt: config.systemPrompt,
    model: { providerId: config.modelProvider, modelId: config.modelId },
    allowedMcps: parseJsonObject(config.allowedMcpsJson),
    allowedSkills: parseJsonArray(config.allowedSkillsJson),
    corePermissions: parseJsonObject(config.corePermissionsJson),
    allowedDelegates: parseJsonArray(config.allowedDelegatesJson),
    coreCapabilitySurface: resolveCoreCapabilitySurface(config),
    revision: config.revision ?? 0,
  };
}

function profileSummary(config: AgentConfig): JsonRecord {
  const stable = stableConfig(config);
  return {
    ...stable,
    systemPrompt: typeof config.systemPrompt === 'string'
      ? config.systemPrompt.slice(0, 4_000)
      : config.systemPrompt,
  };
}

function stableSchedule(task: AgentScheduledTask): JsonRecord {
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    scheduleType: task.scheduleType,
    scheduledTime: task.scheduledTime,
    scheduledDay: task.scheduledDay,
    cronExpression: task.cronExpression,
    runAt: task.runAt,
    timezone: task.timezone,
    prompt: task.prompt,
    agentKind: task.agentKind,
    agentConfigId: task.agentConfigId,
    modelProvider: task.modelProvider,
    modelId: task.modelId,
    allowedMcps: parseJsonObject(task.allowedMcpsJson),
    allowedSkills: parseJsonArray(task.allowedSkillsJson),
    enabled: task.enabled,
    createdByUserId: task.createdByUserId,
  };
}

function scheduleSummary(task: AgentScheduledTask): JsonRecord {
  return {
    ...stableSchedule(task),
    prompt: task.prompt.slice(0, 300),
    promptTruncated: task.prompt.length > 300,
  };
}

function projectedAgentFile(profileId: string): JsonRecord {
  const location = join(homedir(), '.config', 'opencode', 'agents', `${profileId}.md`);
  if (!existsSync(location)) return { present: false, sha256: null, content: null };
  const content = readFileSync(location, 'utf8');
  return {
    present: true,
    sha256: createHash('sha256').update(content).digest('base64url'),
    content: content.slice(0, 16_000),
    truncated: content.length > 16_000,
  };
}

function messageText(message: StructuredAgentSessionMessage): string {
  return message.strippedText || message.rawText;
}

function stableDispatch(session: AgentSession): JsonRecord {
  return {
    sessionId: session.id,
    profileId: session.profileId,
    opencodeAgentId: session.opencodeAgentId,
    scheduledTaskId: session.scheduledTaskId,
    providerId: session.providerId,
    modelId: session.modelId,
  };
}

function reviewableSessionPool(repository: AgentSessionsRepository, limit: number): AgentSession[] {
  const combined = [
    ...flattenAgentSessionTree(repository.listAll(limit, { includeArchived: true, scope: 'chats' })),
    ...flattenAgentSessionTree(repository.listAll(limit, { includeArchived: true, scope: 'scheduled' })),
  ];
  const unique = [...new Map(combined.map((session) => [session.id, session])).values()];
  return unique.sort((a, b) => {
    const aTime = Date.parse(a.lastActivityAt ?? a.updatedAt ?? a.createdAt);
    const bTime = Date.parse(b.lastActivityAt ?? b.updatedAt ?? b.createdAt);
    return bTime - aTime;
  }).slice(0, limit);
}

function exactReviewerScopes(config: AgentConfig): boolean {
  const mcps = parseJsonObject(config.allowedMcpsJson);
  const skills = parseJsonArray(config.allowedSkillsJson);
  const core = parseJsonObject(config.corePermissionsJson);
  return canonicalJson(mcps) === canonicalJson(JSON.parse(ORG_REVIEWER_ALLOWED_MCPS_JSON)) &&
    canonicalJson(skills) === canonicalJson(JSON.parse(ORG_REVIEWER_ALLOWED_SKILLS_JSON)) &&
    canonicalJson(core) === canonicalJson(JSON.parse(ORG_REVIEWER_CORE_PERMISSIONS_JSON));
}

function stableStringLeaves(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === 'string') result.add(value);
  else if (Array.isArray(value)) value.forEach((entry) => stableStringLeaves(entry, result));
  else if (isRecord(value)) Object.values(value).forEach((entry) => stableStringLeaves(entry, result));
  return result;
}

function parseContextArguments(value: JsonRecord): {
  windowDays: number;
  sessionLimit: number;
  targetRef?: string;
} {
  const allowed = ['windowDays', 'sessionLimit', 'targetRef'];
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw AppError.badRequest('Reviewer context request contains unsupported fields');
  const windowDays = value.windowDays ?? DEFAULT_WINDOW_DAYS;
  const sessionLimit = value.sessionLimit ?? 40;
  if (!Number.isSafeInteger(windowDays) || Number(windowDays) < 1 || Number(windowDays) > MAX_WINDOW_DAYS) {
    throw AppError.badRequest(`windowDays must be an integer between 1 and ${MAX_WINDOW_DAYS}`);
  }
  if (!Number.isSafeInteger(sessionLimit) || Number(sessionLimit) < 1 || Number(sessionLimit) > 100) {
    throw AppError.badRequest('sessionLimit must be an integer between 1 and 100');
  }
  const targetRef = value.targetRef === undefined || value.targetRef === null
    ? undefined
    : exactString(value.targetRef, 'targetRef', 300);
  return { windowDays: Number(windowDays), sessionLimit: Number(sessionLimit), ...(targetRef ? { targetRef } : {}) };
}

function parseSubmission(value: JsonRecord): SubmissionInput {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_SUBMISSION_BYTES) {
    throw AppError.badRequest('Reviewer proposal payload is too large');
  }
  assertExactKeys(value, [
    'kind', 'title', 'rationale', 'evidence', 'targetRef', 'change',
    'currentState', 'confidence', 'dedupKey', 'verificationPlan',
  ], 'Reviewer proposal');
  const kind = exactString(value.kind, 'kind', 100);
  if (!SUPPORTED_KINDS.has(kind)) throw AppError.badRequest(`Unsupported reviewer proposal kind '${kind}'`);
  const title = exactString(value.title, 'title', 240);
  const rationale = exactString(value.rationale, 'rationale', 4_000);
  const targetRef = exactString(value.targetRef, 'targetRef', 300);
  const dedupKey = exactString(value.dedupKey, 'dedupKey', 300);
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence <= 0 || value.confidence > 1) {
    throw AppError.badRequest('confidence must be greater than 0 and at most 1');
  }
  if (!Array.isArray(value.evidence) || value.evidence.length < 2 || value.evidence.length > 10) {
    throw AppError.badRequest('Reviewer proposals require 2 to 10 evidence occurrences');
  }
  const evidence = value.evidence.map((entry, index) => {
    if (!isRecord(entry)) throw AppError.badRequest(`evidence[${index}] must be an object`);
    assertExactKeys(entry, ['sessionId', 'messageId', 'quote'], `evidence[${index}]`);
    return {
      sessionId: exactString(entry.sessionId, `evidence[${index}].sessionId`, 200),
      messageId: exactString(entry.messageId, `evidence[${index}].messageId`, 200),
      quote: exactString(entry.quote, `evidence[${index}].quote`, MAX_EVIDENCE_QUOTE),
    };
  });
  if (new Set(evidence.map((item) => item.sessionId)).size !== evidence.length) {
    throw AppError.badRequest('Reviewer evidence occurrences must come from distinct sessions');
  }
  if (!isRecord(value.change)) throw AppError.badRequest('change must be an object');
  if (!isRecord(value.currentState)) throw AppError.badRequest('currentState must be an object');
  assertExactKeys(value.currentState, ['targetRevision', 'targetStateHash', 'checks'], 'currentState');
  const targetRevision = value.currentState.targetRevision;
  if (!(typeof targetRevision === 'string' || (typeof targetRevision === 'number' && Number.isSafeInteger(targetRevision)))) {
    throw AppError.badRequest('currentState.targetRevision must be a stable revision');
  }
  const targetStateHash = exactString(value.currentState.targetStateHash, 'currentState.targetStateHash', 200);
  if (!Array.isArray(value.currentState.checks) || value.currentState.checks.length < 1 || value.currentState.checks.length > 20) {
    throw AppError.badRequest('currentState.checks must contain 1 to 20 observations');
  }
  const checks = value.currentState.checks.map((entry, index) => {
    if (!isRecord(entry)) throw AppError.badRequest(`currentState.checks[${index}] must be an object`);
    assertExactKeys(entry, ['source', 'ref', 'observed'], `currentState.checks[${index}]`);
    return {
      source: exactString(entry.source, `currentState.checks[${index}].source`, 100),
      ref: exactString(entry.ref, `currentState.checks[${index}].ref`, 300),
      observed: exactString(entry.observed, `currentState.checks[${index}].observed`, 4_000),
    };
  });
  if (!isRecord(value.verificationPlan)) throw AppError.badRequest('verificationPlan must be an object');
  assertExactKeys(value.verificationPlan, ['steps', 'expectedOutcome', 'rollback', 'risk'], 'verificationPlan');
  if (!Array.isArray(value.verificationPlan.steps) || value.verificationPlan.steps.length < 1 || value.verificationPlan.steps.length > 10) {
    throw AppError.badRequest('verificationPlan.steps must contain 1 to 10 steps');
  }
  const steps = value.verificationPlan.steps.map((step, index) => exactString(step, `verificationPlan.steps[${index}]`, 1_000));
  return {
    kind,
    title,
    rationale,
    evidence,
    targetRef,
    change: value.change,
    currentState: { targetRevision, targetStateHash, checks },
    confidence: value.confidence,
    dedupKey,
    verificationPlan: {
      steps,
      expectedOutcome: exactString(value.verificationPlan.expectedOutcome, 'verificationPlan.expectedOutcome', 2_000),
      rollback: exactString(value.verificationPlan.rollback, 'verificationPlan.rollback', 2_000),
      risk: exactString(value.verificationPlan.risk, 'verificationPlan.risk', 2_000),
    },
  };
}

function assertClosedChange(input: SubmissionInput, target: CurrentTarget): void {
  const { kind, change, targetRef } = input;
  if (kind === 'refine-config') {
    assertExactKeys(change, ['configPatch'], 'refine-config change');
    if (!isRecord(change.configPatch)) throw AppError.badRequest('refine-config configPatch must be an object');
    const patch = change.configPatch;
    assertExactKeys(patch, ['agentConfigId', 'field', 'value'], 'refine-config configPatch');
    if (targetRef !== `agent_config:${String(patch.agentConfigId)}` || !(CONFIG_PATCH_FIELDS as readonly unknown[]).includes(patch.field)) {
      throw AppError.badRequest('refine-config change does not match its target');
    }
    const value = exactString(patch.value, 'refine-config configPatch.value', 20_000);
    if (patch.field === 'model' && (!value.includes('/') || value.startsWith('/') || value.endsWith('/'))) {
      throw AppError.badRequest('refine-config model must be an exact provider/model pair');
    }
    if (patch.field === 'allowedDelegatesJson') {
      let delegates: unknown;
      try { delegates = JSON.parse(value); } catch { delegates = null; }
      if (!Array.isArray(delegates) || !delegates.every((entry) => typeof entry === 'string' && entry.trim() === entry && entry.length > 0) || new Set(delegates).size !== delegates.length) {
        throw AppError.badRequest('refine-config allowedDelegatesJson must be a unique string array');
      }
    }
    const config = new AgentConfigsRepository().getById(String(patch.agentConfigId));
    if (!config || readAgentConfigField(config, patch.field as (typeof CONFIG_PATCH_FIELDS)[number]) === patch.value) {
      throw AppError.badRequest('refine-config must describe a concrete change to current state');
    }
    return;
  }
  if (kind === 'refine-scope') {
    assertExactKeys(change, ['scopePatch'], 'refine-scope change');
    const parsed = parseScopeMutation('refine-scope', JSON.stringify(change));
    if (targetRef !== `agent_config:${parsed.agentConfigId}`) {
      throw AppError.badRequest('refine-scope change does not match its target');
    }
    if (parsed.field === 'allowedMcpsJson') {
      const coreNames = new Set(['search', ...CORE_PERMISSION_NAMES].map((name) => name.toLowerCase().replace(/-/g, '_')));
      const invalid = [...(parsed.add ?? []), ...(parsed.remove ?? [])]
        .find((name) => coreNames.has(name.toLowerCase().replace(/-/g, '_')));
      if (invalid) throw AppError.badRequest(`Core capability '${invalid}' cannot be proposed as an MCP grant`);
    }
    return;
  }
  if (kind === 'refine-skill') {
    assertExactKeys(change, ['priorBody', 'revisedBody'], 'refine-skill change');
    const priorBody = typeof change.priorBody === 'string' ? change.priorBody : null;
    const revisedBody = exactString(change.revisedBody, 'refine-skill revisedBody', 40_000);
    const skillState = isRecord(target.state.skill) ? target.state.skill : null;
    if (!skillState || targetRef !== target.targetRef || priorBody !== skillState.body || revisedBody === priorBody) {
      throw AppError.badRequest('refine-skill change does not match current target content');
    }
    return;
  }
  assertExactKeys(change, ['taskPatch'], 'refine-task change');
  if (!isRecord(change.taskPatch)) throw AppError.badRequest('refine-task taskPatch must be an object');
  const patch = change.taskPatch;
  assertExactKeys(patch, ['scheduledTaskId', 'field', 'value'], 'refine-task taskPatch');
  if (targetRef !== `scheduled_task:${String(patch.scheduledTaskId)}` || !(TASK_PATCH_FIELDS as readonly unknown[]).includes(patch.field)) {
    throw AppError.badRequest('refine-task change does not match its target');
  }
  const value = exactString(patch.value, 'refine-task taskPatch.value', 20_000);
  const current = target.state.task;
  if (patch.field === 'scheduledTime' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw AppError.badRequest('refine-task scheduledTime must use HH:mm');
  }
  if (patch.field === 'cronExpression' && !cron.validate(value)) {
    throw AppError.badRequest('refine-task cronExpression must be a valid five-field cron expression');
  }
  if (patch.field === 'agentConfigId') {
    const nextProfile = new AgentConfigsRepository().getById(value);
    if (!nextProfile || !nextProfile.enabled || !(nextProfile.schedulable ?? nextProfile.sessionSelectable)) {
      throw AppError.badRequest('refine-task agentConfigId must name an enabled schedulable profile');
    }
  }
  if (!isRecord(current) || readScheduledTaskField(current as unknown as AgentScheduledTask, patch.field as (typeof TASK_PATCH_FIELDS)[number]) === patch.value) {
    throw AppError.badRequest('refine-task must describe a concrete change to current state');
  }
}

function proposalForValidation(input: SubmissionInput, changeJson: string, provenanceJson: string): AgentOrgProposal {
  const now = new Date().toISOString();
  const risk = classifyProposalRisk({ kind: input.kind, changeJson, external: 0 });
  return {
    id: 'org-reviewer-preflight',
    auditRunId: null,
    kind: input.kind,
    risk,
    external: 0,
    status: 'proposed',
    title: input.title,
    rationale: input.rationale,
    signalRef: JSON.stringify(input.evidence.map(({ sessionId, messageId }) => ({ sessionId, messageId }))),
    targetRef: input.targetRef,
    changeJson,
    beforeSnapshotJson: null,
    provenanceJson,
    dedupKey: null,
    baselineScore: null,
    postScore: null,
    measureReason: null,
    reconciliationReason: null,
    decidedByUserId: null,
    ownerUserId: null,
    diagnosisConfidence: input.confidence,
    diagnosisConfidenceVersion: 'org-reviewer-confidence-v1',
    outcomeStatus: 'unproven',
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export class OrgReviewerService {
  private readonly sessions = new AgentSessionsRepository();
  private readonly messages = new AgentSessionMessagesRepository();
  private readonly configs = new AgentConfigsRepository();
  private readonly schedules = new AgentScheduledTasksRepository();

  async authorize(identity: TrustedMcpCallIdentity): Promise<AuthorizedOrgReviewer> {
    const session = this.sessions.findBySdkSessionId(identity.sdkSessionId);
    if (!session) throw AppError.forbidden('Trusted reviewer session is not registered');
    if (
      identity.agentName !== ORG_REVIEWER_PROFILE_ID ||
      session.profileId !== ORG_REVIEWER_PROFILE_ID ||
      session.opencodeAgentId !== ORG_REVIEWER_PROFILE_ID
    ) {
      throw AppError.forbidden('Trusted call is not owned by the Org Reviewer');
    }
    const profile = this.configs.getById(ORG_REVIEWER_PROFILE_ID);
    if (
      !profile || !profile.enabled || !profile.isAgent || profile.isManager ||
      profile.sessionSelectable || !(profile.schedulable ?? profile.sessionSelectable) ||
      profile.modelProvider !== 'openai' || profile.modelId !== 'gpt-5.6-sol' ||
      !exactReviewerScopes(profile)
    ) {
      throw AppError.forbidden('Org Reviewer profile is not in its least-privilege configuration');
    }
    if (session.permissionMode !== 'default' || session.approvalBypassExplicit) {
      throw AppError.forbidden('Org Reviewer session has an unsafe permission mode');
    }
    if (
      session.mcpAllowedToolsJson !== null &&
      canonicalJson(parseJsonObject(session.mcpAllowedToolsJson)) !== canonicalJson(JSON.parse(ORG_REVIEWER_ALLOWED_MCPS_JSON))
    ) {
      throw AppError.forbidden('Org Reviewer session has a widened MCP scope');
    }
    if (session.scheduledTaskId) {
      const task = await this.schedules.findByIdAsync(session.scheduledTaskId);
      const mcpScopeMatches = task?.allowedMcpsJson === null ||
        canonicalJson(parseJsonObject(task?.allowedMcpsJson ?? null)) === canonicalJson(JSON.parse(ORG_REVIEWER_ALLOWED_MCPS_JSON));
      const skillScopeMatches = task?.allowedSkillsJson === null ||
        canonicalJson(parseJsonArray(task?.allowedSkillsJson ?? null)) === canonicalJson(JSON.parse(ORG_REVIEWER_ALLOWED_SKILLS_JSON));
      if (
        !task || task.agentConfigId !== ORG_REVIEWER_PROFILE_ID || task.agentKind !== 'opencode' ||
        task.createdByUserId !== session.ownerUserId || !mcpScopeMatches || !skillScopeMatches
      ) {
        throw AppError.forbidden('Scheduled reviewer session is not bound to the Org Reviewer');
      }
    }
    return { session, ownerUserId: session.ownerUserId };
  }

  async context(argumentsValue: JsonRecord, reviewer: AuthorizedOrgReviewer): Promise<JsonRecord> {
    const args = parseContextArguments(argumentsValue);
    const cutoff = Date.now() - args.windowDays * 24 * 60 * 60 * 1_000;
    const candidates = reviewableSessionPool(this.sessions, args.sessionLimit).filter((session) => {
      const recentAt = Date.parse(session.lastActivityAt ?? session.updatedAt ?? session.createdAt);
      return recentAt >= cutoff &&
        ownerCanRead(reviewer.ownerUserId, session.ownerUserId) &&
        session.category !== 'self_improvement' &&
        !REVIEW_PIPELINE_PROFILE_IDS.has(String(session.profileId ?? session.opencodeAgentId ?? ''));
    }).slice(0, args.sessionLimit);

    let remainingBytes = MAX_TRANSCRIPT_BYTES;
    const sessions: JsonRecord[] = [];
    for (const session of candidates) {
      const messages: JsonRecord[] = [];
      for (const message of this.messages.listBySessionStructured(session.id, 50)) {
        const text = messageText(message).slice(0, MAX_EVIDENCE_QUOTE);
        const item = {
          messageId: String(message.sdkMessageId ?? message.id),
          role: message.role,
          text,
          truncated: messageText(message).length > text.length,
          createdAt: message.createdAt,
        };
        const bytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
        if (bytes > remainingBytes) break;
        remainingBytes -= bytes;
        messages.push(item);
      }
      sessions.push({
        ...stableDispatch(session),
        name: session.name,
        ownerScope: session.ownerUserId === null ? 'global' : 'reviewer-owner',
        createdAt: session.createdAt,
        messages,
      });
      if (remainingBytes <= 0) break;
    }

    const visibleSchedules = (reviewer.ownerUserId === null
      ? await this.schedules.listAllAsync()
      : await this.schedules.listForOwnerAsync(reviewer.ownerUserId))
      .filter((task) => ownerCanRead(reviewer.ownerUserId, task.createdByUserId));
    const proposalRows = await this.listVisibleProposals(reviewer.ownerUserId);
    const relevantProfileIds = new Set<string>([
      ORG_REVIEWER_PROFILE_ID,
      ...candidates.flatMap((session) => session.profileId === null ? [] : [String(session.profileId)]),
    ]);
    const queue = proposalRows.slice(0, 100).map((proposal) => {
      const changeBytes = proposal.changeJson ?? '';
      const provenance = parseJsonRecord(proposal.provenanceJson);
      return {
        id: proposal.id,
        kind: proposal.kind,
        status: proposal.status,
        title: proposal.title,
        targetRef: proposal.targetRef,
        dedupKey: proposal.dedupKey,
        rootCauseKey: typeof provenance.rootCauseKey === 'string' ? provenance.rootCauseKey : null,
        change: (() => {
          if (!changeBytes || changeBytes.length > 4_000) return null;
          try { return JSON.parse(changeBytes); } catch { return null; }
        })(),
        changeHash: changeBytes ? createHash('sha256').update(changeBytes).digest('base64url') : null,
        changeTruncated: changeBytes.length > 4_000,
      };
    });
    const result: JsonRecord = {
      windowDays: args.windowDays,
      sessionLimit: args.sessionLimit,
      sessions,
      profiles: this.configs.list().filter((profile) => relevantProfileIds.has(profile.id)).map(profileSummary),
      skills: new AgentSkillsRepository().list().map((skill) => ({
        id: skill.id,
        name: skill.title,
        status: skill.status,
        version: skill.version,
      })),
      schedules: visibleSchedules
        .filter((task) => task.agentConfigId === null || relevantProfileIds.has(task.agentConfigId))
        .map(scheduleSummary),
      queue,
    };
    if (args.targetRef) {
      const target = await this.resolveCurrentTarget(args.targetRef, reviewer.ownerUserId);
      result.targetRef = target.targetRef;
      result.targetRevision = target.targetRevision;
      result.targetStateHash = target.targetStateHash;
      result.currentState = target.state;
    } else {
      result.liveCapabilityCatalog = await this.liveCapabilityCatalog();
    }
    if (Buffer.byteLength(JSON.stringify(result, null, 2), 'utf8') > MAX_CONTEXT_BYTES) {
      throw AppError.conflict('Verified reviewer context exceeds the bounded review window');
    }
    return result;
  }

  async submit(argumentsValue: JsonRecord, reviewer: AuthorizedOrgReviewer): Promise<JsonRecord> {
    const input = parseSubmission(argumentsValue);
    const target = await this.resolveCurrentTarget(input.targetRef, reviewer.ownerUserId);
    if (
      input.currentState.targetRevision !== target.targetRevision ||
      input.currentState.targetStateHash !== target.targetStateHash
    ) {
      throw AppError.conflict('Reviewer current-state proof is stale; read the target again');
    }
    const verifiedObservations = stableStringLeaves(target.state);
    const allowedSources = target.state.type === 'agent_config'
      ? new Set(['profile', 'projected-agent-file', 'mcp', 'core', 'schedule', 'dispatch'])
      : target.state.type === 'skill'
        ? new Set(['skill', 'managed-skill'])
        : new Set(['schedule', 'profile', 'dispatch']);
    if (input.currentState.checks.some((check) =>
      check.ref !== target.targetRef || !allowedSources.has(check.source) || !verifiedObservations.has(check.observed))) {
      throw AppError.badRequest('Reviewer current-state checks are not present in the verified target state');
    }
    assertClosedChange(input, target);
    this.verifyEvidence(input.evidence, reviewer.ownerUserId);

    const changeJson = canonicalJson(input.change);
    const rootCauseKey = normalizeRootCauseKey(input.dedupKey);
    const provenanceJson = canonicalJson({
      source: 'org-reviewer',
      humanReviewRequired: true,
      rootCauseKey,
      reviewer: {
        sessionId: reviewer.session.id,
        sdkSessionId: reviewer.session.sdkSessionId,
        agentName: reviewer.session.opencodeAgentId,
      },
      currentState: input.currentState,
      verificationPlan: input.verificationPlan,
    });
    const candidate = proposalForValidation(input, changeJson, provenanceJson);
    const validation = await validateProposalChange(candidate);
    if (!validation.valid) throw AppError.badRequest(validation.reason ?? 'Proposal change is not valid');
    if (requiresSecurityNote(candidate) && !hasSecurityNote(candidate)) {
      throw AppError.badRequest('Proposal requires a security note');
    }

    const canonicalDedupKey = `org-reviewer:v1:${sha256({
      ownerUserId: reviewer.ownerUserId,
      kind: input.kind,
      targetRef: input.targetRef,
      change: input.change,
    })}`;
    const proposals = new AgentOrgProposalsRepository();
    const existing = await proposals.findByDedupKeyAsync(canonicalDedupKey);
    if (existing) return { proposal: agentOrgProposalToJson(existing), duplicate: true };
    const visibleProposals = await this.listVisibleProposals(reviewer.ownerUserId);
    const rootCauseEquivalent = visibleProposals.find((proposal) => {
      if (
        proposal.ownerUserId !== reviewer.ownerUserId ||
        proposal.kind !== input.kind ||
        proposal.targetRef !== input.targetRef
      ) return false;
      const provenance = parseJsonRecord(proposal.provenanceJson);
      const currentState = isRecord(provenance.currentState) ? provenance.currentState : {};
      return provenance.rootCauseKey === rootCauseKey &&
        currentState.targetStateHash === input.currentState.targetStateHash;
    });
    if (rootCauseEquivalent) {
      return { proposal: agentOrgProposalToJson(rootCauseEquivalent), duplicate: true };
    }
    const equivalent = visibleProposals.find((proposal) => {
      if (proposal.kind !== input.kind || proposal.targetRef !== input.targetRef || !proposal.changeJson) return false;
      try { return canonicalJson(JSON.parse(proposal.changeJson)) === changeJson; } catch { return false; }
    });
    if (equivalent) return { proposal: agentOrgProposalToJson(equivalent), duplicate: true };

    const finalTarget = await this.resolveCurrentTarget(input.targetRef, reviewer.ownerUserId);
    if (
      finalTarget.targetRevision !== target.targetRevision ||
      finalTarget.targetStateHash !== target.targetStateHash
    ) {
      throw AppError.conflict('Reviewer target changed during proposal validation');
    }
    const proposalId = randomUUID();
    const created = await proposals.createAsync({
      id: proposalId,
      kind: input.kind,
      risk: classifyProposalRisk({ kind: input.kind, changeJson, external: 0 }),
      external: 0,
      status: 'proposed',
      title: input.title,
      rationale: input.rationale,
      signalRef: canonicalJson(input.evidence.map(({ sessionId, messageId, quote }) => ({ sessionId, messageId, quote }))),
      targetRef: input.targetRef,
      changeJson,
      beforeSnapshotJson: null,
      provenanceJson,
      dedupKey: canonicalDedupKey,
      decidedByUserId: null,
      ownerUserId: reviewer.ownerUserId,
      diagnosisConfidence: input.confidence,
      diagnosisConfidenceVersion: 'org-reviewer-confidence-v1',
    });
    return {
      proposal: agentOrgProposalToJson(created),
      duplicate: created.id !== proposalId,
    };
  }

  private verifyEvidence(evidence: EvidenceInput[], ownerUserId: number | null): void {
    const cutoff = Date.now() - MAX_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
    for (const occurrence of evidence) {
      const session = this.sessions.findById(occurrence.sessionId);
      if (!session || !ownerCanRead(ownerUserId, session.ownerUserId)) {
        throw AppError.forbidden('Reviewer evidence is outside the authorized ownership scope');
      }
      if (
        session.category === 'self_improvement' ||
        REVIEW_PIPELINE_PROFILE_IDS.has(String(session.profileId ?? session.opencodeAgentId ?? ''))
      ) {
        throw AppError.badRequest('Reviewer evidence cannot come from the review or diagnostic pipeline');
      }
      const message = this.messages.listBySessionStructured(session.id, 50).find(
        (candidate) => String(candidate.sdkMessageId ?? candidate.id) === occurrence.messageId,
      );
      if (message && Date.parse(message.createdAt) < cutoff) {
        throw AppError.badRequest('Reviewer evidence is outside the bounded recent window');
      }
      const displayed = message ? messageText(message).slice(0, MAX_EVIDENCE_QUOTE) : '';
      if (!message || !displayed.includes(occurrence.quote)) {
        throw AppError.badRequest('Reviewer evidence could not be verified against the stored transcript');
      }
    }
  }

  private async listVisibleProposals(ownerUserId: number | null): Promise<AgentOrgProposal[]> {
    const proposals = new AgentOrgProposalsRepository();
    return (await Promise.all(
      ALL_PROPOSAL_STATUSES.map((status) => proposals.listByStatusAsync(status)),
    )).flat().filter((proposal) => ownerCanRead(ownerUserId, proposal.ownerUserId));
  }

  private async liveCapabilityCatalog(): Promise<JsonRecord> {
    if (!opencodeClient.isReady) throw AppError.conflict('Current engine capability validation is unavailable');
    const [mcpStatus, mcpToolIds, skills] = await Promise.all([
      opencodeClient.listMcp(),
      opencodeClient.listMcpToolIds(),
      opencodeClient.listSkills(),
    ]);
    const sortedToolIds = [...mcpToolIds].sort();
    const sortedSkills = skills.map((skill) => skill.name).sort();
    return {
      mcpServers: Object.entries(mcpStatus).sort(([a], [b]) => a.localeCompare(b)).map(([name, status]) => ({
        name,
        status: isRecord(status) && typeof status.status === 'string' ? status.status : 'unknown',
      })),
      mcpToolIds: sortedToolIds.slice(0, 150),
      mcpToolCount: sortedToolIds.length,
      mcpToolsTruncated: sortedToolIds.length > 150,
      mcpToolCatalogHash: sha256(sortedToolIds),
      skills: sortedSkills.slice(0, 150),
      skillCount: sortedSkills.length,
      skillsTruncated: sortedSkills.length > 150,
      skillCatalogHash: sha256(sortedSkills),
    };
  }

  private async resolveCurrentTarget(targetRef: string, ownerUserId: number | null): Promise<CurrentTarget> {
    if (targetRef.startsWith('agent_config:')) {
      const id = exactString(targetRef.slice('agent_config:'.length), 'agent config target id', 200);
      const config = this.configs.getById(id);
      if (!config) throw AppError.badRequest('Reviewer target does not exist');
      const schedules = (ownerUserId === null
        ? await this.schedules.listAllAsync()
        : await this.schedules.listForOwnerAsync(ownerUserId))
        .filter((task) => task.agentConfigId === id && ownerCanRead(ownerUserId, task.createdByUserId))
        .map(stableSchedule);
      const dispatches = reviewableSessionPool(this.sessions, 100)
        .filter((session) => session.profileId === id && ownerCanRead(ownerUserId, session.ownerUserId))
        .slice(0, 20)
        .map(stableDispatch);
      const boundSkills = parseJsonArray(config.allowedSkillsJson)
        .filter((name): name is string => typeof name === 'string')
        .map((name) => {
          const skill = new AgentSkillsRepository().findByName(name);
          const body = readManagedSkillBody(name) ?? skill?.body ?? null;
          return {
            name,
            id: skill?.id ?? null,
            version: skill?.version ?? null,
            status: skill?.status ?? null,
            body: body?.slice(0, 12_000) ?? null,
            bodyTruncated: (body?.length ?? 0) > 12_000,
            bodyHash: body === null ? null : sha256(body),
          };
        });
      const state = {
        type: 'agent_config',
        profile: stableConfig(config),
        projectedAgentFile: projectedAgentFile(id),
        schedules,
        dispatches,
        boundSkills,
        liveCapabilityCatalog: await this.liveCapabilityCatalog(),
      };
      return {
        targetRef,
        targetRevision: config.revision ?? 0,
        targetStateHash: sha256(state),
        state,
      };
    }
    if (targetRef.startsWith('skill:')) {
      const idOrName = exactString(targetRef.slice('skill:'.length), 'skill target id', 200);
      const repo = new AgentSkillsRepository();
      const skill = repo.getById(idOrName) ?? repo.findByName(idOrName);
      if (!skill) throw AppError.badRequest('Reviewer target does not exist');
      const file = readManagedSkillBytes(skill.title);
      const content = readManagedSkillBody(skill.title) ?? skill.body ?? '';
      const state = {
        type: 'skill',
        skill: {
          id: skill.id,
          name: skill.title,
          status: skill.status,
          description: skill.description,
          whenToUse: skill.whenToUse,
          body: content,
          version: skill.version,
        },
        managedFile: {
          present: file !== null,
          sha256: file ? createHash('sha256').update(file).digest('base64url') : null,
        },
        liveCapabilityCatalog: await this.liveCapabilityCatalog(),
      };
      return {
        targetRef: `skill:${skill.id}`,
        targetRevision: skill.version ?? 0,
        targetStateHash: sha256(state),
        state,
      };
    }
    if (targetRef.startsWith('scheduled_task:')) {
      const id = exactString(targetRef.slice('scheduled_task:'.length), 'scheduled task target id', 200);
      const task = await this.schedules.findByIdAsync(id);
      if (!task || !ownerCanRead(ownerUserId, task.createdByUserId)) {
        throw AppError.forbidden('Reviewer scheduled-task target is outside the authorized ownership scope');
      }
      const profile = task.agentConfigId ? this.configs.getById(task.agentConfigId) : null;
      const state = {
        type: 'scheduled_task',
        task: stableSchedule(task),
        boundProfile: profile ? stableConfig(profile) : null,
        projectedAgentFile: profile ? projectedAgentFile(profile.id) : null,
        liveCapabilityCatalog: await this.liveCapabilityCatalog(),
      };
      return {
        targetRef,
        targetRevision: task.updatedAt,
        targetStateHash: sha256(state),
        state,
      };
    }
    throw AppError.badRequest('Reviewer targetRef uses an unsupported target type');
  }
}
