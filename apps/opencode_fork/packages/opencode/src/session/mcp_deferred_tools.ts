/**
 * Rhythm carried patch (tokens-03, #843): deferred MCP tool schema loading.
 *
 * Prior art: this mirrors the skill-scope pattern already carried in this fork
 * (session/skill_allowlist.ts + tool/skill.ts, #775) — the model is offered a
 * cheap NAME + description catalog up front (here: for MCP tools instead of
 * skills) plus ONE dispatcher tool schema; the full per-tool JSON Schema is
 * resolved and the underlying tool executed only when the model actually
 * dispatches a call by name. Upstream sst/opencode has no native per-session
 * or lazy MCP schema loading (see docs/ai/decisions/2026-06-25-per-session-mcp-scoping-investigation.md,
 * Q3 — upstream issues #5373/#3756/#3612/#2888/#1101 are all open, unresolved,
 * and describe the same "schemas stay in context regardless of gating" gap).
 * No upstream lazy-loading implementation exists to mirror; this module is a
 * new-but-minimal pattern deliberately shaped like the existing skill-tool
 * dispatcher so it stays easy to reconcile with any future upstream fix.
 *
 * Pure helpers only — no Effect, no MCP client (only the SDK's JSON-schema validator) so they
 * are unit-testable in isolation, exactly like mcp_allowlist.ts and
 * skill_allowlist.ts.
 */
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js"

/** The single dispatcher tool's id. Chosen to sort near other builtins and to
 * read unambiguously in tool-call transcripts. */
export const MCP_DISPATCH_TOOL_ID = "mcp_dispatch"
/** The only model-facing MCP control tool that remains eagerly defined. */
export const MCP_DEFERRED_BOOTSTRAP_TOOL_IDS = [MCP_DISPATCH_TOOL_ID] as const
/** Keep the initial prompt catalog bounded even when a server exposes hundreds of tools. */
export const DEFERRED_MCP_BOOTSTRAP_MAX_BYTES = 6000
const DEFERRED_MCP_CATALOG_MAX_BYTES = 4800
const DEFERRED_MCP_SEARCH_LIMIT = 12
const DEFERRED_MCP_DESCRIPTION_MAX_CHARS = 180
export const GEMINI_FUNCTION_DECLARATION_CAP = 512

/** Whether eagerly adding this MCP surface would overflow Gemini's hard cap. */
export function shouldAutoDeferMcpTools(
  providerID: string,
  currentDeclarationCount: number,
  mcpToolCount: number,
): boolean {
  return providerID === "google" && currentDeclarationCount + mcpToolCount > GEMINI_FUNCTION_DECLARATION_CAP
}

/** Final request-build guard. This must run before the provider HTTP call. */
export function assertFunctionDeclarationCap(providerID: string, declarationCount: number): void {
  if (providerID !== "google" || declarationCount <= GEMINI_FUNCTION_DECLARATION_CAP) return
  throw new Error(
    `Gemini function-declaration cap: ${declarationCount} > ${GEMINI_FUNCTION_DECLARATION_CAP}`,
  )
}

/**
 * Namespace of a dispatchable tool. `mcp` keys are composed `<server>_<tool>`
 * names from the MCP inventory; `builtin` keys are hosted registry tool ids
 * (read, bash, task, ...). Resolution is always (family, name), so a builtin id
 * can never be satisfied by an MCP grant or the reverse. Omitted = `mcp`
 * (legacy call form).
 */
export type DeferredToolFamily = "mcp" | "builtin"
export const DEFERRED_BUILTIN_SERVER = "builtin"

export interface DeferredMcpToolEntry {
  /** The composed key the model must pass to mcp_dispatch (e.g. "rhythm_ping"). */
  name: string
  /** Raw MCP server/client name the tool belongs to. */
  server: string
  /** The tool's own description (short — this is the cheap part). */
  description: string
  /** Omitted = mcp. */
  family?: DeferredToolFamily
  /**
   * The tool's registered (raw) name from authoritative MCP metadata, when it differs from the
   * composed `name`. Discovery metadata only: execution always uses the canonical `name`.
   */
  rawName?: string
}

/** Authoritative origin of one composed MCP key: actual server + registered raw tool name. */
export interface DeferredMcpOrigin {
  key: string
  serverName: string
  toolName: string
}

export type DeferredMcpDispatchRequest =
  | { action: "search"; query?: string; family?: DeferredToolFamily }
  | { action: "describe"; name: string; family?: DeferredToolFamily }
  | { action: "execute"; name: string; arguments: Record<string, unknown>; family?: DeferredToolFamily }

export interface SerializedMcpToolSurface {
  /** Exact UTF-8 byte length of the serialized definitions. */
  eagerDefinitionBytes: number
  lazyBootstrapBytes: number
  /** HEURISTIC ONLY: ceil(UTF-8 bytes / 4). Not provider tokens, cache, or cost. */
  eagerBytesDiv4Estimate: number
  lazyBytesDiv4Estimate: number
}

function compactDescription(value: string): string {
  if (value.length <= DEFERRED_MCP_DESCRIPTION_MAX_CHARS) return value
  return value.slice(0, DEFERRED_MCP_DESCRIPTION_MAX_CHARS - 1) + "…"
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Build the names-only catalog of MCP tools available to a session, already
 * filtered by the session's mcpAllowlist (reusing the exact same allowlist
 * semantics as filterMcpToolsByAllowlist — see mcp_allowlist.ts — so
 * deferred-mode catalogs and eager-mode schema injection can never diverge on
 * which tools are in scope).
 *
 * @param toolKeys        All composed keys returned by mcp.tools().
 * @param keyToServer     composedKey -> raw clientName (see mcp_allowlist.ts).
 * @param descriptions    composedKey -> tool description (from MCP tool defs).
 * @param allowedKeys     The already-allowlist-filtered set of keys to include
 *                        (callers pass the output of filterMcpToolsByAllowlist
 *                        so the allowlist gate is applied exactly once, in one
 *                        place, for both eager and deferred modes).
 */
export function buildDeferredToolCatalog(
  allowedKeys: Iterable<string>,
  keyToServer: Record<string, string>,
  descriptions: Record<string, string>,
  rawNames: Record<string, string> = {},
): DeferredMcpToolEntry[] {
  const entries: DeferredMcpToolEntry[] = []
  for (const key of allowedKeys) {
    entries.push({
      name: key,
      server: keyToServer[key] ?? "unknown",
      description: descriptions[key] ?? "",
      ...(rawNames[key] !== undefined && rawNames[key] !== key ? { rawName: rawNames[key] } : {}),
    })
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Registered raw tool name per eligible key, only where the origin is unambiguous: a key that two
 * different (server, tool) origins would both compose to carries no raw name (collision holds).
 */
export function uniqueRawNames(eligibleKeys: Iterable<string>, origins: readonly DeferredMcpOrigin[]): Record<string, string> {
  const eligible = new Set(eligibleKeys)
  const seen = new Map<string, Set<string>>()
  for (const origin of origins) {
    if (!eligible.has(origin.key)) continue
    const set = seen.get(origin.key) ?? new Set<string>()
    set.add(`${origin.serverName}\u0000${origin.toolName}`)
    seen.set(origin.key, set)
  }
  const result: Record<string, string> = {}
  for (const origin of origins) {
    if (seen.get(origin.key)?.size === 1) result[origin.key] = origin.toolName
  }
  return result
}

export type DeferredDescribeResolution =
  | { ok: true; key: string }
  | { ok: false; reason: "unknown" | "ambiguous"; candidates: string[] }

/**
 * Resolve the name given to `describe` against the fresh, permitted, eligible inventory only.
 * 1. An exact canonical key always wins.
 * 2. Otherwise an exact registered raw tool name resolves iff it selects exactly one eligible key
 *    whose origin is itself unambiguous. Unknown or multiple candidates hold; there is no
 *    substring, fuzzy, suffix-splitting, server-preference or inventory-order guess. Denied or
 *    absent keys are never candidates, so they can neither resolve nor be named in an error.
 * Execute never uses this: it stays canonical-only.
 */
export function resolveDeferredMcpDescribeName(
  name: string,
  eligibleKeys: Iterable<string>,
  origins: readonly DeferredMcpOrigin[],
): DeferredDescribeResolution {
  const eligible = new Set(eligibleKeys)
  if (eligible.has(name)) return { ok: true, key: name }
  const raw = uniqueRawNames(eligible, origins)
  const candidates = [...new Set(Object.entries(raw).filter(([, toolName]) => toolName === name).map(([key]) => key))].toSorted()
  // A colliding key (two origins) has no raw name entry; an exact-raw match on it must hold, not vanish.
  const collided = origins.some((origin) => eligible.has(origin.key) && origin.toolName === name && raw[origin.key] === undefined)
  if (collided) return { ok: false, reason: "ambiguous", candidates }
  if (candidates.length === 1) return { ok: true, key: candidates[0]! }
  return { ok: false, reason: candidates.length === 0 ? "unknown" : "ambiguous", candidates }
}

/**
 * Render the names-only catalog as the system-prompt block the model reads
 * to learn which MCP tools exist, mirroring Skill.fmt's <available_skills>
 * shape (session/system.ts / skill/index.ts fmt()).
 */
export function formatDeferredToolCatalog(allEntries: DeferredMcpToolEntry[]): string {
  if (allEntries.length === 0) return "No MCP tools are currently available."
  // Hosted builtins are listed by name only (one compact line); descriptions and
  // schemas come from search/describe with family="builtin".
  const builtinNames = allEntries.filter((entry) => entry.family === "builtin").map((entry) => entry.name)
  const entries = allEntries.filter((entry) => entry.family !== "builtin")
  const opening = [
    "<available_mcp_tools>",
    "Use mcp_dispatch action=search to discover omitted tools, action=describe to read a selected tool's full schema, and action=execute to call it. MCP tools use family=mcp (default); hosted builtin tools use family=builtin.",
    ...(builtinNames.length > 0 ? [`  <builtin_tools family="builtin">${builtinNames.join(", ")}</builtin_tools>`] : []),
    ...(entries.length === 0 ? ["No MCP tools are currently available."] : []),
  ]
  const closing = "</available_mcp_tools>"
  const listed: string[] = []
  for (const [index, entry] of entries.entries()) {
    const item = [
      "  <mcp_tool>",
      `    <name>${entry.name}</name>`,
      `    <server>${entry.server}</server>`,
      `    <description>${compactDescription(entry.description)}</description>`,
      "  </mcp_tool>",
    ]
    const omitted = entries.length - index - 1
    const footer = omitted > 0 ? `  <more>${omitted} additional tools are searchable on demand.</more>` : undefined
    if (utf8Bytes([...opening, ...listed, ...item, ...(footer ? [footer] : []), closing].join("\n")) > DEFERRED_MCP_CATALOG_MAX_BYTES) {
      break
    }
    listed.push(...item)
  }
  const omitted = entries.length - listed.filter((line) => line === "  <mcp_tool>").length
  const footer = omitted > 0 ? [`  <more>${omitted} additional tools are searchable on demand.</more>`] : []
  return [...opening, ...listed, ...footer, closing].join("\n")
}

/**
 * Search the currently authorized catalog without putting every description
 * into the initial provider request. Search results remain compact too; use
 * `describe` for the selected tool's complete schema.
 */
export function searchDeferredToolCatalog(
  entries: DeferredMcpToolEntry[],
  query?: string,
  limit = DEFERRED_MCP_SEARCH_LIMIT,
  family?: DeferredToolFamily,
): DeferredMcpToolEntry[] {
  if (query !== undefined && utf8Bytes(query) > DEFERRED_MCP_QUERY_MAX_BYTES) {
    throw new Error(`mcp_dispatch search query is too long (limit ${DEFERRED_MCP_QUERY_MAX_BYTES} bytes).`)
  }
  const queryWords = [...new Set(searchWords(query ?? ""))]
  if (queryWords.length > DEFERRED_MCP_QUERY_MAX_WORDS) {
    throw new Error(`mcp_dispatch search query has too many words (limit ${DEFERRED_MCP_QUERY_MAX_WORDS}).`)
  }
  const phrase = queryWords.length > 0 ? searchWords(query ?? "").join(" ") : ""
  // Match against the COMPLETE eligible catalog (full names, registered names, servers and full
  // descriptions) before any result/description truncation. Every query word must appear
  // somewhere, in any order; words match as partial text so useful partial names still work.
  const ranked = entries
    .filter((entry) => !family || (entry.family ?? "mcp") === family)
    .flatMap((entry) => {
      if (queryWords.length === 0) return [{ entry, rank: 2 }]
      const names = [entry.name, entry.rawName].filter((value): value is string => value !== undefined)
      const fields = [...names, entry.server, entry.description].map(searchWords)
      const text = fields.map((words) => words.join(" ")).join(" ")
      if (!queryWords.every((word) => text.includes(word))) return []
      if (names.some((name) => searchWords(name).join(" ") === phrase)) return [{ entry, rank: 0 }]
      const tokens = new Set(fields.flat())
      return [{ entry, rank: queryWords.every((word) => tokens.has(word)) ? 1 : 2 }]
    })
    .toSorted((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name))
  return ranked
    .slice(0, Math.max(1, Math.min(limit, DEFERRED_MCP_SEARCH_LIMIT)))
    .map(({ entry }) => ({ ...entry, description: compactDescription(entry.description) }))
}

export const DEFERRED_MCP_QUERY_MAX_BYTES = 512
export const DEFERRED_MCP_QUERY_MAX_WORDS = 32

/** Lowercase words with whitespace, punctuation and `_`/`-` separators removed. */
function searchWords(text: string): string[] {
  return text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0)
}

/** Validate the stable dispatcher protocol before resolving a raw MCP tool. */
export function parseDeferredMcpDispatchRequest(raw: unknown): DeferredMcpDispatchRequest {
  if (!jsonObject(raw)) throw new Error("mcp_dispatch requires a JSON object.")
  const action = raw.action ?? "execute"
  if (action !== "search" && action !== "describe" && action !== "execute") {
    throw new Error("mcp_dispatch action must be search, describe, or execute.")
  }
  if (raw.family !== undefined && raw.family !== "mcp" && raw.family !== "builtin") {
    throw new Error("mcp_dispatch family must be mcp or builtin.")
  }
  const family = raw.family === undefined ? {} : { family: raw.family as DeferredToolFamily }
  if (action === "search") {
    if (raw.query !== undefined && typeof raw.query !== "string") {
      throw new Error("mcp_dispatch search query must be a string.")
    }
    return raw.query === undefined ? { action, ...family } : { action, query: raw.query, ...family }
  }
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    throw new Error("mcp_dispatch requires a `name` naming one of the tools in the catalog.")
  }
  if (action === "describe") return { action, name: raw.name, ...family }
  const args = raw.arguments ?? {}
  if (!jsonObject(args)) throw new Error("mcp_dispatch arguments must be a JSON object.")
  return { action, name: raw.name, arguments: args, ...family }
}

/**
 * Body-free request-size accounting for actual serialized definitions. The
 * `*Bytes` counters are exact UTF-8 byte lengths; the `*BytesDiv4Estimate`
 * counters are a bytes/4 heuristic (over-counts non-ASCII text relative to
 * characters). Neither is a provider token, cache, or cost measurement.
 */
export function measureSerializedMcpToolSurface(input: {
  eagerDefinitions: unknown
  lazyBootstrap: unknown
}): SerializedMcpToolSurface {
  const eagerDefinitionBytes = utf8Bytes(JSON.stringify(input.eagerDefinitions) ?? "")
  const lazyBootstrapBytes = utf8Bytes(JSON.stringify(input.lazyBootstrap) ?? "")
  return {
    eagerDefinitionBytes,
    lazyBootstrapBytes,
    eagerBytesDiv4Estimate: Math.ceil(eagerDefinitionBytes / 4),
    lazyBytesDiv4Estimate: Math.ceil(lazyBootstrapBytes / 4),
  }
}

/**
 * The SDK validator is Ajv with draft-07 semantics and `strict: false`, so it
 * silently IGNORES keywords it does not know. These 2019-09/2020-12-only
 * keywords would therefore be accepted-but-unenforced; a schema using any of
 * them is refused (fail closed) rather than validated incompletely.
 */
const UNENFORCEABLE_KEYWORDS = new Set([
  "prefixItems",
  "unevaluatedProperties",
  "unevaluatedItems",
  "dependentSchemas",
  "dependentRequired",
  "minContains",
  "maxContains",
  "contentSchema",
  "$dynamicRef",
  "$dynamicAnchor",
  "$recursiveRef",
  "$recursiveAnchor",
  "$anchor",
  "$vocabulary",
])
// Keywords whose object value maps arbitrary NAMES to subschemas (names are not keywords).
const NAME_MAP_KEYWORDS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependencies"])
// Keywords that carry data, not subschemas.
const DATA_KEYWORDS = new Set(["enum", "const", "default", "examples"])

function findUnenforceableKeyword(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findUnenforceableKeyword(item)
      if (found) return found
    }
    return undefined
  }
  if (!jsonObject(node)) return undefined
  for (const [key, value] of Object.entries(node)) {
    if (UNENFORCEABLE_KEYWORDS.has(key)) return key
    if (DATA_KEYWORDS.has(key)) continue
    if (NAME_MAP_KEYWORDS.has(key) && jsonObject(value)) {
      for (const sub of Object.values(value)) {
        const found = findUnenforceableKeyword(sub)
        if (found) return found
      }
      continue
    }
    const found = findUnenforceableKeyword(value)
    if (found) return found
  }
  return undefined
}

/**
 * Enforce the selected tool's advertised JSON Schema on `execute` arguments.
 * JSON-schema-only MCP definitions (`jsonSchema(schema)` with no validate hook)
 * otherwise accept anything. Returns an error message, or undefined when valid.
 *
 * Validation is the SDK's Ajv (draft-07 semantics, strict:false); it is NOT a
 * claim of full 2019-09/2020-12 semantics. Only the specific keywords listed in
 * UNENFORCEABLE_KEYWORDS are refused; coverage of arbitrary declared-modern
 * schemas beyond tested cases is unproved. Refused before any tool
 * effect: a missing/non-object schema, 2019-09/2020-12-only keywords the
 * validator cannot enforce, and schemas Ajv cannot compile. A fresh validator is
 * built per call so a reused `$id` can never resolve to a different tool's or an
 * earlier version of the schema.
 */
export function validateDeferredMcpArguments(schema: unknown, args: Record<string, unknown>): string | undefined {
  if (!jsonObject(schema)) return "the tool has no usable input schema"
  const unsupported = findUnenforceableKeyword(schema)
  if (unsupported) return `the tool input schema uses unsupported keyword "${unsupported}"`
  try {
    const result = new AjvJsonSchemaValidator().getValidator(schema as JsonSchemaType)(args)
    return result.valid ? undefined : result.errorMessage
  } catch (error) {
    return `the tool input schema could not be compiled (${error instanceof Error ? error.message : String(error)})`
  }
}

/**
 * Execute-time guard for the mcp_dispatch tool: is `name` still permitted
 * under the session's mcpAllowlist? Mirrors tool/skill.ts's isSkillAllowed
 * execute-time guard (#775) — the catalog already excludes out-of-scope
 * tools, but a model could still try to dispatch an out-of-scope name it
 * hallucinates or remembers from an earlier turn, so this must be re-checked
 * at call time, not just at listing time.
 *
 * Delegates to the exact same allowlist semantics as filterMcpToolsByAllowlist
 * (undefined allowlist = unrestricted; explicit tool key OR server-level
 * match) so the dispatch-time gate can never be more permissive than the
 * listing-time gate.
 */
export function isDeferredMcpToolAllowed(
  name: string,
  keyToServer: Record<string, string>,
  mcpAllowlist: { servers: string[]; tools: string[] } | undefined,
): boolean {
  if (mcpAllowlist === undefined) return true
  if (mcpAllowlist.tools.includes(name)) return true
  const server = keyToServer[name]
  if (server !== undefined && mcpAllowlist.servers.includes(server)) return true
  return false
}

/** Whether an allowlisted key belongs in the dispatcher rather than eager schemas. */
export function isMcpToolDeferred(
  name: string,
  keyToServer: Record<string, string>,
  mcpAllowlist:
    | { deferred?: boolean; deferredServers?: string[] }
    | undefined,
): boolean {
  // Lazy MCP loading is the default for both legacy (undefined allowlist) and
  // new profile sessions. A historical explicit `deferredServers` list keeps
  // its selective eager compatibility until that session is updated.
  if (mcpAllowlist?.deferred === true) return true
  const deferredServers = mcpAllowlist?.deferredServers
  if (deferredServers && deferredServers.length > 0) {
    const server = keyToServer[name]
    return server !== undefined && deferredServers.includes(server)
  }
  if (mcpAllowlist?.deferred !== false) return true
  return false
}
