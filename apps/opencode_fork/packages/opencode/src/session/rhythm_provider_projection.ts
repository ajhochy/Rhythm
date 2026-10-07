/**
 * Rhythm carried patch (Dayflow native/API contract, provider slice): per-attempt
 * guard around the actual provider call.
 *
 * Builds on the frozen C1 contract in `rhythm_provider_guard.ts`. For a Rhythm-managed
 * SDK session, every real `doStream`/`doGenerate` attempt (tool-loop step, transport
 * retry, compaction) is held until the existing local Rhythm API returns a decision
 * bound to that exact prepared input. Only the provider-input COPY is changed; stored
 * history/UI transcript is never touched. Source text never leaves this process except
 * as the provider request itself; the admission request carries identities and a digest.
 *
 * Origin identity is a transient per-attempt sidecar: real stored message ids attached
 * (as a private `providerOptions` marker) to the converted model messages, stripped
 * before the provider sees them. No persisted lineage store.
 */
import type { LanguageModelV3Middleware, LanguageModelV3Prompt } from "@ai-sdk/provider"
import type { ModelMessage } from "ai"
import * as Log from "@opencode-ai/core/util/log"
import {
  canonicalJson,
  ENGINE_GENERATION,
  GUARD_ADMISSION_PATH,
  GUARD_BOUNDS,
  guardFrameIsCurrent,
  guardInputDigest,
  installGuardFrame,
  newGuardNonce,
  parseGuardRequest,
  parseGuardResponseText,
  parseWorkflowProviderDecision,
  parseWorkflowProviderRequest,
  runnerGenerations,
  sha256Hex,
  type GuardFrame,
  type GuardPurpose,
  type GuardReason,
  type GuardRecord,
  type GuardRequest,
  type GuardResponse,
  type WorkflowProviderDecision,
  type WorkflowProviderRequest,
} from "./rhythm_provider_guard"
import { rhythmWorkflowLineageDigest } from "./session"

const log = Log.create({ service: "rhythm.provider-guard" })

export type PromptMessage = LanguageModelV3Prompt[number]
/** Private providerOptions key carrying `{ o: <entry index> }` or `{ c: 1 }` (trailing control). */
export const GUARD_MARKER = "rhythm_guard"

/** Thrown instead of exposing a provider request. Body-free by construction. */
export class RhythmProviderGuardHold extends Error {
  constructor(readonly reason: GuardReason) {
    super(`Dayflow provider guard held this request (${reason}).`)
    this.name = "RhythmProviderGuardHold"
  }
}

// ---------------------------------------------------------------------------
// Origins (real stored identities for the prepared input)
// ---------------------------------------------------------------------------

export type OriginKind = "authored_user" | "synthetic_user" | "assistant" | "derived_summary" | "control"

export interface OriginEntry {
  /** Real stored message id. */
  id: string
  kind: OriginKind
  /** Number of model messages this stored message converted into. */
  count: number
  toolCallIds: string[]
  /** Completed-group content digest (assistant entries only; undefined unless terminal and clean). */
  contentDigest?: string
}

export interface ProviderOrigins {
  purpose: GuardPurpose
  /** The user message this call answers (answer) or the compaction control message. */
  userMessageId: string
  userKind: "authored" | "control"
  initiatingUserMessageId: string | null
  /** Static native model messages before the stored entries (e.g. the title instruction). */
  leadingStatic: number
  entries: OriginEntry[]
  /** One trailing synthetic control prompt (compaction); `derived` if it embeds prior summary/plugin context. */
  trailingControl?: { id: string; derived: boolean; staticText?: string }
  /** Static native model messages after everything else (e.g. the max-steps notice). */
  trailingStatic: number
}
export type OriginSource = () => Promise<ProviderOrigins>

export interface StoredMessageLike {
  info: { id: string; role: string; summary?: unknown }
  parts: Array<{ type: string; synthetic?: boolean; callID?: string }>
}

function originKind(message: StoredMessageLike): OriginKind {
  if (message.info.role === "assistant") return message.info.summary === true ? "derived_summary" : "assistant"
  if (message.parts.some((part) => part.type === "compaction")) return "control"
  return message.parts.some((part) => part.type !== "text" || part.synthetic !== true) ? "authored_user" : "synthetic_user"
}

/** Build the per-attempt origin sidecar from the stored messages that were converted. */
export async function buildProviderOrigins(input: {
  purpose: GuardPurpose
  userMessageId: string
  /** Stored messages that were converted to model messages, in order. */
  messages: readonly StoredMessageLike[]
  /** Stored messages used to find the current user (defaults to `messages`). */
  context?: readonly StoredMessageLike[]
  convertedCount: (message: StoredMessageLike) => Promise<number>
  leadingStatic?: number
  trailingStatic?: number
  trailingControl?: ProviderOrigins["trailingControl"]
}): Promise<ProviderOrigins> {
  const context = input.context ?? input.messages
  const currentIndex = context.findIndex((message) => message.info.id === input.userMessageId)
  const current = currentIndex >= 0 ? context[currentIndex] : undefined
  const userKind = current && originKind(current) === "control" ? "control" : "authored"
  let initiating: string | null = null
  if (userKind === "control") {
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (originKind(context[i]!) === "authored_user") {
        initiating = context[i]!.info.id
        break
      }
    }
  }
  const entries: OriginEntry[] = []
  for (const message of input.messages) {
    const count = await input.convertedCount(message)
    if (count <= 0) continue
    const kind = originKind(message)
    const toolCallIds = message.parts.flatMap((part) => (part.type === "tool" && part.callID ? [part.callID] : []))
    entries.push({
      id: message.info.id,
      kind,
      count,
      toolCallIds,
      ...(kind === "assistant"
        ? { contentDigest: completedGroupDigest(message as unknown as CompletedGroupLike, toolCallIds) }
        : {}),
    })
  }
  return {
    purpose: input.purpose,
    userMessageId: input.userMessageId,
    userKind,
    initiatingUserMessageId: initiating,
    leadingStatic: input.leadingStatic ?? 0,
    entries,
    ...(input.trailingControl ? { trailingControl: input.trailingControl } : {}),
    trailingStatic: input.trailingStatic ?? 0,
  }
}

type Owner = number | "c" | undefined

/** Owner of each model message, or undefined when the counts do not account for the input exactly. */
export function originOwners(origins: ProviderOrigins, total: number): Owner[] | undefined {
  const owners: Owner[] = []
  for (let i = 0; i < origins.leadingStatic; i++) owners.push(undefined)
  origins.entries.forEach((entry, index) => {
    for (let i = 0; i < entry.count; i++) owners.push(index)
  })
  if (origins.trailingControl) owners.push("c")
  for (let i = 0; i < origins.trailingStatic; i++) owners.push(undefined)
  return owners.length === total ? owners : undefined
}

/** Attach the private origin marker to the converted model messages (returns the input if unaccounted). */
export function markModelMessages(messages: ModelMessage[], origins: ProviderOrigins): ModelMessage[] {
  const owners = originOwners(origins, messages.length)
  if (!owners) return messages
  return messages.map((message, index) => {
    const owner = owners[index]
    if (owner === undefined) return message
    const marker = owner === "c" ? { c: 1 } : { o: owner }
    return { ...message, providerOptions: { ...message.providerOptions, [GUARD_MARKER]: marker } } as ModelMessage
  })
}

// ---------------------------------------------------------------------------
// Prompt analysis, projection (copy only)
// ---------------------------------------------------------------------------

const markerOf = (message: PromptMessage): { o?: number; c?: number } | undefined => {
  const marker = (message.providerOptions as Record<string, unknown> | undefined)?.[GUARD_MARKER]
  return marker && typeof marker === "object" ? (marker as { o?: number; c?: number }) : undefined
}

export function stripMarkers(prompt: PromptMessage[]): PromptMessage[] {
  return prompt.map((message) => {
    const options = message.providerOptions as Record<string, unknown> | undefined
    if (!options || !(GUARD_MARKER in options)) return message
    const { [GUARD_MARKER]: _marker, ...rest } = options
    const copy = { ...message } as PromptMessage & { providerOptions?: unknown }
    if (Object.keys(rest).length > 0) copy.providerOptions = rest as typeof copy.providerOptions
    else delete copy.providerOptions
    return copy as PromptMessage
  })
}

interface Analysis {
  coverage: "complete" | "ambiguous"
  groups: Array<Record<string, unknown>>
  visible: Set<string>
  nonSystemCount: number
}

function analyze(prompt: PromptMessage[], origins: ProviderOrigins | undefined): Analysis {
  const nonSystem = prompt.filter((message) => message.role !== "system")
  if (!origins) return { coverage: "ambiguous", groups: [], visible: new Set(), nonSystemCount: nonSystem.length }
  const found = new Array<number>(origins.entries.length).fill(0)
  let control = 0
  let complete = true
  for (const message of nonSystem) {
    const marker = markerOf(message)
    if (marker?.o !== undefined && marker.o >= 0 && marker.o < found.length) found[marker.o]!++
    else if (marker?.c !== undefined) control++
    else if (!isStaticPosition(message, nonSystem, origins)) complete = false
  }
  // Every stored message must be accounted for exactly; a dropped/merged message is ambiguous.
  origins.entries.forEach((entry, index) => {
    if (found[index] !== entry.count) complete = false
  })
  if (origins.trailingControl && control !== 1) complete = false
  const visible = new Set<string>()
  const groups: Array<Record<string, unknown>> = []
  origins.entries.forEach((entry, index) => {
    if (found[index]! <= 0) return
    visible.add(entry.id)
    groups.push({
      groupId: entry.id,
      kind: entry.kind,
      nativeMessageIds: [entry.id],
      ...(entry.toolCallIds.length > 0 ? { toolCallIds: entry.toolCallIds } : {}),
    })
  })
  if (origins.trailingControl) {
    visible.add(origins.trailingControl.id)
    groups.push({
      groupId: `${origins.trailingControl.id}:control`,
      kind: "synthetic_control",
      nativeMessageIds: [origins.trailingControl.id],
      derived: origins.trailingControl.derived,
      ...(origins.initiatingUserMessageId ? { initiatingUserMessageId: origins.initiatingUserMessageId } : {}),
    })
  }
  return { coverage: complete ? "complete" : "ambiguous", groups, visible, nonSystemCount: nonSystem.length }
}

// Unmarked non-system messages are acceptable only for the declared static positions.
function isStaticPosition(message: PromptMessage, nonSystem: PromptMessage[], origins: ProviderOrigins) {
  const position = nonSystem.indexOf(message)
  return position < origins.leadingStatic || position >= nonSystem.length - origins.trailingStatic
}

const toolIds = (prompt: PromptMessage[]) => {
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const message of prompt) {
    if (!Array.isArray(message.content)) continue
    for (const part of message.content as Array<{ type: string; toolCallId?: string }>) {
      if (!part.toolCallId) continue
      if (part.type === "tool-call") calls.add(part.toolCallId)
      if (part.type === "tool-result") results.add(part.toolCallId)
    }
  }
  return { calls, results }
}
const unpaired = (prompt: PromptMessage[]) => {
  const { calls, results } = toolIds(prompt)
  return new Set([...calls].filter((id) => !results.has(id)).concat([...results].filter((id) => !calls.has(id))))
}

/**
 * Remove the provider-input copy's potentially dependent assistant/tool/summary groups.
 * Rule: drop whole stored assistant / derived-summary entries that are the projection anchor
 * or come after the earliest affected anchor (stored order; message ids are ascending);
 * authored users and static text are kept. Tool call/result pairs leave together. A trailing
 * compaction control prompt that embeds derived spans is replaced by its static-only text,
 * or the request is held. Returns undefined (=> hold) when this cannot be established.
 */
export function projectPrompt(
  prompt: PromptMessage[],
  origins: ProviderOrigins,
  projection: { fromUserMessageId: string; sourceAnchorIds: string[] },
  coverage: "complete" | "ambiguous",
  /** Entry indexes proved clean by a runner certificate (whole groups); never anchors or summaries. */
  exempt: ReadonlySet<number> = new Set(),
): PromptMessage[] | undefined {
  if (coverage !== "complete") return undefined
  const entries = origins.entries
  const fromIndex = entries.findIndex((entry) => entry.id === projection.fromUserMessageId)
  const anchors = new Set(projection.sourceAnchorIds)
  const comparable = (id: string) => id.startsWith("msg")
  const removed = new Set<number>()
  for (const [index, entry] of entries.entries()) {
    if (entry.kind !== "assistant" && entry.kind !== "derived_summary") continue
    if (exempt.has(index) && entry.kind === "assistant" && !anchors.has(entry.id)) continue
    let after: boolean
    if (fromIndex >= 0) after = index >= fromIndex
    else if (comparable(entry.id) && comparable(projection.fromUserMessageId)) after = entry.id > projection.fromUserMessageId
    else return undefined
    if (after || anchors.has(entry.id)) removed.add(index)
  }
  const before = unpaired(prompt)
  const next: PromptMessage[] = []
  for (const message of prompt) {
    const marker = markerOf(message)
    if (marker?.o !== undefined && removed.has(marker.o)) continue
    if (marker?.c !== undefined && origins.trailingControl?.derived) {
      const staticText = origins.trailingControl.staticText
      if (staticText === undefined) return undefined
      next.push({ ...message, content: [{ type: "text", text: staticText }] } as PromptMessage)
      continue
    }
    next.push(message)
  }
  const after = unpaired(next)
  if ([...after].some((id) => !before.has(id))) return undefined
  const rest = next.filter((message) => message.role !== "system")
  if (rest.length === 0) return undefined
  return next
}

/** Remove the stored user.system text (legacy overlay) from the leading system text / OAuth instructions. */
export function removeUserSystem(
  prompt: PromptMessage[],
  instructions: string | undefined,
  userSystem: string,
): { prompt: PromptMessage[]; instructions: string | undefined } | undefined {
  const leading = prompt.filter((message) => message.role === "system")
  const texts = [...leading.map((message) => message.content as string), ...(instructions === undefined ? [] : [instructions])]
  const occurrences = texts.reduce((sum, text) => sum + (text.split(userSystem).length - 1), 0)
  if (occurrences !== 1) return undefined
  const cut = (text: string) => {
    const at = text.indexOf(userSystem)
    if (at < 0) return text
    const start = at > 0 && text[at - 1] === "\n" ? at - 1 : at
    return text.slice(0, start) + text.slice(at + userSystem.length)
  }
  const next = prompt.flatMap((message) => {
    if (message.role !== "system") return [message]
    const text = cut(message.content as string)
    if ((message.content as string) === text) return [message]
    return text.trim() === "" ? [] : [{ ...message, content: text } as PromptMessage]
  })
  return { prompt: next, instructions: instructions === undefined ? undefined : cut(instructions) }
}

function insertOverlay(prompt: PromptMessage[], instructions: string | undefined, overlay: string) {
  if (instructions !== undefined) return { prompt, instructions: `${instructions}\n${overlay}` }
  let at = 0
  while (at < prompt.length && prompt[at]!.role === "system") at++
  return {
    prompt: [...prompt.slice(0, at), { role: "system", content: overlay } as PromptMessage, ...prompt.slice(at)],
    instructions,
  }
}

// ---------------------------------------------------------------------------
// Trusted Rhythm integration (server-configured MCP entry only)
// ---------------------------------------------------------------------------

export interface RhythmIntegration {
  url: string
  token: string
}

/**
 * The existing local Rhythm API URL and token, only from the server-configured `rhythm` local
 * MCP entry. Loopback http only; never the production URL; never from session/user input.
 */
export function trustedRhythmIntegration(cfg: { mcp?: Record<string, unknown> | undefined }): RhythmIntegration | undefined {
  const entry = cfg.mcp?.rhythm as
    | { type?: unknown; enabled?: unknown; environment?: Record<string, unknown> }
    | undefined
  if (!entry || entry.type !== "local" || entry.enabled === false) return undefined
  const url = entry.environment?.RHYTHM_AGENT_URL
  const token = entry.environment?.RHYTHM_API_TOKEN
  if (typeof url !== "string" || typeof token !== "string" || token.length === 0 || token.length > 4096) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  if (parsed.protocol !== "http:" || !loopback || parsed.username || parsed.password) return undefined
  return { url: parsed.origin, token }
}

// ---------------------------------------------------------------------------
// Admission exchange (one bounded read per provider attempt)
// ---------------------------------------------------------------------------

/** Replaceable only by tests (synthetic API); production uses global fetch. */
export const guardTransport: { fetch: (input: string, init: RequestInit) => Promise<Response> } = {
  fetch: (input, init) => globalThis.fetch(input, init),
}

async function readCapped(response: Response, cap: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > cap) throw new Error("response too large")
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > cap) {
      await reader.cancel().catch(() => undefined)
      throw new Error("response too large")
    }
    chunks.push(next.value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

export async function postAdmission(
  integration: RhythmIntegration,
  request: GuardRequest,
  signal: AbortSignal,
): Promise<GuardResponse | undefined> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(GUARD_BOUNDS.exchangeDeadlineMs)])
  try {
    const response = await guardTransport.fetch(new URL(GUARD_ADMISSION_PATH, integration.url).toString(), {
      method: "POST",
      headers: { authorization: `Bearer ${integration.token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: deadline,
      redirect: "error",
    })
    if (response.status !== 200) return undefined
    const parsed = parseGuardResponseText(await readCapped(response, GUARD_BOUNDS.responseBytes), request)
    return parsed.ok ? parsed.value : undefined
  } catch {
    return undefined
  }
}

/** The G2 envelope uses the same trusted authenticated route, never a second transport. */
export async function postWorkflowAdmission(
  integration: RhythmIntegration,
  request: WorkflowProviderRequest,
  signal: AbortSignal,
): Promise<WorkflowProviderDecision | undefined> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(GUARD_BOUNDS.exchangeDeadlineMs)])
  try {
    const response = await guardTransport.fetch(new URL(GUARD_ADMISSION_PATH, integration.url).toString(), {
      method: "POST",
      headers: { authorization: `Bearer ${integration.token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: deadline,
      redirect: "error",
    })
    if (response.status !== 200) return undefined
    const raw = JSON.parse(await readCapped(response, GUARD_BOUNDS.responseBytes))
    const parsed = parseWorkflowProviderDecision(raw, request)
    return parsed.ok ? parsed.value : undefined
  } catch {
    return undefined
  }
}

/**
 * Derive the private G2 frame only from the durable native marker and current
 * runner/session facts. A marker from an older engine, a root marker for a
 * different exact user turn, or an auxiliary call has no provider path.
 */
function workflowFactsFor(ctx: GuardAttemptContext): NonNullable<GuardFrame["workflow"]> | undefined {
  const workflow = ctx.record?.schemaVersion === 2 ? ctx.record.workflow : undefined
  if (!workflow || !ctx.outputAssistantId) return undefined
  if (workflow.kind === "manager_lineage") {
    if (workflow.engineGeneration !== ENGINE_GENERATION || Date.parse(workflow.binding.expiresAt) <= Date.now()) return undefined
    const nativeLineageDigest = rhythmWorkflowLineageDigest(ctx.sdkSessionId as never)
    if (!nativeLineageDigest) return undefined
    return {
      binding: workflow.binding,
      scope: { kind: "manager_lineage" },
      accounting: {
        kind: "persisted_assistant",
        assistantMessageId: ctx.outputAssistantId,
        parentMessageId: ctx.userMessageId,
      },
      nativeLineageDigest,
    }
  }
  const entry = workflow.entries.find((candidate) => candidate.userMessageId === ctx.userMessageId)
  if (!entry || entry.engineGeneration !== ENGINE_GENERATION || Date.parse(entry.binding.expiresAt) <= Date.now()) return undefined
  const nativeLineageDigest = rhythmWorkflowLineageDigest(ctx.sdkSessionId as never)
  if (!nativeLineageDigest) return undefined
  return {
    binding: entry.binding,
    scope: { kind: "root_turn", userMessageId: entry.userMessageId },
    accounting: {
      kind: "persisted_assistant",
      assistantMessageId: ctx.outputAssistantId,
      parentMessageId: ctx.userMessageId,
    },
    nativeLineageDigest,
  }
}

// ---------------------------------------------------------------------------
// Clean-generation certificates (transient, runner-scoped)
// ---------------------------------------------------------------------------

/**
 * Proof that ONE assistant message (its complete set of tool calls) was generated by an actual
 * provider exposure that was itself safely projected with no overlay. It lets the NEXT strictly
 * admitted `project` request keep that whole group instead of withholding it with the old tainted
 * suffix — but only under the same authoritative basis digest, projection anchors, agent and runner.
 * Never exported, never persisted, never a grant: it lives only while the current runner does.
 */
export interface CleanGroupCertificate {
  assistantId: string
  toolCallIds: string[]
  agentName: string
  basisDigest: string
  fromUserMessageId: string
  sourceAnchorIds: string[]
  /** Final prepared-input digest of the generating attempt (identity, not authority). */
  generatingInputDigest: string
  /**
   * Digest of the model-visible content of the COMPLETED canonical group, set exactly once by
   * `sealCleanGroup`. A certificate without it is provisional (generation provenance only) and
   * never exempts anything. It is never recomputed or refreshed after an edit.
   */
  contentDigest?: string
}
const MAX_CERTIFICATES = 64
const certificates = new Map<string, { generation: string; items: Map<string, CleanGroupCertificate> }>()

/** Provisional generation provenance, recorded at the actual provider handoff. Never overwrites a sealed one. */
export function registerCleanGroup(sdkSessionId: string, generation: string, certificate: CleanGroupCertificate) {
  if (runnerGenerations.get(sdkSessionId) !== generation) return
  let bucket = certificates.get(sdkSessionId)
  if (!bucket || bucket.generation !== generation) {
    bucket = { generation, items: new Map() }
    certificates.set(sdkSessionId, bucket)
  }
  if (bucket.items.get(certificate.assistantId)?.contentDigest !== undefined) return
  bucket.items.delete(certificate.assistantId)
  bucket.items.set(certificate.assistantId, { ...certificate, contentDigest: undefined })
  if (bucket.items.size > MAX_CERTIFICATES) bucket.items.delete(bucket.items.keys().next().value as string)
}

/** Sealed certificates only, and only under the SDK's current runner generation. */
export function cleanGroupFor(sdkSessionId: string, assistantId: string): CleanGroupCertificate | undefined {
  const bucket = certificates.get(sdkSessionId)
  if (!bucket || bucket.generation !== runnerGenerations.get(sdkSessionId)) return undefined
  const certificate = bucket.items.get(assistantId)
  return certificate?.contentDigest === undefined ? undefined : certificate
}

/** Minimal canonical group shape (matches MessageV2.WithParts). */
export interface CompletedGroupLike {
  info: { id: string; role: string; summary?: unknown; error?: unknown; finish?: unknown }
  parts: Array<{ type: string; [key: string]: any }>
}

/**
 * Digest of the ordered canonical content of a terminal, successful assistant group. It retains the
 * whole canonical group — the assistant's provider/model selectors, every part in order with its kind
 * (so step-start markers count), ALL top-level part fields including provider metadata
 * (`providerExecuted` lives there), generated text/reasoning, and each tool part's name, call id,
 * status, input, output, MCP content and attachments in full, plus the exact `compacted` value
 * (0 and 1 differ; the converter tests truthiness). It removes ONLY accounting that the actual
 * conversion never reads and that normal completion legitimately changes: part/message ids, per-part
 * `time` (except `compacted`), tokens, cost, snapshots, and a tool state's title/metadata/start/end.
 * (A tool state's `metadata` is accounting; the part's top-level `metadata` is provider metadata and
 * is kept.) Retaining a currently unrendered field is deliberate; no second converter exists here.
 * Undefined (no exemption possible) for a summary, an errored/unfinished assistant, any tool part
 * that is not completed, or a tool-call set different from the expected one.
 */
export function completedGroupDigest(group: CompletedGroupLike, expectedToolCallIds: readonly string[]): string | undefined {
  if (group.info.role !== "assistant" || group.info.summary === true) return undefined
  if (group.info.error || group.info.finish === undefined) return undefined
  const tools = group.parts.filter((part) => part.type === "tool")
  if (tools.some((part) => part.state?.status !== "completed")) return undefined
  if (!sameSet(tools.map((part) => String(part.callID)), expectedToolCallIds)) return undefined
  const info = group.info as { providerID?: unknown; modelID?: unknown }
  const parts = group.parts.map((part) => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(part)) {
      if (COMPLETED_PART_ACCOUNTING.has(key)) continue
      out[key] = key === "state" && part.type === "tool" ? canonicalToolState(value as Record<string, any>) : value
    }
    return out
  })
  return sha256Hex(canonicalJson({ provider: info.providerID ?? null, model: info.modelID ?? null, parts }))
}

// Part-level fields the assistant conversion never reads and that completion legitimately rewrites.
const COMPLETED_PART_ACCOUNTING = new Set(["id", "messageID", "sessionID", "time", "tokens", "cost", "snapshot"])

function canonicalToolState(state: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state ?? {})) {
    if (key === "title" || key === "metadata" || key === "time") continue
    out[key] = value
  }
  out.compacted = state?.time?.compacted ?? null // exact value, never presence
  return out
}

/**
 * Seal ONCE, after the generating step completed canonically: the provisional certificate for this
 * assistant is finished with the group's content digest, or dropped when the group is not a clean
 * terminal success (pending/running/error/interrupted/partial/ambiguous). A sealed certificate is
 * never resealed, so a later edit can only fail the comparison.
 */
export function sealCleanGroup(sdkSessionId: string, assistantId: string, group: CompletedGroupLike | undefined): boolean {
  const bucket = certificates.get(sdkSessionId)
  if (!bucket || bucket.generation !== runnerGenerations.get(sdkSessionId)) return false
  const certificate = bucket.items.get(assistantId)
  if (!certificate || certificate.contentDigest !== undefined) return false
  const digest = group && group.info.id === assistantId ? completedGroupDigest(group, certificate.toolCallIds) : undefined
  if (digest === undefined) {
    bucket.items.delete(assistantId)
    return false
  }
  bucket.items.set(assistantId, { ...certificate, contentDigest: digest })
  return true
}

/** Disposed with the existing runner creation/idle/cancel/finalization. */
export function clearRunnerCertificates(sdkSessionId: string) {
  certificates.delete(sdkSessionId)
}

const canonicalSet = (values: readonly string[]) => JSON.stringify([...new Set(values)].toSorted())
const sameSet = (a: readonly string[], b: readonly string[]) => canonicalSet(a) === canonicalSet(b)

/** Entry indexes whose whole group is covered by a certificate matching this fresh decision. */
export function exemptCleanGroups(
  ctx: Pick<GuardAttemptContext, "sdkSessionId" | "agentName" | "purpose">,
  origins: ProviderOrigins,
  decision: GuardResponse,
): Set<number> {
  const exempt = new Set<number>()
  if (ctx.purpose !== "answer" || !decision.projection) return exempt
  origins.entries.forEach((entry, index) => {
    if (entry.kind !== "assistant") return
    const certificate = cleanGroupFor(ctx.sdkSessionId, entry.id)
    if (!certificate) return
    if (certificate.agentName !== ctx.agentName) return
    if (certificate.basisDigest !== decision.basisDigest) return
    if (certificate.fromUserMessageId !== decision.projection!.fromUserMessageId) return
    if (!sameSet(certificate.sourceAnchorIds, decision.projection!.sourceAnchorIds)) return
    if (!sameSet(certificate.toolCallIds, entry.toolCallIds)) return
    // The receiving whole group must carry exactly the sealed completed content (edits lose the exemption).
    if (entry.contentDigest === undefined || entry.contentDigest !== certificate.contentDigest) return
    exempt.add(index)
  })
  return exempt
}

// ---------------------------------------------------------------------------
// Attempt middleware
// ---------------------------------------------------------------------------

export interface GuardAttemptContext {
  sdkSessionId: string
  userMessageId: string
  agentName: string
  purpose: GuardPurpose
  userKind: "authored" | "control"
  initiatingUserMessageId: string | null
  origins: ProviderOrigins | undefined
  /** Stored `user.system` text of the answered user, the only legacy overlay span. */
  userSystem: string | undefined
  /** Durable record at attempt start; undefined = unreadable (never treated as ordinary). */
  record: GuardRecord | undefined
  integration: RhythmIntegration | undefined
  signal: AbortSignal
  isWorkflow: boolean
  /** The real processor assistant message that this call's output is stored into (answer only). */
  outputAssistantId?: string
}

/** Per-attempt facts carried from the checked transform to the actual provider handoff. */
interface Handoff {
  generation: string
  request: GuardRequest
  basisDigest: string
  fromUserMessageId?: string
  sourceAnchorIds?: string[]
  /** Rechecked synchronously immediately before the actual provider call. */
  workflow?: NonNullable<GuardFrame["workflow"]>
}
const handoffs = new WeakMap<object, Handoff>()

const attempts = new Map<string, number>()
function nextAttempt(sdkSessionId: string, userMessageId: string) {
  const key = `${sdkSessionId}|${userMessageId}`
  const value = attempts.get(key) ?? 0
  attempts.delete(key)
  attempts.set(key, value + 1)
  if (attempts.size > 2000) attempts.delete(attempts.keys().next().value as string)
  return value
}

// Positive classification valid only for this process generation (coordinated producer version 1).
const ordinary = new Set<string>()
const ordinaryKey = (ctx: GuardAttemptContext) => `${ENGINE_GENERATION}|${ctx.sdkSessionId}|${ctx.agentName}`
/** Test hook. */
export const resetGuardCaches = () => {
  attempts.clear()
  ordinary.clear()
}

function readInstructions(providerOptions: unknown): string | undefined {
  const value = (providerOptions as { openai?: { instructions?: unknown } } | undefined)?.openai?.instructions
  return typeof value === "string" ? value : undefined
}
function withInstructions(providerOptions: unknown, instructions: string | undefined) {
  if (instructions === undefined) return providerOptions
  const base = (providerOptions ?? {}) as { openai?: Record<string, unknown> }
  return { ...base, openai: { ...base.openai, instructions } }
}

export function providerGuardMiddleware(ctx: GuardAttemptContext): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    async transformParams({ params }) {
      const prompt = params.prompt as PromptMessage[]
      const stripped = stripMarkers(prompt)
      const instructions = readInstructions(params.providerOptions)
      const finish = (next: PromptMessage[], nextInstructions: string | undefined) =>
        ({
          ...params,
          prompt: next,
          providerOptions: withInstructions(params.providerOptions, nextInstructions) as typeof params.providerOptions,
        }) as typeof params
      const hold = (reason: GuardReason): never => {
        log.warn("provider attempt held", { sdkSessionId: ctx.sdkSessionId, purpose: ctx.purpose, reason })
        throw new RhythmProviderGuardHold(reason)
      }

      // A GitLab workflow model has no G2 durable marker and must remain held.
      // Conversely, a schema-2 record is a private G2 accounting marker, not
      // permission to use an ordinary/no-receiver fallback.
      const hasWorkflowMarker = ctx.record?.schemaVersion === 2
      if (ctx.isWorkflow && !hasWorkflowMarker) return hold("proof_unavailable")
      // No positive proof of the current runner = nothing to bind a pending frame to: hold, no API call.
      const generation = runnerGenerations.get(ctx.sdkSessionId)
      if (generation === undefined) return hold("proof_unavailable")
      const attempt = nextAttempt(ctx.sdkSessionId, ctx.userMessageId)
      if (attempt > GUARD_BOUNDS.maxAttempt) return hold("bounds_exceeded")

      const analysis = analyze(prompt, ctx.origins)
      const request = parseGuardRequest({
        schemaVersion: 1,
        sdkSessionId: ctx.sdkSessionId,
        userMessageId: ctx.userMessageId,
        requestNonce: newGuardNonce(),
        engineGeneration: ENGINE_GENERATION,
        runnerGeneration: generation,
        attempt,
        purpose: ctx.purpose,
        inputDigest: guardInputDigest({ prompt: stripped, instructions }, analysis.groups),
      })
      if (!request.ok) return hold("bounds_exceeded")

      // Auxiliary title/summary/compaction calls cannot create a fake zero
      // usage workflow receipt. The durable marker plus a real persisted
      // assistant identity are required before the frame becomes observable.
      const workflow = hasWorkflowMarker ? workflowFactsFor(ctx) : undefined
      if (hasWorkflowMarker && !workflow) return hold("proof_unavailable")

      const frame: GuardFrame = {
        request: request.value,
        agentName: ctx.agentName.slice(0, 200) || "unknown",
        userKind: ctx.userKind,
        initiatingUserMessageId: ctx.initiatingUserMessageId,
        inputGroupCount: ctx.origins ? analysis.groups.length : analysis.nonSystemCount,
        originCoverage: analysis.coverage,
        visibleMessageIds: analysis.visible,
        signal: ctx.signal,
        ...(workflow ? { workflow } : {}),
      }
      const release = installGuardFrame(frame)
      try {
        let workflowRequest: WorkflowProviderRequest | undefined
        let workflowDecision: WorkflowProviderDecision | undefined
        if (workflow) {
          const parsedWorkflow = parseWorkflowProviderRequest({
            schemaVersion: 2,
            kind: "coordinator_workflow_provider",
            binding: workflow.binding,
            scope: workflow.scope,
            request: request.value,
          })
          if (!parsedWorkflow.ok) return hold("bounds_exceeded")
          workflowRequest = parsedWorkflow.value
          workflowDecision = ctx.integration ? await postWorkflowAdmission(ctx.integration, workflowRequest, ctx.signal) : undefined
          if (!workflowDecision || workflowDecision.workflow.status !== "allow" ||
              workflowDecision.workflow.nativeLineageDigest !== workflow.nativeLineageDigest) return hold("proof_unavailable")
        }
        const decision = workflowDecision?.response ?? (ctx.integration ? await postAdmission(ctx.integration, request.value, ctx.signal) : undefined)
        // ---- synchronous from here to the return: no unrelated await before provider exposure ----
        if (ctx.signal.aborted || !guardFrameIsCurrent(frame)) return hold("proof_unavailable")
        if (workflowRequest) {
          if (!workflow || !workflowDecision || workflowDecision.workflow.status !== "allow" ||
              rhythmWorkflowLineageDigest(ctx.sdkSessionId as never) !== workflow.nativeLineageDigest ||
              workflowDecision.workflow.nativeLineageDigest !== workflow.nativeLineageDigest) {
            return hold("proof_unavailable")
          }
        }
        if (!decision) {
          // Known-ordinary, never-enrolled SDKs keep their behavior within this process generation.
          if (ordinary.has(ordinaryKey(ctx)) && ctx.record?.guarded === false) return finish(stripped, instructions)
          return hold("proof_unavailable")
        }
        if (guardInputDigest({ prompt: stripped, instructions }, analysis.groups) !== request.value.inputDigest) {
          return hold("history_ambiguous")
        }
        if (decision.decision === "hold") {
          ordinary.delete(ordinaryKey(ctx))
          return hold(decision.reason)
        }
        if (decision.decision === "ordinary") {
          // A workflow envelope may carry an ordinary inner decision when no
          // Dayflow material is selected. It reached here only through the
          // checked workflow decision, never the ordinary fallback/cache.
          if (!workflow && decision.guardRegistrationVersion === 1) ordinary.add(ordinaryKey(ctx))
          else ordinary.delete(ordinaryKey(ctx))
          return finish(stripped, instructions)
        }
        ordinary.delete(ordinaryKey(ctx))
        // History-only purposes (compaction, summary/title) never receive a fresh activity overlay;
        // a grant-shaped producer mistake holds instead of being silently accepted.
        if (decision.overlay && ctx.purpose !== "answer") return hold("proof_unavailable")
        let next = prompt
        let nextInstructions = instructions
        let certifiable = false
        if (decision.decision === "project") {
          if (!ctx.origins || !decision.projection) return hold("history_ambiguous")
          const projected = projectPrompt(
            prompt,
            ctx.origins,
            decision.projection,
            analysis.coverage,
            exemptCleanGroups(ctx, ctx.origins, decision),
          )
          // A projected ANSWER may certify its own generated group whether or not it carries a qualified
          // overlay: the overlay's source/reference/owner/receiver dependencies belong to the producer's
          // basisDigest, which the next fresh admission must still match exactly. Unknown/changed basis,
          // history-only purposes (they never accept an overlay) and unexposed/failed streams never certify.
          certifiable = ctx.purpose === "answer" && ctx.outputAssistantId !== undefined
          if (!projected) return hold("history_ambiguous")
          next = projected
          if (ctx.userSystem) {
            const cleaned = removeUserSystem(next, nextInstructions, ctx.userSystem)
            if (!cleaned) return hold("history_ambiguous")
            next = cleaned.prompt
            nextInstructions = cleaned.instructions
          }
        }
        next = stripMarkers(next)
        if (decision.overlay) {
          const inserted = insertOverlay(next, nextInstructions, decision.overlay.text)
          next = inserted.prompt
          nextInstructions = inserted.instructions
        }
        const out = finish(next, nextInstructions)
        // Only a safe, overlay-free projected exposure whose provider handoff actually happens can
        // certify its own output group (sealed in wrapStream after the real doStream).
        if ((certifiable && decision.projection) || workflow) {
          handoffs.set(out, {
            generation,
            request: request.value,
            basisDigest: decision.basisDigest,
            ...(decision.projection
              ? {
                  fromUserMessageId: decision.projection.fromUserMessageId,
                  sourceAnchorIds: decision.projection.sourceAnchorIds,
                }
              : {}),
            ...(workflow ? { workflow } : {}),
          })
        }
        return out
      } finally {
        release()
      }
    },
    async wrapStream({ doStream, params }) {
      const handoff = handoffs.get(params)
      handoffs.delete(params)
      // No await can occur between this current native lineage re-check and
      // the real provider invocation. A changed/deleted lineage is a hold.
      if (
        handoff?.workflow &&
        (ctx.signal.aborted ||
          runnerGenerations.get(ctx.sdkSessionId) !== handoff.generation ||
          rhythmWorkflowLineageDigest(ctx.sdkSessionId as never) !== handoff.workflow.nativeLineageDigest)
      ) {
        throw new RhythmProviderGuardHold("proof_unavailable")
      }
      const result = await doStream() // the actual provider exposure
      if (!handoff || !ctx.outputAssistantId) return result
      const assistantId = ctx.outputAssistantId
      const toolCallIds: string[] = []
      let failed = false
      const stream = result.stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (part.type === "tool-call") toolCallIds.push(part.toolCallId)
            if (part.type === "error") failed = true
            if (
              part.type === "finish" &&
              !failed &&
              !ctx.signal.aborted &&
              handoff.fromUserMessageId !== undefined &&
              handoff.sourceAnchorIds !== undefined &&
              runnerGenerations.get(ctx.sdkSessionId) === handoff.generation
            ) {
              registerCleanGroup(ctx.sdkSessionId, handoff.generation, {
                assistantId,
                toolCallIds: [...toolCallIds],
                agentName: ctx.agentName,
                basisDigest: handoff.basisDigest,
                fromUserMessageId: handoff.fromUserMessageId,
                sourceAnchorIds: handoff.sourceAnchorIds,
                generatingInputDigest: handoff.request.inputDigest,
              })
            }
            controller.enqueue(part)
          },
        }),
      )
      return { ...result, stream }
    },
  }
}
