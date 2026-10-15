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
import { scanContextContent } from '../security/context_scanner';
import { opencodeClient } from './opencode_engine';
import {
  ORG_REVIEWER_ALLOWED_MCPS_JSON,
  ORG_REVIEWER_ALLOWED_SKILLS_JSON,
  ORG_REVIEWER_CORE_PERMISSIONS_JSON,
  ORG_REVIEWER_PROFILE_ID,
} from './org_reviewer_seed';

export const ORG_REVIEWER_READ_TOOL = 'rhythm_read_org_review_context';
export const ORG_REVIEWER_SUBMIT_TOOL = 'rhythm_submit_org_review_proposal';
export const ORG_REVIEWER_SESSION_TOOL = 'rhythm_read_org_review_session';
export const ORG_REVIEWER_CATALOG_TOOL = 'rhythm_read_org_review_catalog';

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
// The engine truncates MCP tool output at 50 KiB. The overview carries only a
// compact session index; transcripts are read one session at a time through
// ORG_REVIEWER_SESSION_TOOL in pages of at most MAX_SESSION_PAGE_BYTES, so no
// response ever needs clipping. Both leave headroom for the MCP fence.
const MAX_CONTEXT_BYTES = 44_000;
// Target-state pages are deliberately smaller than the overview. This leaves
// more than 11 KiB for the MCP untrusted-content fence below its 50 KiB cap.
const MAX_TARGET_STATE_PAGE_BYTES = 40_000;
const MAX_SESSION_PAGE_BYTES = 40_000;
// Messages per session the reviewer may read and cite (the verified view).
const REVIEW_MESSAGE_LIMIT = 200;
const MAX_INDEX_NAME_CHARS = 60;
const CATALOG_KINDS = ['profiles', 'schedules', 'queue', 'skills', 'mcpTools', 'liveSkills'] as const;
const MAX_SUBMISSION_BYTES = 64 * 1024;
const MAX_EVIDENCE_QUOTE = 4_000;
const DEFAULT_WINDOW_DAYS = 7;
const MAX_SESSION_LIMIT = 100;
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

interface CollectionStats {
  total: number;
  included: number;
  omitted: number;
  truncated: boolean;
  /** Omitted only because the serialized response/transcript byte budget was spent. */
  omittedByByteBudget: number;
  /** Sessions only: omitted because they have no stored messages to cite. */
  omittedWithoutMessages?: number;
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

function collectionStats(total: number, included = 0, omittedWithoutMessages?: number): CollectionStats {
  const omitted = total - included;
  return {
    total, included, omitted, truncated: included < total,
    omittedByByteBudget: omitted - (omittedWithoutMessages ?? 0),
    ...(omittedWithoutMessages === undefined ? {} : { omittedWithoutMessages }),
  };
}

/** Bytes of the compact JSON the MCP layer actually emits. */
function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function toolErrorCount(messages: StructuredAgentSessionMessage[]): number {
  let count = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (isRecord(part) && part.type === 'tool' && isRecord(part.state) && part.state.status === 'error') count += 1;
    }
  }
  return count;
}

/**
 * End index of the longest slice of `text` from `start` whose JSON-escaped
 * UTF-8 size fits `budget`. Never splits a surrogate pair.
 */
function isUnicodeSafeOffset(text: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function fitText(text: string, start: number, budget: number): number {
  let bytes = 0;
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    const next = text.charCodeAt(index + 1);
    const width = code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
    const cost = Buffer.byteLength(JSON.stringify(text.slice(index, index + width)), 'utf8') - 2;
    if (bytes + cost > budget) break;
    bytes += cost;
    index += width;
  }
  return index;
}

interface SessionCursor { sessionId: string; messageId: string; offset: number }

/**
 * An opaque, stateless page binding. It is deliberately not an authorization
 * credential: every request still has to pass the engine-signed tool-argument
 * check and current reviewer/owner authorization before this is considered.
 */
interface TargetStateCursor {
  version: 1;
  targetRef: string;
  ownerUserId: number | null;
  windowDays: number;
  sessionLimit: number;
  targetRevision: number | string;
  targetStateHash: string;
  offset: number;
}

interface ContextArguments {
  windowDays: number;
  sessionLimit: number;
  targetRef?: string;
  targetCursor?: TargetStateCursor;
}

function encodeCursor(cursor: SessionCursor): string {
  return Buffer.from(JSON.stringify([cursor.sessionId, cursor.messageId, cursor.offset]), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): SessionCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) && parsed.length === 3 && typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' && Number.isSafeInteger(parsed[2]) && parsed[2] >= 0
    ) {
      return { sessionId: parsed[0], messageId: parsed[1], offset: parsed[2] };
    }
  } catch { /* fall through */ }
  throw AppError.badRequest('cursor must be a nextCursor value returned by this tool');
}

function isStableRevision(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value);
}

function encodeTargetStateCursor(cursor: TargetStateCursor): string {
  return Buffer.from(JSON.stringify([
    cursor.version,
    cursor.targetRef,
    cursor.ownerUserId,
    cursor.windowDays,
    cursor.sessionLimit,
    cursor.targetRevision,
    cursor.targetStateHash,
    cursor.offset,
  ]), 'utf8').toString('base64url');
}

function decodeTargetStateCursor(raw: string): TargetStateCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 8) throw new Error('invalid cursor');
    const [version, targetRef, ownerUserId, windowDays, sessionLimit, targetRevision, targetStateHash, offset] = parsed;
    if (
      version === 1 &&
      typeof targetRef === 'string' && targetRef.length > 0 && targetRef.length <= 300 && targetRef.trim() === targetRef &&
      (ownerUserId === null || (typeof ownerUserId === 'number' && Number.isSafeInteger(ownerUserId))) &&
      typeof windowDays === 'number' && Number.isSafeInteger(windowDays) && windowDays >= 1 && windowDays <= MAX_WINDOW_DAYS &&
      typeof sessionLimit === 'number' && Number.isSafeInteger(sessionLimit) && sessionLimit >= 1 && sessionLimit <= MAX_SESSION_LIMIT &&
      isStableRevision(targetRevision) &&
      typeof targetStateHash === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(targetStateHash) &&
      typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0
    ) {
      return {
        version,
        targetRef,
        ownerUserId,
        windowDays,
        sessionLimit,
        targetRevision,
        targetStateHash,
        offset,
      };
    }
  } catch { /* fall through */ }
  throw AppError.badRequest('targetCursor must be a bounded nextCursor value returned by this tool');
}

function fitCollection(
  result: JsonRecord,
  destination: unknown[],
  items: unknown[],
  updateStats: (included: number) => void,
): void {
  // Skip (do not stop at) an item that does not fit, so one oversized entry
  // cannot hide every smaller entry after it. Order stays deterministic.
  for (const item of items) {
    destination.push(item);
    updateStats(destination.length);
    if (jsonBytes(result) < MAX_CONTEXT_BYTES) continue;
    destination.pop();
    updateStats(destination.length);
  }
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

function hasNoReviewerDelegates(config: AgentConfig): boolean {
  try {
    return canonicalJson(JSON.parse(config.allowedDelegatesJson ?? 'null')) === canonicalJson([]);
  } catch {
    return false;
  }
}

function stableStringLeaves(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === 'string') result.add(value);
  else if (Array.isArray(value)) value.forEach((entry) => stableStringLeaves(entry, result));
  else if (isRecord(value)) Object.values(value).forEach((entry) => stableStringLeaves(entry, result));
  return result;
}

function parseContextArguments(value: JsonRecord): ContextArguments {
  const allowed = ['windowDays', 'sessionLimit', 'targetRef', 'targetCursor'];
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw AppError.badRequest('Reviewer context request contains unsupported fields');
  const windowDays = value.windowDays ?? DEFAULT_WINDOW_DAYS;
  const sessionLimit = value.sessionLimit ?? 40;
  if (!Number.isSafeInteger(windowDays) || Number(windowDays) < 1 || Number(windowDays) > MAX_WINDOW_DAYS) {
    throw AppError.badRequest(`windowDays must be an integer between 1 and ${MAX_WINDOW_DAYS}`);
  }
  if (!Number.isSafeInteger(sessionLimit) || Number(sessionLimit) < 1 || Number(sessionLimit) > MAX_SESSION_LIMIT) {
    throw AppError.badRequest(`sessionLimit must be an integer between 1 and ${MAX_SESSION_LIMIT}`);
  }
  const targetRef = value.targetRef === undefined || value.targetRef === null
    ? undefined
    : exactString(value.targetRef, 'targetRef', 300);
  const targetCursor = value.targetCursor === undefined || value.targetCursor === null
    ? undefined
    : decodeTargetStateCursor(exactString(value.targetCursor, 'targetCursor', 2_000));
  if (targetCursor && !targetRef) {
    throw AppError.badRequest('targetCursor requires the exact targetRef from the previous page');
  }
  return {
    windowDays: Number(windowDays),
    sessionLimit: Number(sessionLimit),
    ...(targetRef ? { targetRef } : {}),
    ...(targetCursor ? { targetCursor } : {}),
  };
}

function parseSessionArguments(value: JsonRecord): { sessionId: string; cursor?: SessionCursor } {
  const extras = Object.keys(value).filter((key) => key !== 'sessionId' && key !== 'cursor');
  if (extras.length > 0) throw AppError.badRequest('Reviewer session request contains unsupported fields');
  const sessionId = exactString(value.sessionId, 'sessionId', 200);
  if (value.cursor === undefined || value.cursor === null) return { sessionId };
  const cursor = decodeCursor(exactString(value.cursor, 'cursor', 2_000));
  if (cursor.sessionId !== sessionId) throw AppError.badRequest('cursor belongs to a different session');
  return { sessionId, cursor };
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
      !profile || !profile.enabled || !profile.isAgent || profile.isManager || profile.locked ||
      profile.imageGenerationEnabled || profile.autoApproveActions ||
      !profile.schedulable || !hasNoReviewerDelegates(profile) ||
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

  /**
   * The only sessions a reviewer may see: recent, owner-readable, and outside
   * the review/diagnostic pipeline. Both the index and the per-session read
   * route through this so a session outside it is never readable.
   */
  private reviewableSessions(windowDays: number, sessionLimit: number, ownerUserId: number | null): AgentSession[] {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1_000;
    return reviewableSessionPool(this.sessions, sessionLimit).filter((session) => {
      const recentAt = Date.parse(session.lastActivityAt ?? session.updatedAt ?? session.createdAt);
      return recentAt >= cutoff &&
        ownerCanRead(ownerUserId, session.ownerUserId) &&
        session.category !== 'self_improvement' &&
        !REVIEW_PIPELINE_PROFILE_IDS.has(String(session.profileId ?? session.opencodeAgentId ?? ''));
    }).slice(0, sessionLimit);
  }

  private reviewMessages(sessionId: string): StructuredAgentSessionMessage[] {
    return this.messages.listBySessionStructured(sessionId, REVIEW_MESSAGE_LIMIT);
  }

  /** Configuration collections shown next to the session index (overview and catalog pages). */
  private async overviewCollections(candidates: AgentSession[], ownerUserId: number | null): Promise<{
    profiles: JsonRecord[]; skills: JsonRecord[]; schedules: JsonRecord[]; queue: JsonRecord[];
  }> {
    const visibleSchedules = (ownerUserId === null
      ? await this.schedules.listAllAsync()
      : await this.schedules.listForOwnerAsync(ownerUserId))
      .filter((task) => ownerCanRead(ownerUserId, task.createdByUserId));
    const proposalRows = await this.listVisibleProposals(ownerUserId);
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
    const profiles = this.configs.list()
      .filter((profile) => relevantProfileIds.has(profile.id))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(profileSummary);
    const skills = new AgentSkillsRepository().list()
      .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
      .map((skill) => ({
        id: skill.id,
        name: skill.title,
        status: skill.status,
        version: skill.version,
      }));
    const schedules = visibleSchedules
      .filter((task) => task.agentConfigId === null || relevantProfileIds.has(task.agentConfigId))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(scheduleSummary);
    return { profiles, skills, schedules, queue };
  }

  private assertTargetStateCursor(
    cursor: TargetStateCursor,
    args: ContextArguments,
    target: CurrentTarget,
    canonicalState: string,
    reviewer: AuthorizedOrgReviewer,
  ): void {
    if (
      !args.targetRef ||
      cursor.targetRef !== args.targetRef ||
      cursor.targetRef !== target.targetRef ||
      cursor.ownerUserId !== reviewer.ownerUserId ||
      cursor.windowDays !== args.windowDays ||
      cursor.sessionLimit !== args.sessionLimit
    ) {
      throw AppError.badRequest('targetCursor does not match this target review request');
    }
    if (
      cursor.targetRevision !== target.targetRevision ||
      cursor.targetStateHash !== target.targetStateHash
    ) {
      throw AppError.conflict('Reviewer current-state page is stale; restart without a targetCursor');
    }
    if (cursor.offset >= canonicalState.length || !isUnicodeSafeOffset(canonicalState, cursor.offset)) {
      throw AppError.badRequest('targetCursor offset is outside a Unicode-safe current-state boundary');
    }
  }

  /**
   * Return a fragment only after scanning both whole-state representations.
   * The legacy complete-target path scans insertion-order JSON.stringify()
   * while pages emit canonical JSON; key sorting can otherwise move the two
   * halves of a cross-field injection pattern apart. Scanning individual
   * fragments would also miss a pattern split at a page boundary, so a blocked
   * target is withheld as a whole rather than partially released or silently
   * skipped.
   */
  private currentStatePage(
    args: ContextArguments,
    target: CurrentTarget,
    canonicalState: string,
    offset: number,
    reviewer: AuthorizedOrgReviewer,
  ): JsonRecord {
    const legacyScan = scanContextContent(JSON.stringify(target.state), 'Org Reviewer current target state');
    const canonicalScan = scanContextContent(canonicalState, 'Org Reviewer canonical current target state');
    if (legacyScan.blocked || canonicalScan.blocked) {
      throw AppError.conflict('Current target validation was withheld by the content safety boundary');
    }
    if (!isUnicodeSafeOffset(canonicalState, offset) || offset >= canonicalState.length) {
      throw AppError.badRequest('targetCursor offset is outside a Unicode-safe current-state boundary');
    }

    const worstCaseCursor = encodeTargetStateCursor({
      version: 1,
      targetRef: target.targetRef,
      ownerUserId: reviewer.ownerUserId,
      windowDays: args.windowDays,
      sessionLimit: args.sessionLimit,
      targetRevision: target.targetRevision,
      targetStateHash: target.targetStateHash,
      offset: Number.MAX_SAFE_INTEGER,
    });
    const currentStatePage: JsonRecord = {
      offset,
      totalChars: canonicalState.length,
      textComplete: false,
      text: '',
      // Measure with the longest possible cursor before adding text. The
      // emitted nextCursor can only be smaller, so JSON stays strictly below
      // the page cap even after escaping and cursor serialization.
      nextCursor: worstCaseCursor,
    };
    const page: JsonRecord = {
      windowDays: args.windowDays,
      sessionLimit: args.sessionLimit,
      targetRef: target.targetRef,
      targetRevision: target.targetRevision,
      targetStateHash: target.targetStateHash,
      currentStatePage,
    };
    const textBudget = MAX_TARGET_STATE_PAGE_BYTES - jsonBytes(page) - 1;
    const end = fitText(canonicalState, offset, Math.max(textBudget, 0));
    if (end <= offset) {
      throw AppError.conflict('Verified current target state cannot produce a bounded page');
    }
    currentStatePage.text = canonicalState.slice(offset, end);
    currentStatePage.textComplete = end === canonicalState.length;
    currentStatePage.nextCursor = end < canonicalState.length
      ? encodeTargetStateCursor({
        version: 1,
        targetRef: target.targetRef,
        ownerUserId: reviewer.ownerUserId,
        windowDays: args.windowDays,
        sessionLimit: args.sessionLimit,
        targetRevision: target.targetRevision,
        targetStateHash: target.targetStateHash,
        offset: end,
      })
      : null;
    if (jsonBytes(page) >= MAX_TARGET_STATE_PAGE_BYTES) {
      throw AppError.conflict('Verified current target state cannot produce a bounded page');
    }
    return page;
  }

  async context(argumentsValue: JsonRecord, reviewer: AuthorizedOrgReviewer): Promise<JsonRecord> {
    const args = parseContextArguments(argumentsValue);
    if (args.targetCursor) {
      // A continuation never recomputes/returns overview data. It re-resolves
      // the complete target first so a changed skill or live catalog cannot be
      // mixed with a fragment from an earlier state.
      const target = await this.resolveCurrentTarget(args.targetRef!, reviewer.ownerUserId);
      const canonicalState = canonicalJson(target.state);
      this.assertTargetStateCursor(args.targetCursor, args, target, canonicalState, reviewer);
      return this.currentStatePage(args, target, canonicalState, args.targetCursor.offset, reviewer);
    }
    const candidates = this.reviewableSessions(args.windowDays, args.sessionLimit, reviewer.ownerUserId);

    // A compact index only: transcripts are read through the session tool.
    let omittedWithoutMessages = 0;
    const sessionIndex: JsonRecord[] = [];
    for (const session of candidates) {
      const sourceMessages = this.reviewMessages(session.id);
      if (sourceMessages.length === 0) {
        omittedWithoutMessages += 1;
        continue;
      }
      sessionIndex.push({
        sessionId: session.id,
        profileId: session.profileId,
        scheduledTaskId: session.scheduledTaskId,
        name: session.name.slice(0, MAX_INDEX_NAME_CHARS),
        lastActivityAt: session.lastActivityAt ?? session.updatedAt,
        status: session.status,
        messageCount: sourceMessages.length,
        textChars: sourceMessages.reduce((sum, message) => sum + messageText(message).length, 0),
        toolErrors: toolErrorCount(sourceMessages),
      });
    }

    const { profiles, skills, schedules, queue } = await this.overviewCollections(candidates, reviewer.ownerUserId);
    const collectionTotals = {
      sessions: candidates.length,
      profiles: profiles.length,
      skills: skills.length,
      schedules: schedules.length,
      queue: queue.length,
    };
    const statsFor = (name: keyof typeof collectionTotals, included: number) =>
      collectionStats(collectionTotals[name], included, name === 'sessions' ? omittedWithoutMessages : undefined);
    const stats: Record<string, CollectionStats> = Object.fromEntries(
      (Object.keys(collectionTotals) as Array<keyof typeof collectionTotals>).map((name) => [name, statsFor(name, 0)]),
    );
    const result: JsonRecord = {
      windowDays: args.windowDays,
      sessionLimit: args.sessionLimit,
      sessions: [],
      profiles: [],
      skills: [],
      schedules: [],
      queue: [],
      collectionStats: stats,
    };
    let boundedCatalog: JsonRecord | null = null;
    let mcpToolIds: string[] = [];
    let liveSkills: string[] = [];
    let target: CurrentTarget | null = null;
    if (args.targetRef) {
      target = await this.resolveCurrentTarget(args.targetRef, reviewer.ownerUserId);
      result.targetRef = target.targetRef;
      result.targetRevision = target.targetRevision;
      result.targetStateHash = target.targetStateHash;
      result.currentState = target.state;
    } else {
      const catalog = await this.liveCapabilityCatalog();
      mcpToolIds = catalog.mcpToolIds as string[];
      liveSkills = catalog.skills as string[];
      result.liveCapabilityCatalog = {
        ...catalog,
        mcpToolIds: [],
        mcpToolIncluded: 0,
        mcpToolOmitted: catalog.mcpToolCount,
        mcpToolsTruncated: Number(catalog.mcpToolCount) > 0,
        skills: [],
        skillIncluded: 0,
        skillOmitted: catalog.skillCount,
        skillsTruncated: Number(catalog.skillCount) > 0,
      };
      boundedCatalog = result.liveCapabilityCatalog as JsonRecord;
    }
    if (jsonBytes(result) >= MAX_CONTEXT_BYTES) {
      if (target) {
        return this.currentStatePage(args, target, canonicalJson(target.state), 0, reviewer);
      }
      throw AppError.conflict('Verified reviewer context exceeds the bounded review window');
    }
    const fit = (name: keyof typeof collectionTotals, items: unknown[]) => {
      fitCollection(result, result[name] as unknown[], items, (included) => {
        stats[name] = statsFor(name, included);
      });
    };
    // The session index is the reviewer's map of evidence: admit it first,
    // then configuration and catalogs share what remains.
    fit('sessions', sessionIndex);
    fit('profiles', profiles);
    fit('schedules', schedules);
    fit('queue', queue);
    fit('skills', skills);
    if (boundedCatalog) {
      fitCollection(result, boundedCatalog.mcpToolIds as unknown[], mcpToolIds, (included) => {
        boundedCatalog!.mcpToolIncluded = included;
        boundedCatalog!.mcpToolOmitted = Number(boundedCatalog!.mcpToolCount) - included;
        boundedCatalog!.mcpToolsTruncated = included < Number(boundedCatalog!.mcpToolCount);
      });
      fitCollection(result, boundedCatalog.skills as unknown[], liveSkills, (included) => {
        boundedCatalog!.skillIncluded = included;
        boundedCatalog!.skillOmitted = Number(boundedCatalog!.skillCount) - included;
        boundedCatalog!.skillsTruncated = included < Number(boundedCatalog!.skillCount);
      });
    }
    return result;
  }

  /**
   * One page of one overview collection, for entries the overview omitted by
   * byte budget. Same owner scope and window as the overview with the same
   * windowDays/sessionLimit; whole entries only, in the overview's order.
   */
  async catalog(argumentsValue: JsonRecord, reviewer: AuthorizedOrgReviewer): Promise<JsonRecord> {
    const extras = Object.keys(argumentsValue).filter((key) => !['kind', 'cursor', 'windowDays', 'sessionLimit'].includes(key));
    if (extras.length > 0) throw AppError.badRequest('Reviewer catalog request contains unsupported fields');
    const kind = exactString(argumentsValue.kind, 'kind', 40);
    if (!(CATALOG_KINDS as readonly string[]).includes(kind)) {
      throw AppError.badRequest(`kind must be one of ${CATALOG_KINDS.join(', ')}`);
    }
    const cursor = argumentsValue.cursor ?? null;
    if (cursor !== null && (typeof cursor !== 'string' || !/^(0|[1-9]\d{0,6})$/.test(cursor))) {
      throw AppError.badRequest('cursor must be a nextCursor value returned by this tool');
    }
    const args = parseContextArguments({
      ...(argumentsValue.windowDays === undefined ? {} : { windowDays: argumentsValue.windowDays }),
      ...(argumentsValue.sessionLimit === undefined ? {} : { sessionLimit: argumentsValue.sessionLimit }),
    });
    const page: JsonRecord = { kind, windowDays: args.windowDays, sessionLimit: args.sessionLimit, total: 0, offset: 0, items: [] };
    let all: unknown[];
    if (kind === 'mcpTools' || kind === 'liveSkills') {
      const lists = await this.liveCatalogLists();
      all = kind === 'mcpTools' ? lists.sortedToolIds : lists.sortedSkills;
      page.catalogHash = sha256(all);
    } else {
      const candidates = this.reviewableSessions(args.windowDays, args.sessionLimit, reviewer.ownerUserId);
      all = (await this.overviewCollections(candidates, reviewer.ownerUserId))[kind as 'profiles' | 'skills' | 'schedules' | 'queue'];
    }
    const offset = cursor === null ? 0 : Number(cursor);
    if (offset > all.length) throw AppError.badRequest('cursor is past the end of this collection; restart without a cursor');
    const items = page.items as unknown[];
    page.total = all.length;
    page.offset = offset;
    page.nextCursor = String(Number.MAX_SAFE_INTEGER); // worst-case size while fitting
    let index = offset;
    for (; index < all.length; index++) {
      items.push(all[index]);
      if (jsonBytes(page) < MAX_SESSION_PAGE_BYTES) continue;
      items.pop();
      if (items.length === 0) throw AppError.conflict('A reviewer catalog entry exceeds the bounded page size');
      break;
    }
    page.nextCursor = index < all.length ? String(index) : null;
    return page;
  }

  /**
   * One page of one indexed session's transcript: full message text, never
   * clipped. A message larger than a page continues on the next page from the
   * character offset carried by nextCursor.
   */
  async session(argumentsValue: JsonRecord, reviewer: AuthorizedOrgReviewer): Promise<JsonRecord> {
    const args = parseSessionArguments(argumentsValue);
    // Same scope as the widest index the reviewer can request.
    const session = this.reviewableSessions(MAX_WINDOW_DAYS, MAX_SESSION_LIMIT, reviewer.ownerUserId)
      .find((candidate) => candidate.id === args.sessionId);
    if (!session) throw AppError.notFound('Reviewable session');
    const list = this.reviewMessages(session.id);
    const idOf = (message: StructuredAgentSessionMessage) => String(message.sdkMessageId ?? message.id);
    let index = 0;
    let offset = 0;
    if (args.cursor) {
      const cursor = args.cursor;
      index = list.findIndex((message) => idOf(message) === cursor.messageId);
      if (index < 0 || cursor.offset > messageText(list[index]).length) {
        throw AppError.badRequest('cursor no longer matches the stored transcript; restart without a cursor');
      }
      offset = cursor.offset;
    }
    const messages: JsonRecord[] = [];
    const page: JsonRecord = {
      sessionId: session.id,
      profileId: session.profileId,
      messageCount: list.length,
      messages,
      // Worst-case cursor placeholder, so the size measured below is an upper bound.
      nextCursor: encodeCursor({ sessionId: session.id, messageId: '0'.repeat(200), offset: Number.MAX_SAFE_INTEGER }),
    };
    let next: SessionCursor | null = null;
    for (; index < list.length; index++, offset = 0) {
      const full = messageText(list[index]);
      const item: JsonRecord = {
        messageId: idOf(list[index]),
        role: list[index].role,
        createdAt: list[index].createdAt,
        offset,
        totalChars: full.length,
        textComplete: false,
        text: '',
      };
      messages.push(item);
      const room = MAX_SESSION_PAGE_BYTES - jsonBytes(page);
      // Start a later message on a fresh page rather than emitting a sliver.
      if (messages.length > 1 && room < 2_000) {
        messages.pop();
        next = { sessionId: session.id, messageId: idOf(list[index]), offset };
        break;
      }
      const end = fitText(full, offset, Math.max(room, 0));
      item.text = full.slice(offset, end);
      item.textComplete = end === full.length;
      if (end < full.length) {
        next = { sessionId: session.id, messageId: idOf(list[index]), offset: end };
        break;
      }
    }
    page.nextCursor = next ? encodeCursor(next) : null;
    return page;
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
      const message = this.reviewMessages(session.id).find(
        (candidate) => String(candidate.sdkMessageId ?? candidate.id) === occurrence.messageId,
      );
      if (message && Date.parse(message.createdAt) < cutoff) {
        throw AppError.badRequest('Reviewer evidence is outside the bounded recent window');
      }
      // The full message text: exactly what the session tool pages out.
      const displayed = message ? messageText(message) : '';
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

  private async liveCatalogLists(): Promise<{ mcpStatus: JsonRecord; sortedToolIds: string[]; sortedSkills: string[] }> {
    if (!opencodeClient.isReady) throw AppError.conflict('Current engine capability validation is unavailable');
    const [mcpStatus, mcpToolIds, skills] = await Promise.all([
      opencodeClient.listMcp(),
      opencodeClient.listMcpToolIds(),
      opencodeClient.listSkills(),
    ]);
    return {
      mcpStatus: mcpStatus as JsonRecord,
      sortedToolIds: [...mcpToolIds].sort(),
      sortedSkills: skills.map((skill) => skill.name).sort(),
    };
  }

  private async liveCapabilityCatalog(): Promise<JsonRecord> {
    const { mcpStatus, sortedToolIds, sortedSkills } = await this.liveCatalogLists();
    return {
      mcpServers: Object.entries(mcpStatus).sort(([a], [b]) => a.localeCompare(b)).map(([name, status]) => ({
        name,
        status: isRecord(status) && typeof status.status === 'string' ? status.status : 'unknown',
      })),
      mcpToolIds: sortedToolIds.slice(0, 150),
      mcpToolCount: sortedToolIds.length,
      mcpToolIncluded: Math.min(sortedToolIds.length, 150),
      mcpToolOmitted: Math.max(sortedToolIds.length - 150, 0),
      mcpToolsTruncated: sortedToolIds.length > 150,
      mcpToolCatalogHash: sha256(sortedToolIds),
      skills: sortedSkills.slice(0, 150),
      skillCount: sortedSkills.length,
      skillIncluded: Math.min(sortedSkills.length, 150),
      skillOmitted: Math.max(sortedSkills.length - 150, 0),
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
