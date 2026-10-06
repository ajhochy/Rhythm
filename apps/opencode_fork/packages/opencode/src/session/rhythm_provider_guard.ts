/**
 * Rhythm carried patch (Dayflow native/API contract, C1): versioned provider-admission
 * contract for the owned engine.
 *
 * Authority: task4 `core-dayflow-native-api-contract-plan.md` (C0) and its shared
 * fixture. This module is the native half's contract surface:
 *
 *  - strict, bounded parsers/builders for the schema-version-1 DTOs
 *    (admission request/response, pending/unavailable frame export, enrollment);
 *  - the canonical input digest;
 *  - a transient, attempt-scoped pending-frame registry (never persisted);
 *  - a tiny monotonic managed-seen / guarded SDK record in the existing Storage.
 *
 * No network, no model-visible surface, no permissions or grants. Source text never
 * appears here: frames carry identities and digests only.
 */
import { createHash, randomBytes } from "node:crypto"
import { Effect, Semaphore } from "effect"
import { Storage } from "@/storage/storage"

export const GUARD_SCHEMA_VERSION = 1 as const
export const GUARD_BOUNDS = {
  requestBytes: 4096,
  responseBytes: 32768,
  exportBytes: 32768,
  overlayBytes: 3800,
  sourceAnchors: 64,
  derivedSummaryIds: 64,
  exchangeDeadlineMs: 2000,
  maxAttempt: 100,
} as const
export const GUARD_ADMISSION_PATH = "/dayflow-agent/provider-admission"

export type GuardPurpose = "answer" | "compaction" | "summary"
export type GuardDecision = "ordinary" | "allow" | "project" | "hold"
export type GuardReason =
  | "none"
  | "source_changed"
  | "receiver_changed"
  | "history_ambiguous"
  | "proof_unavailable"
  | "bounds_exceeded"

export interface GuardRequest {
  schemaVersion: 1
  sdkSessionId: string
  userMessageId: string
  requestNonce: string
  engineGeneration: string
  runnerGeneration: string
  attempt: number
  purpose: GuardPurpose
  inputDigest: string
}

export interface GuardSourceProof {
  sourceAnchorId: string
  stored: boolean
  visible: boolean
  relation: "before_current" | "current" | "after_current" | "unknown"
  derivedSummaryIds: string[]
}

export interface GuardPendingExport {
  schemaVersion: 1
  status: "pending"
  request: GuardRequest
  agentName: string
  userKind: "authored" | "control"
  initiatingUserMessageId: string | null
  inputGroupCount: number
  originCoverage: "complete" | "ambiguous"
  sourceProofs: GuardSourceProof[]
}

export interface GuardUnavailableExport {
  schemaVersion: 1
  status: "cancelled" | "replaced" | "not_pending"
}

export interface GuardResponse {
  schemaVersion: 1
  request: GuardRequest
  decision: GuardDecision
  rawHistoryReusable: boolean
  guardRegistrationVersion: null | 1
  basisDigest: string
  overlay: null | { text: string; sha256: string }
  projection: null | { fromUserMessageId: string; sourceAnchorIds: string[] }
  reason: GuardReason
}

export interface GuardEnrollmentResponse {
  schemaVersion: 1
  sdkSessionId: string
  engineGeneration: string
  guarded: true
}

// G2 Coding Workflow uses the existing Dayflow provider-admission transport as
// a private, stricter envelope.  These correlations are not source/Dayflow
// authority and cannot make an ordinary session workflow-capable.
export interface WorkflowBinding {
  schemaVersion: 1
  jobId: string
  rootSdkSessionId: string
  managerSdkSessionId: string
  expiresAt: string
}
export type WorkflowScope =
  | { kind: "manager_lineage" }
  | { kind: "root_turn"; userMessageId: string }
export interface WorkflowEnrollmentRequest {
  schemaVersion: 2
  kind: "coordinator_workflow_enrollment"
  binding: WorkflowBinding
  scope: WorkflowScope
}
export interface WorkflowEnrollmentResponse extends WorkflowEnrollmentRequest {
  sdkSessionId: string
  engineGeneration: string
  guarded: true
}
export type WorkflowAccounting =
  | { kind: "persisted_assistant"; assistantMessageId: string; parentMessageId: string }
  | { kind: "unmetered_auxiliary"; sourceUserMessageId: string }
export interface WorkflowProviderRequest {
  schemaVersion: 2
  kind: "coordinator_workflow_provider"
  binding: WorkflowBinding
  scope: WorkflowScope
  request: GuardRequest
}
export interface WorkflowProviderPendingExport {
  schemaVersion: 2
  kind: "coordinator_workflow_provider_frame"
  binding: WorkflowBinding
  scope: WorkflowScope
  accounting: WorkflowAccounting
  nativeLineageDigest: string
  frame: GuardPendingExport
}
export interface WorkflowProviderDecision {
  schemaVersion: 2
  kind: "coordinator_workflow_provider_decision"
  binding: WorkflowBinding
  scope: WorkflowScope
  response: GuardResponse
  workflow: {
    status: "allow" | "hold"
    reason: "none" | "binding_changed" | "authority_unavailable" | "membership_unavailable" | "accounting_unavailable" | "bounds_exceeded"
    authorityDigest: string
    nativeLineageDigest: string
  }
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const PURPOSES: readonly string[] = ["answer", "compaction", "summary"]
const DECISIONS: readonly string[] = ["ordinary", "allow", "project", "hold"]
const REASONS: readonly string[] = [
  "none",
  "source_changed",
  "receiver_changed",
  "history_ambiguous",
  "proof_unavailable",
  "bounds_exceeded",
]
const RELATIONS: readonly string[] = ["before_current", "current", "after_current", "unknown"]
const NONCE = /^[A-Za-z0-9_-]{24,64}$/
const SHA256 = /^[a-f0-9]{64}$/

const fail = <T>(error: string): Parsed<T> => ({ ok: false, error })
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
const utf8Bytes = (value: string) => Buffer.byteLength(value, "utf8")
const isId = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 200
const isGeneration = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 128

export const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")

/** Recursively key-sorted JSON, no whitespace, unescaped Unicode; array order preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, sortKeys(value[key])]),
    )
  }
  return value
}

/** SHA256 of canonical {preparedInput, originGroups}. */
export const guardInputDigest = (preparedInput: unknown, originGroups: unknown) =>
  sha256Hex(canonicalJson({ preparedInput, originGroups }))

/** Engine-generated per-attempt nonce: 32 base64url characters. */
export const newGuardNonce = () => randomBytes(24).toString("base64url")

/** Opaque per-process identity. */
export const ENGINE_GENERATION = `eng_${randomBytes(12).toString("base64url")}`

export function parseGuardRequest(raw: unknown): Parsed<GuardRequest> {
  if (!isObject(raw)) return fail("request must be an object")
  if (
    !exactKeys(raw, [
      "schemaVersion",
      "sdkSessionId",
      "userMessageId",
      "requestNonce",
      "engineGeneration",
      "runnerGeneration",
      "attempt",
      "purpose",
      "inputDigest",
    ])
  )
    return fail("request keys")
  if (raw.schemaVersion !== GUARD_SCHEMA_VERSION) return fail("request schemaVersion")
  if (!isId(raw.sdkSessionId) || !isId(raw.userMessageId)) return fail("request ids")
  if (typeof raw.requestNonce !== "string" || !NONCE.test(raw.requestNonce)) return fail("request nonce")
  if (!isGeneration(raw.engineGeneration) || !isGeneration(raw.runnerGeneration)) return fail("request generations")
  if (
    typeof raw.attempt !== "number" ||
    !Number.isInteger(raw.attempt) ||
    raw.attempt < 0 ||
    raw.attempt > GUARD_BOUNDS.maxAttempt
  )
    return fail("request attempt")
  if (typeof raw.purpose !== "string" || !PURPOSES.includes(raw.purpose)) return fail("request purpose")
  if (typeof raw.inputDigest !== "string" || !SHA256.test(raw.inputDigest)) return fail("request digest")
  const value: GuardRequest = {
    schemaVersion: 1,
    sdkSessionId: raw.sdkSessionId,
    userMessageId: raw.userMessageId,
    requestNonce: raw.requestNonce,
    engineGeneration: raw.engineGeneration,
    runnerGeneration: raw.runnerGeneration,
    attempt: raw.attempt,
    purpose: raw.purpose as GuardPurpose,
    inputDigest: raw.inputDigest,
  }
  if (utf8Bytes(JSON.stringify(value)) > GUARD_BOUNDS.requestBytes) return fail("request too large")
  return ok(value)
}

const sameRequest = (a: GuardRequest, b: GuardRequest) =>
  a.sdkSessionId === b.sdkSessionId &&
  a.userMessageId === b.userMessageId &&
  a.requestNonce === b.requestNonce &&
  a.engineGeneration === b.engineGeneration &&
  a.runnerGeneration === b.runnerGeneration &&
  a.attempt === b.attempt &&
  a.purpose === b.purpose &&
  a.inputDigest === b.inputDigest

const isIso = (value: unknown): value is string => {
  if (typeof value !== "string") return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

export function parseWorkflowBinding(raw: unknown): Parsed<WorkflowBinding> {
  if (!isObject(raw) || !exactKeys(raw, ["schemaVersion", "jobId", "rootSdkSessionId", "managerSdkSessionId", "expiresAt"]))
    return fail("workflow binding keys")
  if (
    raw.schemaVersion !== 1 || !isId(raw.jobId) || !isId(raw.rootSdkSessionId) || !isId(raw.managerSdkSessionId) ||
    raw.rootSdkSessionId === raw.managerSdkSessionId || !isIso(raw.expiresAt)
  ) return fail("workflow binding values")
  return ok({
    schemaVersion: 1,
    jobId: raw.jobId,
    rootSdkSessionId: raw.rootSdkSessionId,
    managerSdkSessionId: raw.managerSdkSessionId,
    expiresAt: raw.expiresAt,
  })
}

export const sameWorkflowBinding = (left: WorkflowBinding, right: WorkflowBinding) =>
  left.jobId === right.jobId && left.rootSdkSessionId === right.rootSdkSessionId &&
  left.managerSdkSessionId === right.managerSdkSessionId && left.expiresAt === right.expiresAt

export function parseWorkflowScope(raw: unknown): Parsed<WorkflowScope> {
  if (!isObject(raw) || typeof raw.kind !== "string") return fail("workflow scope")
  if (raw.kind === "manager_lineage" && exactKeys(raw, ["kind"])) return ok({ kind: "manager_lineage" })
  if (raw.kind === "root_turn" && exactKeys(raw, ["kind", "userMessageId"]) && isId(raw.userMessageId)) {
    return ok({ kind: "root_turn", userMessageId: raw.userMessageId })
  }
  return fail("workflow scope")
}

export const sameWorkflowScope = (left: WorkflowScope, right: WorkflowScope) =>
  left.kind === right.kind && (left.kind !== "root_turn" || (right.kind === "root_turn" && left.userMessageId === right.userMessageId))

export function parseWorkflowEnrollmentRequest(raw: unknown): Parsed<WorkflowEnrollmentRequest> {
  if (!isObject(raw) || !exactKeys(raw, ["schemaVersion", "kind", "binding", "scope"])) return fail("workflow enrollment keys")
  if (raw.schemaVersion !== 2 || raw.kind !== "coordinator_workflow_enrollment") return fail("workflow enrollment values")
  const binding = parseWorkflowBinding(raw.binding)
  const scope = parseWorkflowScope(raw.scope)
  if (!binding.ok || !scope.ok) return fail("workflow enrollment fields")
  const value: WorkflowEnrollmentRequest = { schemaVersion: 2, kind: "coordinator_workflow_enrollment", binding: binding.value, scope: scope.value }
  return utf8Bytes(JSON.stringify(value)) <= GUARD_BOUNDS.requestBytes ? ok(value) : fail("workflow enrollment too large")
}

export function parseWorkflowEnrollmentResponse(
  raw: unknown,
  expectedSdkSessionId: string,
  expected: WorkflowEnrollmentRequest,
): Parsed<WorkflowEnrollmentResponse> {
  if (!isObject(raw) || !exactKeys(raw, ["schemaVersion", "kind", "sdkSessionId", "engineGeneration", "guarded", "binding", "scope"])) {
    return fail("workflow enrollment response keys")
  }
  if (
    raw.schemaVersion !== 2 || raw.kind !== "coordinator_workflow_enrollment" || raw.guarded !== true ||
    raw.sdkSessionId !== expectedSdkSessionId || !isId(raw.sdkSessionId) || !isGeneration(raw.engineGeneration)
  ) return fail("workflow enrollment response values")
  const binding = parseWorkflowBinding(raw.binding)
  const scope = parseWorkflowScope(raw.scope)
  if (!binding.ok || !scope.ok || !sameWorkflowBinding(binding.value, expected.binding) || !sameWorkflowScope(scope.value, expected.scope)) {
    return fail("workflow enrollment response echo")
  }
  const value: WorkflowEnrollmentResponse = {
    schemaVersion: 2,
    kind: "coordinator_workflow_enrollment",
    sdkSessionId: raw.sdkSessionId,
    engineGeneration: raw.engineGeneration,
    guarded: true,
    binding: binding.value,
    scope: scope.value,
  }
  return utf8Bytes(JSON.stringify(value)) <= GUARD_BOUNDS.responseBytes ? ok(value) : fail("workflow enrollment response too large")
}

export function parseWorkflowProviderRequest(raw: unknown): Parsed<WorkflowProviderRequest> {
  if (!isObject(raw) || !exactKeys(raw, ["schemaVersion", "kind", "binding", "scope", "request"])) return fail("workflow provider keys")
  if (raw.schemaVersion !== 2 || raw.kind !== "coordinator_workflow_provider") return fail("workflow provider values")
  const binding = parseWorkflowBinding(raw.binding)
  const scope = parseWorkflowScope(raw.scope)
  const request = parseGuardRequest(raw.request)
  if (!binding.ok || !scope.ok || !request.ok) return fail("workflow provider fields")
  const value: WorkflowProviderRequest = {
    schemaVersion: 2,
    kind: "coordinator_workflow_provider",
    binding: binding.value,
    scope: scope.value,
    request: request.value,
  }
  return utf8Bytes(JSON.stringify(value)) <= GUARD_BOUNDS.requestBytes ? ok(value) : fail("workflow provider too large")
}

function parseWorkflowAccounting(raw: unknown): Parsed<WorkflowAccounting> {
  if (!isObject(raw) || typeof raw.kind !== "string") return fail("workflow accounting")
  if (
    raw.kind === "persisted_assistant" && exactKeys(raw, ["kind", "assistantMessageId", "parentMessageId"]) &&
    isId(raw.assistantMessageId) && isId(raw.parentMessageId)
  ) return ok({ kind: "persisted_assistant", assistantMessageId: raw.assistantMessageId, parentMessageId: raw.parentMessageId })
  if (raw.kind === "unmetered_auxiliary" && exactKeys(raw, ["kind", "sourceUserMessageId"]) && isId(raw.sourceUserMessageId)) {
    return ok({ kind: "unmetered_auxiliary", sourceUserMessageId: raw.sourceUserMessageId })
  }
  return fail("workflow accounting")
}

/**
 * Strict admission response: exact keys, exact request echo, cross-field rules.
 * Anything else (unknown key/version, wrong echo, oversized, malformed) is `ok:false`
 * and must be treated as a hold by the caller.
 */
export function parseGuardResponse(raw: unknown, expected: GuardRequest): Parsed<GuardResponse> {
  if (!isObject(raw)) return fail("response must be an object")
  if (
    !exactKeys(raw, [
      "schemaVersion",
      "request",
      "decision",
      "rawHistoryReusable",
      "guardRegistrationVersion",
      "basisDigest",
      "overlay",
      "projection",
      "reason",
    ])
  )
    return fail("response keys")
  if (raw.schemaVersion !== GUARD_SCHEMA_VERSION) return fail("response schemaVersion")
  const request = parseGuardRequest(raw.request)
  if (!request.ok || !sameRequest(request.value, expected)) return fail("response request echo")
  if (typeof raw.decision !== "string" || !DECISIONS.includes(raw.decision)) return fail("response decision")
  if (typeof raw.reason !== "string" || !REASONS.includes(raw.reason)) return fail("response reason")
  if (typeof raw.rawHistoryReusable !== "boolean") return fail("response rawHistoryReusable")
  if (raw.guardRegistrationVersion !== null && raw.guardRegistrationVersion !== 1) return fail("response registration")
  if (typeof raw.basisDigest !== "string" || !SHA256.test(raw.basisDigest)) return fail("response basisDigest")

  let overlay: GuardResponse["overlay"] = null
  if (raw.overlay !== null) {
    if (!isObject(raw.overlay) || !exactKeys(raw.overlay, ["text", "sha256"])) return fail("response overlay")
    const { text, sha256 } = raw.overlay
    if (typeof text !== "string" || typeof sha256 !== "string" || !SHA256.test(sha256)) return fail("response overlay")
    if (utf8Bytes(text) > GUARD_BOUNDS.overlayBytes) return fail("response overlay too large")
    if (sha256Hex(text) !== sha256) return fail("response overlay digest")
    overlay = { text, sha256 }
  }

  let projection: GuardResponse["projection"] = null
  if (raw.projection !== null) {
    if (!isObject(raw.projection) || !exactKeys(raw.projection, ["fromUserMessageId", "sourceAnchorIds"]))
      return fail("response projection")
    const { fromUserMessageId, sourceAnchorIds } = raw.projection
    if (!isId(fromUserMessageId) || !Array.isArray(sourceAnchorIds)) return fail("response projection")
    if (sourceAnchorIds.length < 1 || sourceAnchorIds.length > GUARD_BOUNDS.sourceAnchors)
      return fail("response projection anchors")
    if (!sourceAnchorIds.every(isId) || new Set(sourceAnchorIds).size !== sourceAnchorIds.length)
      return fail("response projection anchors")
    projection = { fromUserMessageId, sourceAnchorIds: [...sourceAnchorIds] as string[] }
  }

  const decision = raw.decision as GuardDecision
  const reason = raw.reason as GuardReason
  if (decision === "ordinary") {
    if (!raw.rawHistoryReusable || overlay || projection || reason !== "none") return fail("ordinary shape")
  } else if (decision === "allow") {
    if (!raw.rawHistoryReusable || projection || reason !== "none") return fail("allow shape")
  } else if (decision === "project") {
    if (raw.rawHistoryReusable || !projection || !projection.sourceAnchorIds.includes(projection.fromUserMessageId))
      return fail("project shape")
    if (reason !== "source_changed" && reason !== "receiver_changed") return fail("project reason")
  } else {
    if (raw.rawHistoryReusable || overlay || projection || reason === "none") return fail("hold shape")
  }

  return ok({
    schemaVersion: 1,
    request: request.value,
    decision,
    rawHistoryReusable: raw.rawHistoryReusable,
    guardRegistrationVersion: raw.guardRegistrationVersion,
    basisDigest: raw.basisDigest,
    overlay,
    projection,
    reason,
  })
}

/** Parse response text with the byte bound applied before JSON parsing. */
export function parseGuardResponseText(text: string, expected: GuardRequest): Parsed<GuardResponse> {
  if (utf8Bytes(text) > GUARD_BOUNDS.responseBytes) return fail("response too large")
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail("response is not JSON")
  }
  return parseGuardResponse(raw, expected)
}

export function parseWorkflowProviderDecision(
  raw: unknown,
  expected: WorkflowProviderRequest,
): Parsed<WorkflowProviderDecision> {
  if (!isObject(raw) || !exactKeys(raw, ["schemaVersion", "kind", "binding", "scope", "response", "workflow"])) {
    return fail("workflow decision keys")
  }
  if (raw.schemaVersion !== 2 || raw.kind !== "coordinator_workflow_provider_decision") return fail("workflow decision values")
  const binding = parseWorkflowBinding(raw.binding)
  const scope = parseWorkflowScope(raw.scope)
  const response = parseGuardResponse(raw.response, expected.request)
  if (!binding.ok || !scope.ok || !response.ok || !sameWorkflowBinding(binding.value, expected.binding) || !sameWorkflowScope(scope.value, expected.scope)) {
    return fail("workflow decision echo")
  }
  if (
    !isObject(raw.workflow) || !exactKeys(raw.workflow, ["status", "reason", "authorityDigest", "nativeLineageDigest"]) ||
    (raw.workflow.status !== "allow" && raw.workflow.status !== "hold") ||
    !["none", "binding_changed", "authority_unavailable", "membership_unavailable", "accounting_unavailable", "bounds_exceeded"].includes(String(raw.workflow.reason)) ||
    typeof raw.workflow.authorityDigest !== "string" || !SHA256.test(raw.workflow.authorityDigest) ||
    typeof raw.workflow.nativeLineageDigest !== "string" || !SHA256.test(raw.workflow.nativeLineageDigest)
  ) return fail("workflow decision fields")
  if ((raw.workflow.status === "allow") !== (raw.workflow.reason === "none")) return fail("workflow decision state")
  const value: WorkflowProviderDecision = {
    schemaVersion: 2,
    kind: "coordinator_workflow_provider_decision",
    binding: binding.value,
    scope: scope.value,
    response: response.value,
    workflow: {
      status: raw.workflow.status,
      reason: raw.workflow.reason as WorkflowProviderDecision["workflow"]["reason"],
      authorityDigest: raw.workflow.authorityDigest,
      nativeLineageDigest: raw.workflow.nativeLineageDigest,
    },
  }
  return utf8Bytes(JSON.stringify(value)) <= GUARD_BOUNDS.responseBytes ? ok(value) : fail("workflow decision too large")
}

/** Strict parser for an exported frame (API/test side symmetry; also validates our own builder). */
export function parseGuardExport(raw: unknown): Parsed<GuardPendingExport | GuardUnavailableExport> {
  if (!isObject(raw) || raw.schemaVersion !== GUARD_SCHEMA_VERSION) return fail("export schemaVersion")
  if (raw.status === "cancelled" || raw.status === "replaced" || raw.status === "not_pending") {
    if (!exactKeys(raw, ["schemaVersion", "status"])) return fail("unavailable export keys")
    return ok({ schemaVersion: 1, status: raw.status })
  }
  if (raw.status !== "pending") return fail("export status")
  if (
    !exactKeys(raw, [
      "schemaVersion",
      "status",
      "request",
      "agentName",
      "userKind",
      "initiatingUserMessageId",
      "inputGroupCount",
      "originCoverage",
      "sourceProofs",
    ])
  )
    return fail("pending export keys")
  const request = parseGuardRequest(raw.request)
  if (!request.ok) return fail("export request")
  if (!isId(raw.agentName)) return fail("export agentName")
  if (raw.userKind !== "authored" && raw.userKind !== "control") return fail("export userKind")
  if (raw.initiatingUserMessageId !== null && !isId(raw.initiatingUserMessageId)) return fail("export initiating")
  if (typeof raw.inputGroupCount !== "number" || !Number.isInteger(raw.inputGroupCount) || raw.inputGroupCount < 0)
    return fail("export group count")
  if (raw.originCoverage !== "complete" && raw.originCoverage !== "ambiguous") return fail("export coverage")
  if (!Array.isArray(raw.sourceProofs) || raw.sourceProofs.length > GUARD_BOUNDS.sourceAnchors)
    return fail("export proofs")
  let summaries = 0
  const proofs: GuardSourceProof[] = []
  for (const item of raw.sourceProofs) {
    if (!isObject(item) || !exactKeys(item, ["sourceAnchorId", "stored", "visible", "relation", "derivedSummaryIds"]))
      return fail("export proof")
    if (!isId(item.sourceAnchorId) || typeof item.stored !== "boolean" || typeof item.visible !== "boolean")
      return fail("export proof")
    if (typeof item.relation !== "string" || !RELATIONS.includes(item.relation)) return fail("export proof relation")
    if (!Array.isArray(item.derivedSummaryIds) || !item.derivedSummaryIds.every(isId)) return fail("export proof")
    summaries += item.derivedSummaryIds.length
    proofs.push({
      sourceAnchorId: item.sourceAnchorId,
      stored: item.stored,
      visible: item.visible,
      relation: item.relation as GuardSourceProof["relation"],
      derivedSummaryIds: [...(item.derivedSummaryIds as string[])],
    })
  }
  if (summaries > GUARD_BOUNDS.derivedSummaryIds) return fail("export summary ids")
  const value: GuardPendingExport = {
    schemaVersion: 1,
    status: "pending",
    request: request.value,
    agentName: raw.agentName,
    userKind: raw.userKind,
    initiatingUserMessageId: raw.initiatingUserMessageId,
    inputGroupCount: raw.inputGroupCount,
    originCoverage: raw.originCoverage,
    sourceProofs: proofs,
  }
  if (utf8Bytes(JSON.stringify(value)) > GUARD_BOUNDS.exportBytes) return fail("export too large")
  return ok(value)
}

export function parseWorkflowGuardExport(raw: unknown): Parsed<WorkflowProviderPendingExport | GuardPendingExport | GuardUnavailableExport> {
  if (!isObject(raw)) return fail("workflow export")
  if (raw.schemaVersion === 1) return parseGuardExport(raw)
  if (
    !exactKeys(raw, ["schemaVersion", "kind", "binding", "scope", "accounting", "nativeLineageDigest", "frame"]) ||
    raw.schemaVersion !== 2 || raw.kind !== "coordinator_workflow_provider_frame" ||
    typeof raw.nativeLineageDigest !== "string" || !SHA256.test(raw.nativeLineageDigest)
  ) return fail("workflow export keys")
  const binding = parseWorkflowBinding(raw.binding)
  const scope = parseWorkflowScope(raw.scope)
  const accounting = parseWorkflowAccounting(raw.accounting)
  const frame = parseGuardExport(raw.frame)
  if (!binding.ok || !scope.ok || !accounting.ok || !frame.ok || frame.value.status !== "pending") return fail("workflow export fields")
  const value: WorkflowProviderPendingExport = {
    schemaVersion: 2,
    kind: "coordinator_workflow_provider_frame",
    binding: binding.value,
    scope: scope.value,
    accounting: accounting.value,
    nativeLineageDigest: raw.nativeLineageDigest,
    frame: frame.value,
  }
  return utf8Bytes(JSON.stringify(value)) <= GUARD_BOUNDS.exportBytes ? ok(value) : fail("workflow export too large")
}

/** Optional `sourceAnchorIds` query: JSON array of at most 64 unique non-empty ids. */
export function parseSourceAnchorQuery(raw: string | undefined): Parsed<string[]> {
  if (raw === undefined || raw === "") return ok([])
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return fail("sourceAnchorIds is not JSON")
  }
  if (!Array.isArray(value) || value.length > GUARD_BOUNDS.sourceAnchors) return fail("sourceAnchorIds bounds")
  if (!value.every(isId) || new Set(value).size !== value.length) return fail("sourceAnchorIds entries")
  return ok(value as string[])
}

export function parseEnrollmentRequest(raw: unknown): Parsed<{ schemaVersion: 1; guarded: true }> {
  if (!isObject(raw) || !exactKeys(raw, ["schemaVersion", "guarded"])) return fail("enrollment keys")
  if (raw.schemaVersion !== GUARD_SCHEMA_VERSION || raw.guarded !== true) return fail("enrollment values")
  return ok({ schemaVersion: 1, guarded: true })
}

// ---------------------------------------------------------------------------
// Pending frames (transient, in memory only)
// ---------------------------------------------------------------------------

/**
 * Current runner generation per SDK session. Set by SessionRunState when a runner is
 * created and cleared when it goes idle/cancels, so a frame installed under an older
 * runner reads as `replaced`. Absent = no runner is currently proven.
 */
export const runnerGenerations = new Map<string, string>()

export interface GuardFrame {
  readonly request: GuardRequest
  readonly agentName: string
  readonly userKind: "authored" | "control"
  readonly initiatingUserMessageId: string | null
  readonly inputGroupCount: number
  readonly originCoverage: "complete" | "ambiguous"
  /** Native message IDs actually present in the prepared input (for `visible`). */
  readonly visibleMessageIds: ReadonlySet<string>
  /** The attempt's abort signal; aborted = cancelled while pending. */
  readonly signal: AbortSignal
  /**
   * Private G2 correlation facts.  These are present only after the native
   * marker, lineage and persisted assistant identity were all observed for
   * this exact pending attempt.  They are deliberately not a general grant:
   * the API must still re-check the durable binding before it returns allow.
   */
  readonly workflow?: {
    binding: WorkflowBinding
    scope: WorkflowScope
    accounting: WorkflowAccounting
    nativeLineageDigest: string
  }
}

const frames = new Map<string, Map<string, GuardFrame>>()
const replaced = new WeakSet<GuardFrame>()

/** Install the attempt-scoped frame. Any older pending frame of the same SDK is replaced. */
export function installGuardFrame(frame: GuardFrame): () => void {
  const sdk = frame.request.sdkSessionId
  const bucket = frames.get(sdk) ?? new Map<string, GuardFrame>()
  for (const older of bucket.values()) replaced.add(older)
  bucket.set(frame.request.requestNonce, frame)
  frames.set(sdk, bucket)
  return () => {
    const current = frames.get(sdk)
    if (!current) return
    if (current.get(frame.request.requestNonce) === frame) current.delete(frame.request.requestNonce)
    if (current.size === 0) frames.delete(sdk)
  }
}

export function lookupGuardFrame(sdkSessionId: string, nonce: string): GuardFrame | undefined {
  return frames.get(sdkSessionId)?.get(nonce)
}

/** `pending` only while the attempt is live, un-aborted, un-replaced and under the current runner. */
export function guardFrameStatus(frame: GuardFrame): "pending" | "cancelled" | "replaced" {
  if (frame.signal.aborted) return "cancelled"
  if (replaced.has(frame)) return "replaced"
  // Positive equality with the SDK's CURRENT runner generation: a missing or different one is not pending.
  if (runnerGenerations.get(frame.request.sdkSessionId) !== frame.request.runnerGeneration) return "replaced"
  return "pending"
}

/** True only while this exact frame is still the live, current attempt (synchronous). */
export const guardFrameIsCurrent = (frame: GuardFrame) =>
  lookupGuardFrame(frame.request.sdkSessionId, frame.request.requestNonce) === frame &&
  guardFrameStatus(frame) === "pending"

/** Build the export reply for a nonce. `proofs` supplies stored-history facts (no text). */
export function buildGuardExport(
  sdkSessionId: string,
  nonce: string,
  sourceAnchorIds: string[],
  proofs: (frame: GuardFrame, anchors: string[]) => GuardSourceProof[],
): GuardPendingExport | GuardUnavailableExport {
  const frame = lookupGuardFrame(sdkSessionId, nonce)
  if (!frame) return { schemaVersion: 1, status: "not_pending" }
  const status = guardFrameStatus(frame)
  if (status !== "pending") return { schemaVersion: 1, status }
  const pending: GuardPendingExport = {
    schemaVersion: 1,
    status: "pending",
    request: frame.request,
    agentName: frame.agentName,
    userKind: frame.userKind,
    initiatingUserMessageId: frame.initiatingUserMessageId,
    inputGroupCount: frame.inputGroupCount,
    originCoverage: frame.originCoverage,
    sourceProofs: proofs(frame, sourceAnchorIds),
  }
  return pending
}

/**
 * G2 wrapper for the same pending-frame export. Keeping the V1 builder's
 * static return type preserves existing callers/tests; only the explicit
 * versioned HTTP consumer may receive this stricter envelope.
 */
export function buildWorkflowGuardExport(
  sdkSessionId: string,
  nonce: string,
  sourceAnchorIds: string[],
  proofs: (frame: GuardFrame, anchors: string[]) => GuardSourceProof[],
): GuardPendingExport | GuardUnavailableExport | WorkflowProviderPendingExport {
  const pending = buildGuardExport(sdkSessionId, nonce, sourceAnchorIds, proofs)
  if (pending.status !== "pending") return pending
  const frame = lookupGuardFrame(sdkSessionId, nonce)
  if (!frame?.workflow || guardFrameStatus(frame) !== "pending") return pending
  return {
    schemaVersion: 2,
    kind: "coordinator_workflow_provider_frame",
    binding: frame.workflow.binding,
    scope: frame.workflow.scope,
    accounting: frame.workflow.accounting,
    nativeLineageDigest: frame.workflow.nativeLineageDigest,
    frame: pending,
  }
}

/** Minimal stored-message shape used for proofs (matches MessageV2.WithParts). */
export interface ProofMessage {
  // `summary` is a boolean only on assistant messages (user messages carry a diff summary object).
  info: { id: string; role: string; parentID?: string; summary?: unknown }
  parts: Array<{ type: string; tail_start_id?: string }>
}

/**
 * Stored-history facts for source anchors, from native storage order only.
 * - `stored`: the anchor id exists as a stored message;
 * - `visible`: it is present in the prepared input of this attempt;
 * - `relation`: stored order relative to the attempt's current user message;
 * - `derivedSummaryIds`: summary assistants whose compaction covered the anchor
 *   (anchor precedes the compaction control message and, when a tail was kept, precedes
 *   the tail start). Conservative: later summaries chain earlier ones, so every later
 *   covering summary is listed.
 * Unknown order yields `relation:"unknown"` so the API holds.
 */
export function resolveSourceProofs(
  messages: readonly ProofMessage[],
  frame: GuardFrame,
  anchors: readonly string[],
): GuardSourceProof[] {
  const index = new Map(messages.map((message, position) => [message.info.id, position]))
  const current = index.get(frame.request.userMessageId)
  const summaries = messages.flatMap((control, position) => {
    const compaction = control.parts.find((part) => part.type === "compaction")
    if (control.info.role !== "user" || !compaction) return []
    const summary = messages.find(
      (candidate) =>
        candidate.info.role === "assistant" && candidate.info.summary === true && candidate.info.parentID === control.info.id,
    )
    if (!summary) return []
    const tail = compaction.tail_start_id === undefined ? undefined : index.get(compaction.tail_start_id)
    return [{ controlPosition: position, tailPosition: tail, summaryId: summary.info.id }]
  })
  return anchors.map((anchor): GuardSourceProof => {
    const position = index.get(anchor)
    if (position === undefined) {
      return { sourceAnchorId: anchor, stored: false, visible: frame.visibleMessageIds.has(anchor), relation: "unknown", derivedSummaryIds: [] }
    }
    const relation: GuardSourceProof["relation"] =
      current === undefined
        ? "unknown"
        : position < current
          ? "before_current"
          : position === current
            ? "current"
            : "after_current"
    const derivedSummaryIds = summaries
      .filter(
        (item) =>
          position < item.controlPosition && (item.tailPosition === undefined || position < item.tailPosition),
      )
      .map((item) => item.summaryId)
    return {
      sourceAnchorId: anchor,
      stored: true,
      visible: frame.visibleMessageIds.has(anchor),
      relation,
      derivedSummaryIds,
    }
  })
}

// ---------------------------------------------------------------------------
// Monotonic managed/enrolled SDK record (existing Storage, no schema change)
// ---------------------------------------------------------------------------

export interface GuardRecordV1 {
  schemaVersion: 1
  managedSeen: boolean
  guarded: boolean
}
export interface WorkflowManagerLineageRecord {
  kind: "manager_lineage"
  binding: WorkflowBinding
  engineGeneration: string
}
export interface WorkflowRootTurnRecord {
  kind: "root_turns"
  entries: Array<{ binding: WorkflowBinding; userMessageId: string; engineGeneration: string }>
}
export interface GuardRecordV2 {
  schemaVersion: 2
  managedSeen: true
  guarded: true
  workflow: WorkflowManagerLineageRecord | WorkflowRootTurnRecord
}
export type GuardRecord = GuardRecordV1 | GuardRecordV2

export type GuardRecordState =
  | { state: "absent" }
  | { state: "record"; record: GuardRecord }
  | { state: "error" }

// Native session ids are path-safe; anything else is refused rather than used as a file key.
const SAFE_SDK_ID = /^[A-Za-z0-9_-]{1,200}$/
const recordKey = (sdkSessionId: string) => ["rhythm", "dayflow-guard", sdkSessionId]
const recordLock = Semaphore.makeUnsafe(1)

const MAX_WORKFLOW_ROOT_ENTRIES = 16

function decodeRecord(raw: unknown): GuardRecord | undefined {
  if (!isObject(raw) || typeof raw.schemaVersion !== "number") return undefined
  if (raw.schemaVersion === 1) {
    if (!exactKeys(raw, ["schemaVersion", "managedSeen", "guarded"]) || typeof raw.managedSeen !== "boolean" || typeof raw.guarded !== "boolean") return undefined
    return { schemaVersion: 1, managedSeen: raw.managedSeen || raw.guarded, guarded: raw.guarded }
  }
  if (raw.schemaVersion !== 2 || !exactKeys(raw, ["schemaVersion", "managedSeen", "guarded", "workflow"]) || raw.managedSeen !== true || raw.guarded !== true || !isObject(raw.workflow)) return undefined
  if (raw.workflow.kind === "manager_lineage" && exactKeys(raw.workflow, ["kind", "binding", "engineGeneration"])) {
    const binding = parseWorkflowBinding(raw.workflow.binding)
    if (!binding.ok || !isGeneration(raw.workflow.engineGeneration)) return undefined
    return { schemaVersion: 2, managedSeen: true, guarded: true, workflow: { kind: "manager_lineage", binding: binding.value, engineGeneration: raw.workflow.engineGeneration } }
  }
  if (raw.workflow.kind === "root_turns" && exactKeys(raw.workflow, ["kind", "entries"]) && Array.isArray(raw.workflow.entries) && raw.workflow.entries.length <= MAX_WORKFLOW_ROOT_ENTRIES) {
    const seen = new Set<string>()
    const entries: WorkflowRootTurnRecord["entries"] = []
    for (const entry of raw.workflow.entries) {
      if (!isObject(entry) || !exactKeys(entry, ["binding", "userMessageId", "engineGeneration"])) return undefined
      const binding = parseWorkflowBinding(entry.binding)
      if (!binding.ok || !isId(entry.userMessageId) || !isGeneration(entry.engineGeneration) || seen.has(entry.userMessageId)) return undefined
      seen.add(entry.userMessageId)
      entries.push({ binding: binding.value, userMessageId: entry.userMessageId, engineGeneration: entry.engineGeneration })
    }
    return { schemaVersion: 2, managedSeen: true, guarded: true, workflow: { kind: "root_turns", entries } }
  }
  return undefined
}

/** Read the record. A corrupt or unreadable record is `error` (callers hold), never `absent`. */
export const readGuardRecord = Effect.fn("RhythmProviderGuard.readRecord")(function* (sdkSessionId: string) {
  if (!SAFE_SDK_ID.test(sdkSessionId)) return { state: "error" } satisfies GuardRecordState
  const storage = yield* Storage.Service
  const read = yield* storage.read<unknown>(recordKey(sdkSessionId)).pipe(
    Effect.map((raw) => ({ found: true as const, raw })),
    Effect.catchIf(Storage.NotFoundError.isInstance, () => Effect.succeed({ found: false as const, raw: undefined })),
    Effect.catch(() => Effect.succeed(undefined)),
  )
  if (!read) return { state: "error" } satisfies GuardRecordState
  if (!read.found) return { state: "absent" } satisfies GuardRecordState
  const record = decodeRecord(read.raw)
  return record ? ({ state: "record", record } satisfies GuardRecordState) : ({ state: "error" } satisfies GuardRecordState)
})

/**
 * Monotonic merge: flags only ever become true; there is no disable path. An
 * unreadable record is a hold rather than evidence it was ordinary: otherwise
 * an unknown schema-2 workflow marker could be overwritten by a v1 write.
 */
const raise = (sdkSessionId: string, next: { managedSeen: true; guarded?: true }) =>
  Effect.gen(function* () {
    if (!SAFE_SDK_ID.test(sdkSessionId)) return yield* Effect.die(new Error("Unsafe SDK session id for guard record"))
    const storage = yield* Storage.Service
    const existing = yield* readGuardRecord(sdkSessionId)
    if (existing.state === "error") return yield* Effect.die(new Error("Unreadable Rhythm guard record"))
    const prior = existing.state === "record" ? existing.record : undefined
    // A legacy enrollment/flag-raise may never erase the stricter workflow
    // discriminator. Its already-monotonic flags are enough for the v1 caller.
    if (prior?.schemaVersion === 2) return prior
    const record: GuardRecord = {
      schemaVersion: 1,
      managedSeen: true,
      guarded: prior?.guarded === true || next.guarded === true,
    }
    if (prior && prior.managedSeen === record.managedSeen && prior.guarded === record.guarded) return record
    yield* storage.write(recordKey(sdkSessionId), record)
    return record
  }).pipe(Semaphore.withPermit(recordLock))

/** Record that a trusted managed integration was observed for this SDK. Never clears `guarded`. */
export const markGuardManagedSeen = Effect.fn("RhythmProviderGuard.markManagedSeen")(function* (sdkSessionId: string) {
  return yield* raise(sdkSessionId, { managedSeen: true })
})

/** Durable, idempotent enrollment. Succeeds only after the write. */
export const enrollGuard = Effect.fn("RhythmProviderGuard.enroll")(function* (sdkSessionId: string) {
  yield* raise(sdkSessionId, { managedSeen: true, guarded: true })
  return {
    schemaVersion: 1,
    sdkSessionId,
    engineGeneration: ENGINE_GENERATION,
    guarded: true,
  } satisfies GuardEnrollmentResponse
})

function bindingLive(binding: WorkflowBinding, now = Date.now()) {
  return Date.parse(binding.expiresAt) > now
}

/**
 * Upgrade a valid v1 guard record, or append/replay only the exact immutable
 * workflow marker. This writes before any caller can expose a provider request.
 * Expired root entries are the sole removable cache entries; durable API job
 * membership is intentionally not represented or retired here.
 */
export const enrollWorkflowGuard = Effect.fn("RhythmProviderGuard.enrollWorkflow")(function* (
  sdkSessionId: string,
  enrollment: WorkflowEnrollmentRequest,
) {
  if (!SAFE_SDK_ID.test(sdkSessionId)) return yield* Effect.die(new Error("Unsafe SDK session id for workflow guard"))
  const parsed = parseWorkflowEnrollmentRequest(enrollment)
  if (!parsed.ok) return yield* Effect.die(new Error("Invalid workflow guard enrollment"))
  const storage = yield* Storage.Service
  return yield* Effect.gen(function* () {
    const existing = yield* readGuardRecord(sdkSessionId)
    if (existing.state === "error") return yield* Effect.die(new Error("Unreadable Rhythm guard record"))
    const prior = existing.state === "record" ? existing.record : undefined
    let next: GuardRecordV2
    if (enrollment.scope.kind === "manager_lineage") {
      const marker: WorkflowManagerLineageRecord = {
        kind: "manager_lineage", binding: enrollment.binding, engineGeneration: ENGINE_GENERATION,
      }
      if (prior?.schemaVersion === 2) {
        if (prior.workflow.kind !== "manager_lineage" || !sameWorkflowBinding(prior.workflow.binding, marker.binding) || prior.workflow.engineGeneration !== marker.engineGeneration) {
          return yield* Effect.die(new Error("Conflicting workflow manager enrollment"))
        }
        next = prior
      } else {
        next = { schemaVersion: 2, managedSeen: true, guarded: true, workflow: marker }
      }
    } else {
      const entry = { binding: enrollment.binding, userMessageId: enrollment.scope.userMessageId, engineGeneration: ENGINE_GENERATION }
      if (prior?.schemaVersion === 2 && prior.workflow.kind === "manager_lineage") {
        return yield* Effect.die(new Error("Workflow lineage/root enrollment mix"))
      }
      const entries = prior?.schemaVersion === 2 && prior.workflow.kind === "root_turns"
        ? prior.workflow.entries.filter((candidate) => bindingLive(candidate.binding))
        : []
      const same = entries.find((candidate) => candidate.userMessageId === entry.userMessageId)
      if (same && (!sameWorkflowBinding(same.binding, entry.binding) || same.engineGeneration !== entry.engineGeneration)) {
        return yield* Effect.die(new Error("Conflicting workflow root enrollment"))
      }
      if (!same) entries.push(entry)
      if (entries.length > MAX_WORKFLOW_ROOT_ENTRIES) return yield* Effect.die(new Error("Workflow root enrollment bound"))
      next = { schemaVersion: 2, managedSeen: true, guarded: true, workflow: { kind: "root_turns", entries } }
    }
    if (prior?.schemaVersion !== 2 || canonicalJson(prior) !== canonicalJson(next)) yield* storage.write(recordKey(sdkSessionId), next)
    return {
      schemaVersion: 2,
      kind: "coordinator_workflow_enrollment",
      sdkSessionId,
      engineGeneration: ENGINE_GENERATION,
      guarded: true,
      binding: enrollment.binding,
      scope: enrollment.scope,
    } satisfies WorkflowEnrollmentResponse
  }).pipe(Semaphore.withPermit(recordLock))
})

/** Strict current marker lookup for projection/create/task paths. */
export const workflowGuardFor = Effect.fn("RhythmProviderGuard.workflowFor")(function* (sdkSessionId: string) {
  const record = yield* readGuardRecord(sdkSessionId)
  if (record.state !== "record" || record.record.schemaVersion !== 2) return undefined
  return record.record.workflow
})

/**
 * Native sub-sessions inherit only a verified manager-lineage marker.  Root
 * turn anchors intentionally do not taint every ordinary child. This happens
 * before Session.Created publication, so a failed durable write leaves no
 * exposed child session that could later reach a provider unregistered.
 */
export const inheritWorkflowGuard = Effect.fn("RhythmProviderGuard.inherit")(function* (
  parentSdkSessionId: string | undefined,
  childSdkSessionId: string,
) {
  if (!parentSdkSessionId) return false
  const parent = yield* readGuardRecord(parentSdkSessionId)
  if (parent.state === "error") return yield* Effect.die(new Error("Unreadable parent Rhythm guard record"))
  if (parent.state !== "record" || parent.record.schemaVersion !== 2 || parent.record.workflow.kind !== "manager_lineage") return false
  const enrollment: WorkflowEnrollmentRequest = {
    schemaVersion: 2,
    kind: "coordinator_workflow_enrollment",
    binding: parent.record.workflow.binding,
    scope: { kind: "manager_lineage" },
  }
  yield* enrollWorkflowGuard(childSdkSessionId, enrollment)
  return true
})
