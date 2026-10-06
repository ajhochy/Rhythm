/**
 * Dayflow native/API provider-admission contract, version 1 (C0 plan sha
 * 6556b1eb…78f9, fixture sha 2c273791…c6). This is the API half of the shared
 * DTO: strict, bounded, body-free parsers/validators. Nothing here reads a
 * source, a session or a grant; it only decides whether bytes are the exact
 * accepted shape. Every violation is a refusal — the caller holds.
 *
 * The three owned-engine endpoints (all frozen on the native side):
 *   POST /dayflow-agent/provider-admission                       (this API)
 *   GET  /session/:id/rhythm-provider-frame/:requestNonce        (owned engine)
 *   POST /session/:id/rhythm-dayflow-guard                       (owned engine)
 */
import { createHash } from 'node:crypto';

export const PROVIDER_ADMISSION_SCHEMA_VERSION = 1 as const;
export const PROVIDER_ADMISSION_BOUNDS = {
  requestBytes: 4096,
  responseBytes: 32768,
  exportBytes: 32768,
  overlayBytes: 3800,
  sourceAnchors: 64,
  derivedSummaryIds: 64,
  references: 5,
  exchangeDeadlineMs: 2000,
  maxAttempt: 100,
} as const;

export type ProviderPurpose = 'answer' | 'compaction' | 'summary';
export type ProviderDecision = 'ordinary' | 'allow' | 'project' | 'hold';
export type ProviderReason =
  | 'none'
  | 'source_changed'
  | 'receiver_changed'
  | 'history_ambiguous'
  | 'proof_unavailable'
  | 'bounds_exceeded';

export interface ProviderAdmissionRequest {
  schemaVersion: 1;
  sdkSessionId: string;
  userMessageId: string;
  requestNonce: string;
  engineGeneration: string;
  runnerGeneration: string;
  attempt: number;
  purpose: ProviderPurpose;
  inputDigest: string;
}

export interface ProviderSourceProof {
  sourceAnchorId: string;
  stored: boolean;
  visible: boolean;
  relation: 'before_current' | 'current' | 'after_current' | 'unknown';
  derivedSummaryIds: string[];
}

export interface ProviderPendingExport {
  schemaVersion: 1;
  status: 'pending';
  request: ProviderAdmissionRequest;
  agentName: string;
  userKind: 'authored' | 'control';
  initiatingUserMessageId: string | null;
  inputGroupCount: number;
  originCoverage: 'complete' | 'ambiguous';
  sourceProofs: ProviderSourceProof[];
}

export interface ProviderUnavailableExport {
  schemaVersion: 1;
  status: 'cancelled' | 'replaced' | 'not_pending';
}

export interface ProviderAdmissionResponse {
  schemaVersion: 1;
  request: ProviderAdmissionRequest;
  decision: ProviderDecision;
  rawHistoryReusable: boolean;
  guardRegistrationVersion: null | 1;
  basisDigest: string;
  overlay: null | { text: string; sha256: string };
  projection: null | { fromUserMessageId: string; sourceAnchorIds: string[] };
  reason: ProviderReason;
}

export interface ProviderEnrollmentResponse {
  schemaVersion: 1;
  sdkSessionId: string;
  engineGeneration: string;
  guarded: true;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const PURPOSES: readonly string[] = ['answer', 'compaction', 'summary'];
const DECISIONS: readonly string[] = ['ordinary', 'allow', 'project', 'hold'];
const REASONS: readonly string[] = [
  'none', 'source_changed', 'receiver_changed', 'history_ambiguous', 'proof_unavailable', 'bounds_exceeded',
];
const RELATIONS: readonly string[] = ['before_current', 'current', 'after_current', 'unknown'];
const NONCE = /^[A-Za-z0-9_-]{24,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;

const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};
const utf8 = (value: string): number => Buffer.byteLength(value, 'utf8');
const isId = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 200;
const isGeneration = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 128;

export const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Recursively key-sorted JSON, no whitespace, unescaped Unicode; array order preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

export function parseProviderAdmissionRequest(raw: unknown): Parsed<ProviderAdmissionRequest> {
  if (!isObject(raw)) return fail('request must be an object');
  if (!exactKeys(raw, [
    'schemaVersion', 'sdkSessionId', 'userMessageId', 'requestNonce', 'engineGeneration',
    'runnerGeneration', 'attempt', 'purpose', 'inputDigest',
  ])) return fail('request keys');
  if (raw.schemaVersion !== PROVIDER_ADMISSION_SCHEMA_VERSION) return fail('request schemaVersion');
  if (!isId(raw.sdkSessionId) || !isId(raw.userMessageId)) return fail('request ids');
  if (typeof raw.requestNonce !== 'string' || !NONCE.test(raw.requestNonce)) return fail('request nonce');
  if (!isGeneration(raw.engineGeneration) || !isGeneration(raw.runnerGeneration)) return fail('request generations');
  if (
    typeof raw.attempt !== 'number' || !Number.isInteger(raw.attempt) || raw.attempt < 0 ||
    raw.attempt > PROVIDER_ADMISSION_BOUNDS.maxAttempt
  ) return fail('request attempt');
  if (typeof raw.purpose !== 'string' || !PURPOSES.includes(raw.purpose)) return fail('request purpose');
  if (typeof raw.inputDigest !== 'string' || !SHA256.test(raw.inputDigest)) return fail('request digest');
  const value: ProviderAdmissionRequest = {
    schemaVersion: 1,
    sdkSessionId: raw.sdkSessionId,
    userMessageId: raw.userMessageId,
    requestNonce: raw.requestNonce,
    engineGeneration: raw.engineGeneration,
    runnerGeneration: raw.runnerGeneration,
    attempt: raw.attempt,
    purpose: raw.purpose as ProviderPurpose,
    inputDigest: raw.inputDigest,
  };
  if (utf8(JSON.stringify(value)) > PROVIDER_ADMISSION_BOUNDS.requestBytes) return fail('request too large');
  return ok(value);
}

export function sameProviderRequest(left: ProviderAdmissionRequest, right: ProviderAdmissionRequest): boolean {
  return left.sdkSessionId === right.sdkSessionId && left.userMessageId === right.userMessageId &&
    left.requestNonce === right.requestNonce && left.engineGeneration === right.engineGeneration &&
    left.runnerGeneration === right.runnerGeneration && left.attempt === right.attempt &&
    left.purpose === right.purpose && left.inputDigest === right.inputDigest;
}

/** Optional `sourceAnchorIds` query: JSON array of at most 64 unique non-empty ids. */
export function parseSourceAnchorQuery(raw: string | undefined): Parsed<string[]> {
  if (raw === undefined || raw === '') return ok([]);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return fail('sourceAnchorIds is not JSON'); }
  if (!Array.isArray(value) || value.length > PROVIDER_ADMISSION_BOUNDS.sourceAnchors) return fail('sourceAnchorIds bounds');
  if (!value.every(isId) || new Set(value).size !== value.length) return fail('sourceAnchorIds entries');
  return ok(value as string[]);
}

/** Strict parse of the owned engine's frame export (text form applies the byte bound first). */
export function parseProviderFrameExportText(text: string): Parsed<ProviderPendingExport | ProviderUnavailableExport> {
  if (utf8(text) > PROVIDER_ADMISSION_BOUNDS.exportBytes) return fail('export too large');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('export is not JSON'); }
  return parseProviderFrameExport(raw);
}

export function parseProviderFrameExport(raw: unknown): Parsed<ProviderPendingExport | ProviderUnavailableExport> {
  if (!isObject(raw) || raw.schemaVersion !== PROVIDER_ADMISSION_SCHEMA_VERSION) return fail('export schemaVersion');
  if (raw.status === 'cancelled' || raw.status === 'replaced' || raw.status === 'not_pending') {
    if (!exactKeys(raw, ['schemaVersion', 'status'])) return fail('unavailable export keys');
    return ok({ schemaVersion: 1, status: raw.status });
  }
  if (raw.status !== 'pending') return fail('export status');
  if (!exactKeys(raw, [
    'schemaVersion', 'status', 'request', 'agentName', 'userKind', 'initiatingUserMessageId',
    'inputGroupCount', 'originCoverage', 'sourceProofs',
  ])) return fail('pending export keys');
  const request = parseProviderAdmissionRequest(raw.request);
  if (!request.ok) return fail('export request');
  if (!isId(raw.agentName)) return fail('export agentName');
  if (raw.userKind !== 'authored' && raw.userKind !== 'control') return fail('export userKind');
  if (raw.initiatingUserMessageId !== null && !isId(raw.initiatingUserMessageId)) return fail('export initiating');
  if (typeof raw.inputGroupCount !== 'number' || !Number.isInteger(raw.inputGroupCount) || raw.inputGroupCount < 0) {
    return fail('export group count');
  }
  if (raw.originCoverage !== 'complete' && raw.originCoverage !== 'ambiguous') return fail('export coverage');
  if (!Array.isArray(raw.sourceProofs) || raw.sourceProofs.length > PROVIDER_ADMISSION_BOUNDS.sourceAnchors) {
    return fail('export proofs');
  }
  let summaries = 0;
  const proofs: ProviderSourceProof[] = [];
  for (const item of raw.sourceProofs) {
    if (!isObject(item) || !exactKeys(item, ['sourceAnchorId', 'stored', 'visible', 'relation', 'derivedSummaryIds'])) {
      return fail('export proof');
    }
    if (!isId(item.sourceAnchorId) || typeof item.stored !== 'boolean' || typeof item.visible !== 'boolean') {
      return fail('export proof');
    }
    if (typeof item.relation !== 'string' || !RELATIONS.includes(item.relation)) return fail('export proof relation');
    if (!Array.isArray(item.derivedSummaryIds) || !item.derivedSummaryIds.every(isId)) return fail('export proof');
    summaries += item.derivedSummaryIds.length;
    proofs.push({
      sourceAnchorId: item.sourceAnchorId,
      stored: item.stored,
      visible: item.visible,
      relation: item.relation as ProviderSourceProof['relation'],
      derivedSummaryIds: [...(item.derivedSummaryIds as string[])],
    });
  }
  if (summaries > PROVIDER_ADMISSION_BOUNDS.derivedSummaryIds) return fail('export summary ids');
  const value: ProviderPendingExport = {
    schemaVersion: 1,
    status: 'pending',
    request: request.value,
    agentName: raw.agentName,
    userKind: raw.userKind,
    initiatingUserMessageId: raw.initiatingUserMessageId,
    inputGroupCount: raw.inputGroupCount,
    originCoverage: raw.originCoverage,
    sourceProofs: proofs,
  };
  if (utf8(JSON.stringify(value)) > PROVIDER_ADMISSION_BOUNDS.exportBytes) return fail('export too large');
  return ok(value);
}

export function parseEnrollmentResponse(raw: unknown, expectedSdkSessionId: string): Parsed<ProviderEnrollmentResponse> {
  if (!isObject(raw) || !exactKeys(raw, ['schemaVersion', 'sdkSessionId', 'engineGeneration', 'guarded'])) {
    return fail('enrollment keys');
  }
  if (raw.schemaVersion !== PROVIDER_ADMISSION_SCHEMA_VERSION || raw.guarded !== true) return fail('enrollment values');
  if (raw.sdkSessionId !== expectedSdkSessionId || !isId(raw.sdkSessionId)) return fail('enrollment sdk echo');
  if (!isGeneration(raw.engineGeneration)) return fail('enrollment generation');
  return ok({ schemaVersion: 1, sdkSessionId: raw.sdkSessionId, engineGeneration: raw.engineGeneration, guarded: true });
}

/** The exact body the API sends to enroll an SDK; there is no disable form. */
export const ENROLLMENT_REQUEST_BODY = { schemaVersion: 1, guarded: true } as const;

/**
 * Strict response validation (exact keys, request echo, cross-field rules and
 * bounds). The same rules the native parser applies; the API refuses to emit
 * anything that would not parse.
 */
export function validateProviderAdmissionResponse(
  raw: unknown,
  expected: ProviderAdmissionRequest,
): Parsed<ProviderAdmissionResponse> {
  if (!isObject(raw)) return fail('response must be an object');
  if (!exactKeys(raw, [
    'schemaVersion', 'request', 'decision', 'rawHistoryReusable', 'guardRegistrationVersion',
    'basisDigest', 'overlay', 'projection', 'reason',
  ])) return fail('response keys');
  if (raw.schemaVersion !== PROVIDER_ADMISSION_SCHEMA_VERSION) return fail('response schemaVersion');
  const request = parseProviderAdmissionRequest(raw.request);
  if (!request.ok || !sameProviderRequest(request.value, expected)) return fail('response request echo');
  if (typeof raw.decision !== 'string' || !DECISIONS.includes(raw.decision)) return fail('response decision');
  if (typeof raw.reason !== 'string' || !REASONS.includes(raw.reason)) return fail('response reason');
  if (typeof raw.rawHistoryReusable !== 'boolean') return fail('response rawHistoryReusable');
  if (raw.guardRegistrationVersion !== null && raw.guardRegistrationVersion !== 1) return fail('response registration');
  if (typeof raw.basisDigest !== 'string' || !SHA256.test(raw.basisDigest)) return fail('response basisDigest');

  let overlay: ProviderAdmissionResponse['overlay'] = null;
  if (raw.overlay !== null) {
    if (!isObject(raw.overlay) || !exactKeys(raw.overlay, ['text', 'sha256'])) return fail('response overlay');
    const { text, sha256 } = raw.overlay;
    if (typeof text !== 'string' || typeof sha256 !== 'string' || !SHA256.test(sha256)) return fail('response overlay');
    if (utf8(text) > PROVIDER_ADMISSION_BOUNDS.overlayBytes) return fail('response overlay too large');
    if (sha256Hex(text) !== sha256) return fail('response overlay digest');
    overlay = { text, sha256 };
  }
  let projection: ProviderAdmissionResponse['projection'] = null;
  if (raw.projection !== null) {
    if (!isObject(raw.projection) || !exactKeys(raw.projection, ['fromUserMessageId', 'sourceAnchorIds'])) {
      return fail('response projection');
    }
    const { fromUserMessageId, sourceAnchorIds } = raw.projection;
    if (!isId(fromUserMessageId) || !Array.isArray(sourceAnchorIds)) return fail('response projection');
    if (sourceAnchorIds.length < 1 || sourceAnchorIds.length > PROVIDER_ADMISSION_BOUNDS.sourceAnchors) {
      return fail('response projection anchors');
    }
    if (!sourceAnchorIds.every(isId) || new Set(sourceAnchorIds).size !== sourceAnchorIds.length) {
      return fail('response projection anchors');
    }
    projection = { fromUserMessageId, sourceAnchorIds: [...sourceAnchorIds] as string[] };
  }
  const decision = raw.decision as ProviderDecision;
  const reason = raw.reason as ProviderReason;
  if (decision === 'ordinary') {
    if (!raw.rawHistoryReusable || overlay || projection || reason !== 'none') return fail('ordinary shape');
  } else if (decision === 'allow') {
    if (!raw.rawHistoryReusable || projection || reason !== 'none') return fail('allow shape');
  } else if (decision === 'project') {
    if (raw.rawHistoryReusable || !projection || !projection.sourceAnchorIds.includes(projection.fromUserMessageId)) {
      return fail('project shape');
    }
    if (reason !== 'source_changed' && reason !== 'receiver_changed') return fail('project reason');
  } else if (raw.rawHistoryReusable || overlay || projection || reason === 'none') {
    return fail('hold shape');
  }
  const value: ProviderAdmissionResponse = {
    schemaVersion: 1,
    request: request.value,
    decision,
    rawHistoryReusable: raw.rawHistoryReusable,
    guardRegistrationVersion: raw.guardRegistrationVersion,
    basisDigest: raw.basisDigest,
    overlay,
    projection,
    reason,
  };
  if (utf8(JSON.stringify(value)) > PROVIDER_ADMISSION_BOUNDS.responseBytes) return fail('response too large');
  return ok(value);
}

/**
 * The stable receiving basis. Callers pass ONLY deterministic facts: the exact
 * current receiver (owner/project/root/agent/consent), the persisted exposure
 * witnesses and the full qualified source versions they depend on, and the
 * resulting decision. It must never include a nonce, an attempt number, the
 * input digest or an incidental read time; `providerBasisMaterial` fixes the
 * allowed shape so none of those can be added by accident.
 */
export interface ProviderBasisMaterial {
  version: 2;
  receiver: {
    ownerUserId: number;
    projectId: string;
    sessionId: string;
    sdkSessionId: string;
    agent: string;
    receiverKind: 'foreground' | 'delegation_callback' | 'none';
    consentGeneration: string | null;
    configurationGeneration: string | null;
    overlayEligible: boolean;
  };
  witnesses: Array<{ dispatchId: string; kind: 'v1_tool_turn' | 'v2_native_user'; anchor: string; sources: string[] }>;
  decision: ProviderDecision;
  reason: ProviderReason;
  rawHistoryReusable: boolean;
  projection: { fromUserMessageId: string; sourceAnchorIds: string[] } | null;
  overlaySha256: string | null;
}

export function providerBasisDigest(material: ProviderBasisMaterial): string {
  const normalized: ProviderBasisMaterial = {
    ...material,
    witnesses: [...material.witnesses]
      .map((witness) => ({ ...witness, sources: [...witness.sources].sort() }))
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    projection: material.projection
      ? { fromUserMessageId: material.projection.fromUserMessageId, sourceAnchorIds: [...material.projection.sourceAnchorIds].sort() }
      : null,
  };
  return sha256Hex(canonicalJson(normalized));
}
