/**
 * Native half of the Dayflow provider guard, driven through the existing synthetic
 * TestInstance / TestLLMServer harness (real SessionPrompt, LLM, MessageV2, compaction).
 *
 * The "Rhythm API" here is an in-process synthetic function installed on the guard's
 * transport seam: it does what the real adapter must (read the pending frame through the
 * same export builder the route uses, then answer with a strict C0 response). It is NOT a
 * cross-process or real-API proof; actual API decisions remain pending integration.
 */
import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { jsonSchema, streamText, tool, wrapLanguageModel } from "ai"
import { APICallError } from "@ai-sdk/provider"
import { Effect, Layer } from "effect"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Storage } from "@/storage/storage"
import * as Log from "@opencode-ai/core/util/log"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"
import { Format } from "../../src/format"
import { Reference } from "../../src/reference/reference"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EffectBridge } from "@/effect/bridge"
import {
  buildGuardExport,
  enrollGuard,
  guardInputDigest,
  parseGuardExport,
  parseGuardRequest,
  readGuardRecord,
  resolveSourceProofs,
  runnerGenerations,
  sha256Hex,
  type GuardRequest,
  type GuardResponse,
} from "../../src/session/rhythm_provider_guard"
import {
  buildProviderOrigins,
  cleanGroupFor,
  clearRunnerCertificates,
  completedGroupDigest,
  sealCleanGroup,
  exemptCleanGroups,
  registerCleanGroup,
  GUARD_MARKER,
  guardTransport,
  markModelMessages,
  projectPrompt,
  providerGuardMiddleware,
  removeUserSystem,
  resetGuardCaches,
  stripMarkers,
  trustedRhythmIntegration,
  type GuardAttemptContext,
  type PromptMessage,
  type ProviderOrigins,
} from "../../src/session/rhythm_provider_projection"

void Log.init({ print: false })

const AUTO = "SYNTHETIC_AUTO_DAYFLOW_EVIDENCE_4719"
const STATIC = "SYNTHETIC_STATIC_SECRETARY_6832"
const TOKEN = "synthetic-rhythm-token-91827"
const AGENT_URL = "http://127.0.0.1:4001"

let sourceCurrent = true
let freshToolCalls = 0
let afterOrdinaryLookup: (() => Promise<void>) | undefined
const syntheticTools = () => ({
  sol_clean_lookup: tool({
    description: "Synthetic ordinary lookup after a clean guarded request",
    inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
    execute: async () => {
      freshToolCalls += 1
      await afterOrdinaryLookup?.()
      return { content: [{ type: "text", text: "SYNTHETIC_FRESH_TOOL_RESULT_8271" }] }
    },
  }),
  sol_invalidate_source: tool({
    description: "Synthetic test source invalidation",
    inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
    execute: async () => {
      sourceCurrent = false
      return { content: [{ type: "text", text: "Synthetic source is now invalid." }] }
    },
  }),
})
const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed(syntheticTools()),
    appTools: () => Effect.succeed({}),
    toolClientNames: () => Effect.succeed({ sol_invalidate_source: "sol_synthetic", sol_clean_lookup: "sol_synthetic" }),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)
const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)
const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)
const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }
const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makePromptLayer() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
    SyncEvent.defaultLayer,
    Storage.defaultLayer,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Reference.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(proc),
    Layer.provideMerge(deps),
  )
  return SessionPrompt.layer.pipe(
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(Reference.defaultLayer),
    Layer.provide(summary),
    Layer.provideMerge(run),
    Layer.provideMerge(compact),
    Layer.provideMerge(proc),
    Layer.provideMerge(registry),
    Layer.provideMerge(trunc),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true, shellKillGraceMs: 0 } as Parameters<typeof RuntimeFlags.layer>[0])),
    Layer.provideMerge(deps),
  )
}

const it = testEffect(Layer.mergeAll(TestLLMServer.layer, makePromptLayer()).pipe(Layer.provide(summary)))

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
    },
  },
}
const rhythmMcp = {
  rhythm: {
    type: "local" as const,
    command: ["synthetic-rhythm-mcp"],
    environment: { RHYTHM_AGENT_URL: AGENT_URL, RHYTHM_API_TOKEN: TOKEN },
  },
}
const withProvider = (url: string) => ({
  ...cfg,
  provider: { ...cfg.provider, test: { ...cfg.provider.test, options: { ...cfg.provider.test.options, baseURL: url } } },
  agent: { build: { prompt: STATIC } },
})
const managedCfg = (url: string) => ({ ...withProvider(url), mcp: rhythmMcp })

const useServerConfig = Effect.fn("test.useServerConfig")(function* (config: (url: string) => Record<string, unknown>) {
  const { directory } = yield* TestInstance
  const llm = yield* TestLLMServer
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(
    `${directory}/opencode.json`,
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config(llm.url) }),
  )
  return { llm }
})

// ---------------------------------------------------------------------------
// Synthetic Rhythm API on the guard's transport seam
// ---------------------------------------------------------------------------
type Call = {
  request: GuardRequest
  authorization: string | null
  url: string
  exported: unknown
  storedIds: { id: string; role: string }[]
}
const calls: Call[] = []
type Decide = (call: Call) => unknown | Promise<unknown>
const realFetch = guardTransport.fetch

const respond = (request: GuardRequest, over: Record<string, unknown> = {}) => {
  const overlay = over.overlay as { text: string } | null | undefined
  return {
    schemaVersion: 1,
    request,
    decision: "allow",
    rawHistoryReusable: true,
    guardRegistrationVersion: 1,
    basisDigest: "b".repeat(64),
    overlay: overlay ? { text: overlay.text, sha256: sha256Hex(overlay.text) } : null,
    projection: null,
    reason: "none",
    ...over,
    ...(overlay === undefined ? {} : { overlay: overlay ? { text: overlay.text, sha256: sha256Hex(overlay.text) } : null }),
  }
}
const projectFrom = (request: GuardRequest, from: string, anchors = [from], over: Record<string, unknown> = {}) =>
  respond(request, {
    decision: "project",
    rawHistoryReusable: false,
    projection: { fromUserMessageId: from, sourceAnchorIds: anchors },
    reason: "source_changed",
    ...over,
  })

const installApi = Effect.fn("test.installApi")(function* (decide: Decide) {
  const sessions = yield* Session.Service
  const bridge = yield* EffectBridge.make()
  calls.length = 0
  guardTransport.fetch = async (url, init) => {
    const request = JSON.parse(String(init.body)) as GuardRequest
    const stored = await bridge.promise(sessions.messages({ sessionID: request.sdkSessionId as never }))
    const storedIds = stored.map((m) => ({ id: m.info.id as string, role: m.info.role }))
    // What the real API does first: read the pending frame back through the owned export.
    const exported = buildGuardExport(
      request.sdkSessionId,
      request.requestNonce,
      storedIds.map((m) => m.id).slice(0, 64),
      (frame, anchors) => resolveSourceProofs(stored, frame, anchors),
    )
    const call: Call = {
      request,
      url,
      authorization: new Headers(init.headers as HeadersInit).get("authorization"),
      exported,
      storedIds,
    }
    calls.push(call)
    const decided = await decide(call)
    if (decided instanceof Response) return decided
    return new Response(JSON.stringify(decided), { status: 200, headers: { "content-type": "application/json" } })
  }
})

afterEach(() => {
  afterOrdinaryLookup = undefined
  guardTransport.fetch = realFetch
  resetGuardCaches()
})

const providerMessages = (input: Record<string, unknown>) =>
  input.messages as Array<{ role: string; content: unknown; tool_calls?: unknown }>
const roleHas = (input: Record<string, unknown>, role: string, marker: string) =>
  providerMessages(input).some((message) => message.role === role && JSON.stringify(message.content).includes(marker))
const anyHas = (input: Record<string, unknown>, marker: string) => JSON.stringify(providerMessages(input)).includes(marker)
const firstUserId = (call: Call) => call.storedIds.find((m) => m.role === "user")!.id
const lastUserId = (call: Call) => call.storedIds.findLast((m) => m.role === "user")!.id

// ---------------------------------------------------------------------------
// Overlay-bearing continuation support. The "API" here is a STUB: it emits a valid opaque producer
// basis computed from labelled dependency material (receiver, V1 witness, source reference version,
// overlay source). That models a basis that CHANGES with real dependency changes; it is NOT evidence
// that the real C2 basis is stable, and nothing here is cross-process proof.
// ---------------------------------------------------------------------------
const OVERLAY = "[Dayflow qualified context]\nSYNTHETIC_QUALIFIED_ACTIVITY_5530\n[/Dayflow qualified context]"
const producerBasis = (dependency: { receiver?: string; witness?: string; reference?: string; overlaySource?: string } = {}) =>
  sha256Hex(
    [
      `receiver:${dependency.receiver ?? "owner-root-1"}`,
      `witness:${dependency.witness ?? "v1-body-1"}`,
      `reference:${dependency.reference ?? "reference-v1"}`,
      `overlay-source:${dependency.overlaySource ?? "source-1"}`,
    ].join("|"),
  )

/**
 * allow (quote) -> real compaction -> answer #1 (projected + qualified overlay; the model calls an ordinary
 * lookup) -> answer #2 (the continuation). `answerDecision(n, first)` supplies the producer response fields
 * for the n-th projected answer (1 = generating request, 2 = continuation).
 */
const overlayFlow = Effect.fn("test.overlayFlow")(function* (
  title: string,
  answerDecision: (answer: number, firstUser: string) => { basis: string; anchors?: string[] },
) {
  freshToolCalls = 0
  const { llm } = yield* useServerConfig(managedCfg)
  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  const compact = yield* SessionCompaction.Service
  const session = yield* sessions.create({ title, permission: [{ permission: "*", pattern: "*", action: "allow" }] })
  const before = (yield* llm.inputs).length // the loopback server accumulates across flows within one test
  let answer = 0
  yield* installApi((call) => {
    if (calls.length === 1) return respond(call.request)
    const first = firstUserId(call)
    if (call.request.purpose === "compaction") return projectFrom(call.request, first)
    const decision = answerDecision(++answer, first)
    return projectFrom(call.request, first, decision.anchors ?? [first], {
      basisDigest: decision.basis,
      overlay: { text: OVERLAY },
    })
  })
  yield* llm.text(`Assistant quoted source: ${AUTO}`)
  yield* prompt.prompt({ sessionID: session.id, agent: "build", system: `Automatic source data: ${AUTO}`, parts: [{ type: "text", text: "First authored turn" }] })
  yield* compact.create({ sessionID: session.id, agent: "build", model: ref, auto: false })
  yield* llm.text(`Old derived summary: ${AUTO}`)
  yield* prompt.loop({ sessionID: session.id })
  yield* llm.tool("mcp_dispatch", { name: "sol_clean_lookup", arguments: {} })
  yield* llm.text("Useful continuation using the ordinary lookup")
  yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "Use an ordinary lookup now" }] })
  return { inputs: (yield* llm.inputs).slice(before), sessions, session }
})

// ---------------------------------------------------------------------------
// Actual native provider requests
// ---------------------------------------------------------------------------
describe("managed SDK: every actual provider attempt is guarded", () => {
  it.instance(
    "Sol payload: a completed canonical tool group edited after its first clean admission loses its exemption",
    () =>
      Effect.gen(function* () {
        freshToolCalls = 0
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const compact = yield* SessionCompaction.Service
        const bridge = yield* EffectBridge.make()
        const session = yield* sessions.create({ title: "Synthetic completed group edit", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        const admittedBases: string[] = []
        yield* installApi((call) => {
          const response = calls.length === 1 ? respond(call.request) : projectFrom(call.request, firstUserId(call))
          admittedBases.push(response.basisDigest as string)
          return response
        })
        let edited = false
        afterOrdinaryLookup = () => bridge.promise(Effect.gen(function* () {
          if (freshToolCalls !== 2) return
          const stored = yield* sessions.messages({ sessionID: session.id })
          const part = stored.flatMap((message) => message.parts).find((part) => part.type === "tool" && part.state.status === "completed" && JSON.stringify(part.state.output).includes("SYNTHETIC_FRESH_TOOL_RESULT_8271"))
          expect(part?.type).toBe("tool")
          if (!part || part.type !== "tool" || part.state.status !== "completed") throw new Error("completed ordinary part missing")
          expect(cleanGroupFor(session.id, part.messageID)).toBeDefined()
          // Same supported Session.updatePart operation used by the owned-engine part.update handler.
          // This is a normal canonical part update, not a SQL/file mutation or new Dayflow exposure.
          yield* sessions.updatePart({ ...part, state: { ...part.state, output: "SYNTHETIC_CHANGED_ORDINARY_PAYLOAD_9102" } })
          edited = true
        }))
        yield* llm.text(`Assistant quoted source: ${AUTO}`)
        yield* prompt.prompt({ sessionID: session.id, agent: "build", system: `Automatic source data: ${AUTO}`, parts: [{ type: "text", text: "First authored turn" }] })
        yield* compact.create({ sessionID: session.id, agent: "build", model: ref, auto: false })
        yield* llm.text(`Old derived summary: ${AUTO}`)
        yield* prompt.loop({ sessionID: session.id })
        yield* llm.tool("mcp_dispatch", { name: "sol_clean_lookup", arguments: {} })
        yield* llm.tool("mcp_dispatch", { name: "sol_clean_lookup", arguments: {} })
        yield* llm.text("Final ordinary continuation")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "Use two ordinary lookups" }] })
        const inputs = yield* llm.inputs
        expect(inputs).toHaveLength(5)
        expect(anyHas(inputs[3], "SYNTHETIC_FRESH_TOOL_RESULT_8271")).toBe(true) // first completed group was cleanly admitted
        expect(freshToolCalls).toBe(2)
        expect(edited).toBe(true)
        expect(admittedBases).toHaveLength(5)
        expect(new Set(admittedBases).size).toBe(1)
        for (const input of inputs.slice(1)) expect(anyHas(input, AUTO)).toBe(false)
        expect(roleHas(inputs[4], "system", STATIC)).toBe(true)
        expect(roleHas(inputs[4], "user", "Use two ordinary lookups")).toBe(true)
        const stored = yield* sessions.messages({ sessionID: session.id })
        expect(JSON.stringify(stored)).toContain("SYNTHETIC_CHANGED_ORDINARY_PAYLOAD_9102")
        expect(anyHas(inputs[4], "SYNTHETIC_CHANGED_ORDINARY_PAYLOAD_9102"), "changed completed payload with unchanged assistant/call ids must not inherit its earlier clean certificate").toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "Sol: a new ordinary tool result from a clean projected request reaches useful continuation",
    () =>
      Effect.gen(function* () {
        freshToolCalls = 0
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const compact = yield* SessionCompaction.Service
        const session = yield* sessions.create({ title: "Synthetic clean continuation", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        yield* installApi((call) => calls.length === 1 ? respond(call.request) : projectFrom(call.request, firstUserId(call)))
        yield* llm.text(`Assistant quoted source: ${AUTO}`)
        yield* prompt.prompt({ sessionID: session.id, agent: "build", system: `Automatic source data: ${AUTO}`, parts: [{ type: "text", text: "First authored turn" }] })
        yield* compact.create({ sessionID: session.id, agent: "build", model: ref, auto: false })
        yield* llm.text(`Old derived summary: ${AUTO}`)
        yield* prompt.loop({ sessionID: session.id })
        yield* llm.tool("mcp_dispatch", { name: "sol_clean_lookup", arguments: {} })
        yield* llm.text("Useful continuation using the ordinary lookup")
        const result = yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "Use an ordinary lookup now" }] })
        const inputs = yield* llm.inputs
        expect(inputs).toHaveLength(4)
        expect(calls.map((call) => call.request.purpose)).toEqual(["answer", "compaction", "answer", "answer"])
        for (const input of inputs.slice(1)) expect(anyHas(input, AUTO)).toBe(false)
        expect(freshToolCalls).toBe(1)
        const stored = yield* sessions.messages({ sessionID: session.id })
        expect(JSON.stringify(stored)).toContain(AUTO) // canonical old transcript remains untouched
        expect(stored.flatMap((m) => m.parts).some((part) => part.type === "tool" && part.state.status === "completed" && JSON.stringify(part.state.output).includes("SYNTHETIC_FRESH_TOOL_RESULT_8271"))).toBe(true)
        expect(roleHas(inputs[3], "system", STATIC)).toBe(true)
        expect(roleHas(inputs[3], "user", "Use an ordinary lookup now")).toBe(true)
        expect(result.parts.some((part) => part.type === "text" && part.text.includes("Useful continuation"))).toBe(true)
        expect(anyHas(inputs[3], "SYNTHETIC_FRESH_TOOL_RESULT_8271"), "a clean new tool result must survive the next guarded request while old quotes/summaries remain absent").toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "overlay continuation: a current projected+qualified-overlay request's ordinary tool result survives the next same-basis request; old groups stay gone",
    () =>
      Effect.gen(function* () {
        const basis = producerBasis()
        const { inputs, sessions, session } = yield* overlayFlow("Overlay continuation", () => ({ basis }))
        expect(inputs).toHaveLength(4)
        expect(calls.map((call) => call.request.purpose)).toEqual(["answer", "compaction", "answer", "answer"])
        expect(freshToolCalls).toBe(1) // the ordinary tool ran exactly once
        // the qualified overlay is injected for BOTH projected answers (never for compaction)
        expect(roleHas(inputs[2], "system", "SYNTHETIC_QUALIFIED_ACTIVITY_5530")).toBe(true)
        expect(roleHas(inputs[3], "system", "SYNTHETIC_QUALIFIED_ACTIVITY_5530")).toBe(true)
        expect(anyHas(inputs[1], "SYNTHETIC_QUALIFIED_ACTIVITY_5530")).toBe(false)
        // old invalid quote/summary/overlay stay gone while the whole new call/result group is retained
        for (const input of inputs.slice(1)) expect(anyHas(input, AUTO)).toBe(false)
        expect(roleHas(inputs[3], "system", STATIC)).toBe(true)
        expect(roleHas(inputs[3], "user", "Use an ordinary lookup now")).toBe(true)
        expect(anyHas(inputs[3], "SYNTHETIC_FRESH_TOOL_RESULT_8271"), "new call/result must survive under the unchanged opaque basis").toBe(true)
        const stored = yield* sessions.messages({ sessionID: session.id })
        expect(JSON.stringify(stored)).toContain(AUTO)
        expect(JSON.stringify(inputs)).not.toContain(TOKEN)
      }),
    { git: true },
    30_000,
  )

  it.instance(
    "overlay continuation negatives: a changed dependency basis or anchor set never inherits the exemption",
    () =>
      Effect.gen(function* () {
        const base = producerBasis()
        const scenarios: Array<[string, (answer: number, first: string) => { basis: string; anchors?: string[] }]> = [
          ["V1 body append (new witness)", (n) => ({ basis: n === 1 ? base : producerBasis({ witness: "v1-body-2" }) })],
          ["source renewal (reference version)", (n) => ({ basis: n === 1 ? base : producerBasis({ reference: "reference-v2" }) })],
          ["overlay source/owner change", (n) => ({ basis: n === 1 ? base : producerBasis({ overlaySource: "source-2" }) })],
          ["receiver change", (n) => ({ basis: n === 1 ? base : producerBasis({ receiver: "owner-root-2" }) })],
          ["different projection anchors", (n, first) => ({ basis: base, anchors: n === 2 ? [first, "msg_other_anchor"] : [first] })],
        ]
        for (const [name, decision] of scenarios) {
          const { inputs } = yield* overlayFlow(`Overlay negative ${name}`, decision)
          expect(inputs, name).toHaveLength(4)
          expect(freshToolCalls, name).toBe(1)
          expect(roleHas(inputs[3], "system", "SYNTHETIC_QUALIFIED_ACTIVITY_5530"), name).toBe(true)
          for (const input of inputs.slice(1)) expect(anyHas(input, AUTO), name).toBe(false)
          expect(anyHas(inputs[3], "SYNTHETIC_FRESH_TOOL_RESULT_8271"), `${name}: exemption must not survive`).toBe(false)
        }
      }),
    { git: true },
    90_000,
  )

  it.instance(
    "overlay continuation: a completed overlay-era tool group edited after sealing loses its exemption",
    () =>
      Effect.gen(function* () {
        freshToolCalls = 0
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const compact = yield* SessionCompaction.Service
        const bridge = yield* EffectBridge.make()
        const session = yield* sessions.create({ title: "Overlay edited group", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        const basis = producerBasis()
        yield* installApi((call) =>
          calls.length === 1
            ? respond(call.request)
            : call.request.purpose === "compaction"
              ? projectFrom(call.request, firstUserId(call))
              : projectFrom(call.request, firstUserId(call), [firstUserId(call)], { basisDigest: basis, overlay: { text: OVERLAY } }),
        )
        let edited = false
        afterOrdinaryLookup = () =>
          bridge.promise(
            Effect.gen(function* () {
              if (freshToolCalls !== 2) return
              const stored = yield* sessions.messages({ sessionID: session.id })
              const part = stored
                .flatMap((message) => message.parts)
                .find((p) => p.type === "tool" && p.state.status === "completed" && JSON.stringify(p.state.output).includes("SYNTHETIC_FRESH_TOOL_RESULT_8271"))
              if (!part || part.type !== "tool" || part.state.status !== "completed") throw new Error("completed ordinary part missing")
              expect(cleanGroupFor(session.id, part.messageID)).toBeDefined() // sealed under a projected+overlay request
              yield* sessions.updatePart({ ...part, state: { ...part.state, output: "SYNTHETIC_CHANGED_OVERLAY_ERA_PAYLOAD_7741" } })
              edited = true
            }),
          )
        yield* llm.text(`Assistant quoted source: ${AUTO}`)
        yield* prompt.prompt({ sessionID: session.id, agent: "build", system: `Automatic source data: ${AUTO}`, parts: [{ type: "text", text: "First authored turn" }] })
        yield* compact.create({ sessionID: session.id, agent: "build", model: ref, auto: false })
        yield* llm.text(`Old derived summary: ${AUTO}`)
        yield* prompt.loop({ sessionID: session.id })
        yield* llm.tool("mcp_dispatch", { name: "sol_clean_lookup", arguments: {} })
        yield* llm.tool("mcp_dispatch", { name: "sol_clean_lookup", arguments: {} })
        yield* llm.text("Final continuation")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "Use two ordinary lookups" }] })
        const inputs = yield* llm.inputs
        expect(inputs).toHaveLength(5)
        expect(edited).toBe(true)
        expect(anyHas(inputs[3], "SYNTHETIC_FRESH_TOOL_RESULT_8271")).toBe(true) // first group retained while unedited
        expect(roleHas(inputs[4], "system", "SYNTHETIC_QUALIFIED_ACTIVITY_5530")).toBe(true)
        expect(anyHas(inputs[4], "SYNTHETIC_CHANGED_OVERLAY_ERA_PAYLOAD_7741"), "edited completed payload must not keep its exemption").toBe(false)
        for (const input of inputs.slice(1)) expect(anyHas(input, AUTO)).toBe(false)
      }),
    { git: true },
    60_000,
  )

  it.instance(
    "Sol: actual title generation is a derived history-only summary, not an answer",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        yield* installApi((call) => respond(call.request))
        yield* llm.text("Synthetic generated title")
        yield* llm.text("Ordinary answer")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "Authored first input" }] })
        const inputs = yield* llm.inputs
        expect(inputs).toHaveLength(2)
        const title = calls.find((call) => (call.exported as { agentName?: string }).agentName === "title")
        expect(title).toBeDefined()
        expect(title?.request.purpose, "title generation must not claim an eligible foreground answer purpose").toBe("summary")
      }),
    { git: true },
  )

  it.instance(
    "a group whose basis changed (new body exposure) cannot reuse the clean exemption; certificates die with the runner",
    () =>
      Effect.gen(function* () {
        freshToolCalls = 0
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const compact = yield* SessionCompaction.Service
        const session = yield* sessions.create({ title: "Changed basis", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        // The continuation request (4th call) is admitted under a DIFFERENT authoritative basis.
        yield* installApi((call) =>
          calls.length === 1
            ? respond(call.request)
            : projectFrom(call.request, firstUserId(call), [firstUserId(call)], calls.length === 4 ? { basisDigest: "c".repeat(64) } : {}),
        )
        yield* llm.text(`Assistant quoted source: ${AUTO}`)
        yield* prompt.prompt({ sessionID: session.id, agent: "build", system: `Automatic source data: ${AUTO}`, parts: [{ type: "text", text: "First authored turn" }] })
        yield* compact.create({ sessionID: session.id, agent: "build", model: ref, auto: false })
        yield* llm.text(`Old derived summary: ${AUTO}`)
        yield* prompt.loop({ sessionID: session.id })
        yield* llm.tool("mcp_dispatch", { name: "sol_clean_lookup", arguments: {} })
        yield* llm.text("continuation")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "Use an ordinary lookup now" }] })
        const inputs = yield* llm.inputs
        expect(inputs).toHaveLength(4)
        expect(freshToolCalls).toBe(1) // executed exactly once, but its group is not proved under the new basis
        expect(anyHas(inputs[3], "SYNTHETIC_FRESH_TOOL_RESULT_8271")).toBe(false)
        expect(anyHas(inputs[3], AUTO)).toBe(false)
        expect(roleHas(inputs[3], "system", STATIC)).toBe(true)
        // the proof lived only in the finished runner
        const stored = yield* sessions.messages({ sessionID: session.id })
        for (const m of stored) expect(cleanGroupFor(session.id, m.info.id)).toBeUndefined()
      }),
    { git: true },
  )

  it.instance(
    "distinct user and compaction: dependent assistant/summary leave the provider copy; stored history is intact",
    () =>
      Effect.gen(function* () {
        sourceCurrent = true
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const compact = yield* SessionCompaction.Service
        const session = yield* sessions.create({ title: "Synthetic history", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        yield* installApi((call) => {
          if (call.request.purpose === "compaction") return projectFrom(call.request, firstUserId(call))
          // first call: valid history; every later answer: project from the first user (source changed)
          return calls.length === 1 ? respond(call.request) : projectFrom(call.request, firstUserId(call))
        })

        yield* llm.text(`Assistant quoted source: ${AUTO}`)
        yield* prompt.prompt({ sessionID: session.id, agent: "build", system: `Automatic source data: ${AUTO}`, parts: [{ type: "text", text: "User authored first turn" }] })
        yield* llm.text("Ordinary second answer")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "User authored distinct turn" }] })
        yield* compact.create({ sessionID: session.id, agent: "build", model: ref, auto: false })
        yield* llm.text(`Compacted source-derived summary: ${AUTO}`)
        yield* prompt.loop({ sessionID: session.id })
        yield* llm.text("Ordinary post-compaction answer")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "User authored after compaction" }] })

        const inputs = yield* llm.inputs
        expect(inputs).toHaveLength(4)
        expect(calls.map((c) => c.request.purpose)).toEqual(["answer", "answer", "compaction", "answer"])
        // positive control: the first request was allowed unchanged (valid history)
        expect(roleHas(inputs[0], "system", AUTO)).toBe(true)
        // original diagnostic #1 assertions, now satisfied: no assistant/summary quote after the source changed
        expect(roleHas(inputs[1], "assistant", AUTO)).toBe(false)
        expect(roleHas(inputs[1], "system", AUTO)).toBe(false)
        expect(roleHas(inputs[3], "assistant", AUTO)).toBe(false)
        expect(roleHas(inputs[3], "system", AUTO)).toBe(false)
        // compaction input carries no dependent assistant content and keeps static compaction instructions
        expect(anyHas(inputs[2], AUTO)).toBe(false)
        expect(roleHas(inputs[2], "user", "anchored summary")).toBe(true)
        // static profile text and authored users are preserved
        for (const index of [1, 3]) expect(roleHas(inputs[index], "system", STATIC)).toBe(true)
        expect(roleHas(inputs[1], "user", "User authored first turn")).toBe(true)
        expect(roleHas(inputs[1], "user", "User authored distinct turn")).toBe(true)
        expect(roleHas(inputs[3], "user", "User authored after compaction")).toBe(true)

        // frames were pending, complete, current-native identities (no source text, correct kinds)
        for (const call of calls) {
          expect(parseGuardExport(call.exported).ok).toBe(true)
          expect(call.exported).toMatchObject({ status: "pending", request: call.request, agentName: expect.any(String), originCoverage: "complete" })
          expect(call.authorization).toBe(`Bearer ${TOKEN}`)
          expect(call.url).toBe(`${AGENT_URL}/dayflow-agent/provider-admission`)
          expect(JSON.stringify(call.exported)).not.toContain(AUTO)
        }
        const compaction = calls[2]!
        expect(compaction.exported).toMatchObject({ userKind: "control", agentName: "compaction", initiatingUserMessageId: lastUserId(calls[1]!) })
        expect(new Set(calls.map((c) => c.request.requestNonce)).size).toBe(4)
        // the token is never part of any provider request
        expect(JSON.stringify(inputs)).not.toContain(TOKEN)

        // stored history is untouched: the user's stored overlay, the quote and the summary remain
        const stored = yield* sessions.messages({ sessionID: session.id })
        expect(stored.some((m) => m.info.role === "user" && m.info.system?.includes(AUTO))).toBe(true)
        expect(stored.some((m) => m.info.role === "assistant" && !m.info.summary && m.parts.some((p) => p.type === "text" && p.text.includes(AUTO)))).toBe(true)
        expect(stored.some((m) => m.info.role === "assistant" && m.info.summary && m.parts.some((p) => p.type === "text" && p.text.includes(AUTO)))).toBe(true)
        // the SDK is now durably recorded as managed
        expect(yield* readGuardRecord(session.id)).toMatchObject({ state: "record", record: { managedSeen: true } })
      }),
    { git: true },
  )

  it.instance(
    "same-user tool loop: the next provider request is re-guarded and drops the stale overlay and tool group",
    () =>
      Effect.gen(function* () {
        sourceCurrent = true
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "Synthetic native loop", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        yield* installApi((call) =>
          calls.length === 1 ? respond(call.request) : projectFrom(call.request, firstUserId(call)),
        )
        // MCP tools are lazy by default: the invalidation tool is reached through the dispatcher.
        yield* llm.tool("mcp_dispatch", { name: "sol_invalidate_source", arguments: {} })
        yield* llm.text("Final ordinary reply")
        const result = yield* prompt.prompt({ sessionID: session.id, agent: "build", system: `Automatic source data: ${AUTO}`, parts: [{ type: "text", text: "User authored same native turn" }] })
        const inputs = yield* llm.inputs
        expect(inputs).toHaveLength(2)
        expect(sourceCurrent).toBe(false)
        expect(result.info.role).toBe("assistant")
        expect(calls.map((c) => c.request.attempt)).toEqual([0, 1])
        expect(roleHas(inputs[0], "system", AUTO)).toBe(true)
        // original diagnostic #2 assertion, now satisfied
        expect(roleHas(inputs[1], "system", AUTO)).toBe(false)
        expect(roleHas(inputs[1], "system", STATIC)).toBe(true)
        expect(roleHas(inputs[1], "user", "User authored same native turn")).toBe(true)
        // the dependent tool exchange left the copy as a pair; the stored tool part remains
        expect(providerMessages(inputs[1]).some((m) => m.role === "tool" || m.tool_calls !== undefined)).toBe(false)
        const stored = yield* sessions.messages({ sessionID: session.id })
        expect(stored.flatMap((m) => m.parts).some((p) => p.type === "tool" && p.state.status === "completed")).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "an allowed overlay is injected as a system message for that attempt only; static instructions survive",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "Overlay", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        const overlay = "[Dayflow qualified context]\nSYNTHETIC_CURRENT_ACTIVITY\n[/Dayflow qualified context]"
        yield* installApi((call) => (calls.length === 1 ? respond(call.request, { overlay: { text: overlay } }) : respond(call.request)))
        yield* llm.text("one")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "first" }] })
        yield* llm.text("two")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "second" }] })
        const inputs = yield* llm.inputs
        expect(roleHas(inputs[0], "system", "SYNTHETIC_CURRENT_ACTIVITY")).toBe(true)
        expect(roleHas(inputs[0], "system", STATIC)).toBe(true)
        // never stored, never replayed by native history
        expect(anyHas(inputs[1], "SYNTHETIC_CURRENT_ACTIVITY")).toBe(false)
        const stored = yield* sessions.messages({ sessionID: session.id })
        expect(JSON.stringify(stored)).not.toContain("SYNTHETIC_CURRENT_ACTIVITY")
      }),
    { git: true },
  )

  it.instance(
    "hold: no provider request is made and the failure is body-free",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "Hold", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        yield* installApi((call) =>
          respond(call.request, { decision: "hold", rawHistoryReusable: false, reason: "proof_unavailable", overlay: null }),
        )
        yield* llm.text("must never be requested")
        const result = yield* prompt.prompt({ sessionID: session.id, agent: "build", system: `Automatic source data: ${AUTO}`, parts: [{ type: "text", text: "hello" }] })
        expect(yield* llm.inputs).toHaveLength(0)
        expect(result.info.role).toBe("assistant")
        const error = JSON.stringify(result.info.role === "assistant" ? result.info.error : undefined)
        expect(error).toContain("provider guard held")
        expect(error).not.toContain(AUTO)
        expect(error).not.toContain(TOKEN)
      }),
    { git: true },
  )

  it.instance(
    "unavailable, malformed, mismatched or slow API answers hold; nothing reaches the provider",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const failures: Array<[string, Decide]> = [
          ["throws", () => Promise.reject(new Error("down"))],
          ["http 500", () => new Response("no", { status: 500 })],
          ["not json", () => new Response("<html>", { status: 200 })],
          ["wrong echo", (call) => respond({ ...call.request, requestNonce: "Z".repeat(32) })],
          ["extra key", (call) => ({ ...respond(call.request), extra: true })],
          ["oversize", (call) => new Response(JSON.stringify({ ...respond(call.request), pad: "x".repeat(40_000) }), { status: 200 })],
        ]
        for (const [name, decide] of failures) {
          const session = yield* sessions.create({ title: `Fail ${name}`, permission: [{ permission: "*", pattern: "*", action: "allow" }] })
          yield* installApi(decide)
          yield* llm.text("must never be requested")
          yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: `case ${name}` }] })
          expect(calls.length).toBe(1)
        }
        expect(yield* llm.inputs).toHaveLength(0)
      }),
    { git: true },
  )

  it.instance(
    "a managed SDK stays guarded when integration config is absent; standalone sessions are untouched",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(withProvider) // no rhythm MCP entry at all
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const storage = yield* Storage.Service
        yield* installApi((call) => respond(call.request))

        // standalone: no record, no integration -> bypass entirely (no API read, input unchanged)
        const standalone = yield* sessions.create({ title: "Standalone", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        yield* llm.text("standalone answer")
        yield* prompt.prompt({ sessionID: standalone.id, agent: "build", system: `Automatic source data: ${AUTO}`, parts: [{ type: "text", text: "plain" }] })
        expect(calls).toHaveLength(0)
        const first = (yield* llm.inputs)[0]
        expect(roleHas(first, "system", AUTO)).toBe(true)
        expect(roleHas(first, "system", STATIC)).toBe(true)
        expect(yield* readGuardRecord(standalone.id)).toEqual({ state: "absent" })

        // previously enrolled: the config disappearing cannot evade protection
        const enrolled = yield* sessions.create({ title: "Enrolled", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        yield* enrollGuard(enrolled.id).pipe(Effect.provideService(Storage.Service, storage))
        yield* llm.text("must never be requested")
        yield* prompt.prompt({ sessionID: enrolled.id, agent: "build", parts: [{ type: "text", text: "after config loss" }] })
        expect(calls).toHaveLength(0)
        expect(yield* llm.inputs).toHaveLength(1) // only the standalone request
      }),
    { git: true },
  )

  it.instance(
    "known-ordinary (never enrolled) keeps working through an API outage; enrollment ends that",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(managedCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const storage = yield* Storage.Service
        const session = yield* sessions.create({ title: "Ordinary", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
        let down = false
        yield* installApi((call) => {
          if (down) return Promise.reject(new Error("down"))
          return respond(call.request, { decision: "ordinary", reason: "none", overlay: null })
        })
        yield* llm.text("one")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "first" }] })
        down = true
        yield* llm.text("two")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "second" }] })
        expect(yield* llm.inputs).toHaveLength(2)
        yield* enrollGuard(session.id).pipe(Effect.provideService(Storage.Service, storage))
        yield* llm.text("must never be requested")
        yield* prompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "third" }] })
        expect(yield* llm.inputs).toHaveLength(2)
      }),
    { git: true },
  )
})

// ---------------------------------------------------------------------------
// Retry / attempt boundary through the real AI SDK retry path
// ---------------------------------------------------------------------------
describe("every real doStream attempt, including transport retries, gets a fresh frame", () => {
  const request = (over: Partial<GuardAttemptContext> = {}): GuardAttemptContext => ({
    sdkSessionId: "ses_retry_test",
    userMessageId: "msg_retry_user",
    agentName: "secretary",
    purpose: "answer",
    userKind: "authored",
    initiatingUserMessageId: null,
    origins: undefined,
    userSystem: undefined,
    record: { schemaVersion: 1, managedSeen: true, guarded: false },
    integration: trustedRhythmIntegration({ mcp: rhythmMcp }),
    signal: new AbortController().signal,
    isWorkflow: false,
    ...over,
  })

  beforeEach(() => runnerGenerations.set("ses_retry_test", "run_unit"))
  afterEach(() => {
    runnerGenerations.delete("ses_retry_test")
    clearRunnerCertificates("ses_retry_test")
  })
  const params = { prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as never

  test("no positively current runner: held before any API read", async () => {
    runnerGenerations.delete("ses_retry_test")
    let fetches = 0
    guardTransport.fetch = async () => {
      fetches++
      throw new Error("must not be called")
    }
    await expect(providerGuardMiddleware(request()).transformParams!({ type: "stream", params, model: {} as never })).rejects.toThrow("provider guard held")
    expect(fetches).toBe(0)
  })

  test("a non-answer purpose never accepts an activity overlay (title/summary and compaction are history-only)", async () => {
    resetGuardCaches()
    for (const purpose of ["summary", "compaction"] as const) {
      guardTransport.fetch = async (_url, init) => {
        const parsed = parseGuardRequest(JSON.parse(String(init.body)))
        if (!parsed.ok) throw new Error("bad request")
        return new Response(JSON.stringify(respond(parsed.value, { overlay: { text: "[Dayflow qualified context]\nX\n[/Dayflow qualified context]" } })), { status: 200 })
      }
      await expect(providerGuardMiddleware(request({ purpose })).transformParams!({ type: "stream", params, model: {} as never })).rejects.toThrow("provider guard held")
    }
    // the same producer answer is fine for an answer
    guardTransport.fetch = async (_url, init) => {
      const parsed = parseGuardRequest(JSON.parse(String(init.body)))
      if (!parsed.ok) throw new Error("bad request")
      return new Response(JSON.stringify(respond(parsed.value, { overlay: { text: "[Dayflow qualified context]\nX\n[/Dayflow qualified context]" } })), { status: 200 })
    }
    await providerGuardMiddleware(request()).transformParams!({ type: "stream", params, model: {} as never })
  })

  test("AI SDK retry re-enters the guard: two attempts, distinct nonces, attempt 0 then 1", async () => {
    resetGuardCaches()
    const seen: GuardRequest[] = []
    guardTransport.fetch = async (_url, init) => {
      const parsed = parseGuardRequest(JSON.parse(String(init.body)))
      if (!parsed.ok) throw new Error("bad request")
      seen.push(parsed.value)
      return new Response(JSON.stringify(respond(parsed.value, { decision: "ordinary", overlay: null })), { status: 200 })
    }
    let calls = 0
    const model = {
      specificationVersion: "v3" as const,
      provider: "fake",
      modelId: "fake",
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error("unused")
      },
      doStream: async () => {
        calls++
        if (calls === 1) {
          throw new APICallError({ message: "overloaded", url: "http://x", requestBodyValues: {}, statusCode: 503, isRetryable: true })
        }
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] })
              controller.enqueue({ type: "text-start", id: "t" })
              controller.enqueue({ type: "text-delta", id: "t", delta: "ok" })
              controller.enqueue({ type: "text-end", id: "t" })
              controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } })
              controller.close()
            },
          }),
        }
      },
    }
    const result = streamText({
      model: wrapLanguageModel({ model: model as never, middleware: [providerGuardMiddleware(request())] }),
      messages: [{ role: "user", content: "hi" }],
      maxRetries: 2,
    })
    await result.text
    expect(calls).toBe(2)
    expect(seen.map((r) => r.attempt)).toEqual([0, 1])
    expect(new Set(seen.map((r) => r.requestNonce)).size).toBe(2)
  })

  test("agent change discards the ordinary absence cache; an obsolete attempt cannot proceed", async () => {
    resetGuardCaches()
    let down = false
    guardTransport.fetch = async (_url, init) => {
      if (down) throw new Error("down")
      const parsed = parseGuardRequest(JSON.parse(String(init.body)))
      if (!parsed.ok) throw new Error("bad request")
      return new Response(JSON.stringify(respond(parsed.value, { decision: "ordinary", overlay: null })), { status: 200 })
    }
    const params = { prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as never
    const a = providerGuardMiddleware(request())
    await a.transformParams!({ type: "stream", params, model: {} as never })
    down = true
    // same agent: classification still valid for this process generation
    await a.transformParams!({ type: "stream", params, model: {} as never })
    // different agent: cache discarded -> hold
    const other = providerGuardMiddleware(request({ agentName: "other-agent" }))
    await expect(other.transformParams!({ type: "stream", params, model: {} as never })).rejects.toThrow("provider guard held")
    // an aborted attempt never exposes the input
    const aborted = new AbortController()
    down = false
    const abortedMiddleware = providerGuardMiddleware(request({ signal: aborted.signal }))
    guardTransport.fetch = async (_url, init) => {
      aborted.abort()
      const parsed = parseGuardRequest(JSON.parse(String(init.body)))
      if (!parsed.ok) throw new Error("bad request")
      return new Response(JSON.stringify(respond(parsed.value, { decision: "ordinary", overlay: null })), { status: 200 })
    }
    await expect(abortedMiddleware.transformParams!({ type: "stream", params, model: {} as never })).rejects.toThrow("provider guard held")
  })
})

// ---------------------------------------------------------------------------
// Pure projection rules on prepared prompts
// ---------------------------------------------------------------------------
describe("projection works on a copy using real anchors and complete groups", () => {
  const origins: ProviderOrigins = {
    purpose: "answer",
    userMessageId: "msg_c",
    userKind: "authored",
    initiatingUserMessageId: null,
    leadingStatic: 0,
    entries: [
      { id: "msg_a", kind: "authored_user", count: 1, toolCallIds: [] },
      { id: "msg_b", kind: "assistant", count: 2, toolCallIds: ["call_1"] },
      { id: "msg_s", kind: "derived_summary", count: 1, toolCallIds: [] },
      { id: "msg_c", kind: "authored_user", count: 1, toolCallIds: [] },
    ],
    trailingStatic: 0,
  }
  const mark = (messages: unknown[]) =>
    markModelMessages(messages as never, origins) as unknown as PromptMessage[]
  const history = mark([
    { role: "user", content: "earlier" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "call_1", toolName: "t", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "call_1", toolName: "t", output: { type: "text", value: "SECRET" } }] },
    { role: "assistant", content: "summary SECRET" },
    { role: "user", content: "current" },
  ])
  const system = [{ role: "system", content: "STATIC\nUSER_OVERLAY" }] as PromptMessage[]

  test("markers account exactly, are private, and strip cleanly", () => {
    expect(history.map((m) => (m.providerOptions as Record<string, unknown>)?.[GUARD_MARKER])).toEqual([
      { o: 0 }, { o: 1 }, { o: 1 }, { o: 2 }, { o: 3 },
    ])
    expect(stripMarkers(history).every((m) => m.providerOptions === undefined)).toBe(true)
    // a count that does not account for the input leaves it unmarked (coverage then ambiguous)
    expect(markModelMessages([{ role: "user", content: "x" }] as never, origins)).toEqual([{ role: "user", content: "x" }])
  })

  test("complete assistant/tool groups and derived summaries after the anchor are removed; users stay", () => {
    const projected = projectPrompt([...system, ...history], origins, { fromUserMessageId: "msg_a", sourceAnchorIds: ["msg_a"] }, "complete")!
    expect(projected.map((m) => m.role)).toEqual(["system", "user", "user"])
    expect(JSON.stringify(projected)).not.toContain("SECRET")
    expect(JSON.stringify(projected)).toContain("earlier")
    expect(JSON.stringify(projected)).toContain("current")
  })

  test("an anchor that is not visible orders by native message id; ambiguity or no coverage holds", () => {
    const hidden = projectPrompt([...system, ...history], origins, { fromUserMessageId: "msg_0", sourceAnchorIds: ["msg_0"] }, "complete")!
    expect(JSON.stringify(hidden)).not.toContain("SECRET")
    expect(projectPrompt([...system, ...history], origins, { fromUserMessageId: "msg_a", sourceAnchorIds: ["msg_a"] }, "ambiguous")).toBeUndefined()
    expect(projectPrompt([...system, ...history], origins, { fromUserMessageId: "not-comparable", sourceAnchorIds: ["x"] }, "complete")).toBeUndefined()
    // a tool call whose origin marker was lost would be left unpaired when its result is removed: hold
    const unmarkedCall = history.map((m, i) => (i === 1 ? ({ ...m, providerOptions: undefined } as PromptMessage) : m))
    expect(projectPrompt([...system, ...unmarkedCall], origins, { fromUserMessageId: "msg_a", sourceAnchorIds: ["msg_a"] }, "complete")).toBeUndefined()
  })

  test("compaction control: derived spans are replaced by static-only text, or the request holds", () => {
    const compaction: ProviderOrigins = {
      ...origins,
      purpose: "compaction",
      entries: [{ id: "msg_a", kind: "authored_user", count: 1, toolCallIds: [] }],
      trailingControl: { id: "msg_ctl", derived: true, staticText: "STATIC_TEMPLATE" },
    }
    const prompt = markModelMessages(
      [{ role: "user", content: "earlier" }, { role: "user", content: [{ type: "text", text: "TEMPLATE <previous-summary>SECRET</previous-summary>" }] }] as never,
      compaction,
    ) as unknown as PromptMessage[]
    const projected = projectPrompt(prompt, compaction, { fromUserMessageId: "msg_a", sourceAnchorIds: ["msg_a"] }, "complete")!
    expect(JSON.stringify(projected)).toContain("STATIC_TEMPLATE")
    expect(JSON.stringify(projected)).not.toContain("SECRET")
    const unknowable = { ...compaction, trailingControl: { id: "msg_ctl", derived: true } }
    expect(projectPrompt(prompt, unknowable, { fromUserMessageId: "msg_a", sourceAnchorIds: ["msg_a"] }, "complete")).toBeUndefined()
  })

  test("legacy user.system overlay is cut only when it is found exactly once", () => {
    const cut = removeUserSystem(system, undefined, "USER_OVERLAY")!
    expect(cut.prompt[0]!.content).toBe("STATIC")
    expect(removeUserSystem(system, "USER_OVERLAY", "USER_OVERLAY")).toBeUndefined()
    expect(removeUserSystem(system, undefined, "MISSING")).toBeUndefined()
    const oauth = removeUserSystem([], "STATIC\nUSER_OVERLAY", "USER_OVERLAY")!
    expect(oauth.instructions).toBe("STATIC")
  })

  describe("clean-group certificates (runner-scoped, basis-bound)", () => {
    const sdk = "ses_cert_test"
    const groupFor = (id: string, calls: string[], output = "OUT", over: Record<string, unknown> = {}) => ({
      info: { id, role: "assistant", finish: "tool-calls", ...over },
      parts: [
        { type: "text", text: "generated" },
        ...calls.map((callID) => ({ type: "tool", tool: "t", callID, state: { status: "completed", input: { q: 1 }, output, time: { start: 1, end: 2 } } })),
      ],
    })
    const newGroup = groupFor("msg_new", ["call_new"])
    const certOrigins: ProviderOrigins = {
      ...origins,
      entries: [
        { id: "msg_a", kind: "authored_user", count: 1, toolCallIds: [] },
        { id: "msg_new", kind: "assistant", count: 2, toolCallIds: ["call_new"], contentDigest: completedGroupDigest(newGroup, ["call_new"]) },
        { id: "msg_old", kind: "assistant", count: 1, toolCallIds: [] },
        { id: "msg_sum", kind: "derived_summary", count: 1, toolCallIds: [] },
      ],
    }
    const ctx = { sdkSessionId: sdk, agentName: "secretary", purpose: "answer" as const }
    const decision = (over: Record<string, unknown> = {}, anchors = ["msg_a"]) =>
      projectFrom(
        { schemaVersion: 1, sdkSessionId: sdk, userMessageId: "msg_c", requestNonce: "N".repeat(32), engineGeneration: "e", runnerGeneration: "run_cert", attempt: 1, purpose: "answer", inputDigest: "a".repeat(64) },
        "msg_a",
        anchors,
        over,
      ) as unknown as GuardResponse
    const certificate = {
      assistantId: "msg_new",
      toolCallIds: ["call_new"],
      agentName: "secretary",
      basisDigest: "b".repeat(64),
      fromUserMessageId: "msg_a",
      sourceAnchorIds: ["msg_a"],
      generatingInputDigest: "d".repeat(64),
    }
    beforeEach(() => runnerGenerations.set(sdk, "run_cert"))
    afterEach(() => {
      runnerGenerations.delete(sdk)
      clearRunnerCertificates(sdk)
    })

    /** Provisional at the provider handoff, then sealed once from the completed canonical group. */
    const seal = (cert: typeof certificate, group: ReturnType<typeof groupFor> = groupFor(cert.assistantId, cert.toolCallIds)) => {
      registerCleanGroup(sdk, "run_cert", cert)
      return sealCleanGroup(sdk, cert.assistantId, group)
    }

    test("only the exact whole group under the same basis/anchors/agent/tool calls is exempt; summaries and unknown groups never", () => {
      expect(seal(certificate, newGroup)).toBe(true)
      expect([...exemptCleanGroups(ctx, certOrigins, decision())]).toEqual([1])
      for (const changed of [
        decision({ basisDigest: "c".repeat(64) }), // new body exposure / receiver change
        decision({}, ["msg_a", "msg_x"]), // different anchor set
      ]) {
        expect(exemptCleanGroups(ctx, certOrigins, changed).size).toBe(0)
      }
      expect(exemptCleanGroups({ ...ctx, agentName: "other" }, certOrigins, decision()).size).toBe(0)
      expect(exemptCleanGroups({ ...ctx, purpose: "compaction" }, certOrigins, decision()).size).toBe(0)
      const partial = { ...certOrigins, entries: certOrigins.entries.map((e) => (e.id === "msg_new" ? { ...e, toolCallIds: ["call_new", "call_extra"] } : e)) }
      expect(exemptCleanGroups(ctx, partial, decision()).size).toBe(0) // changed/partial group identity
      // exempting never reaches an old assistant, a derived summary, or an anchor
      expect(exemptCleanGroups(ctx, certOrigins, decision()).has(2)).toBe(false)
      expect(exemptCleanGroups(ctx, certOrigins, decision()).has(3)).toBe(false)
      seal({ ...certificate, assistantId: "msg_old", toolCallIds: [] })
      const asAnchor = decision({}, ["msg_a", "msg_new"])
      expect(exemptCleanGroups(ctx, certOrigins, asAnchor).size).toBe(0)
    })

    test("provisional certificates never exempt; sealing happens once and an edit can only fail the comparison", () => {
      registerCleanGroup(sdk, "run_cert", certificate) // handoff provenance only
      expect(cleanGroupFor(sdk, "msg_new")).toBeUndefined()
      expect(exemptCleanGroups(ctx, certOrigins, decision()).size).toBe(0)
      expect(sealCleanGroup(sdk, "msg_new", newGroup)).toBe(true)
      expect([...exemptCleanGroups(ctx, certOrigins, decision())]).toEqual([1])
      // an edit after sealing: the stored group now hashes differently => no exemption
      const edited = { ...certOrigins, entries: certOrigins.entries.map((e) => (e.id === "msg_new" ? { ...e, contentDigest: completedGroupDigest(groupFor("msg_new", ["call_new"], "EDITED"), ["call_new"]) } : e)) }
      expect(exemptCleanGroups(ctx, edited, decision()).size).toBe(0)
      // sealing is never refreshed from edited content, and a re-handoff cannot overwrite a sealed certificate
      expect(sealCleanGroup(sdk, "msg_new", groupFor("msg_new", ["call_new"], "EDITED"))).toBe(false)
      registerCleanGroup(sdk, "run_cert", { ...certificate, basisDigest: "e".repeat(64) })
      expect(cleanGroupFor(sdk, "msg_new")?.basisDigest).toBe(certificate.basisDigest)
      expect([...exemptCleanGroups(ctx, certOrigins, decision())]).toEqual([1])
    })

    test("pending, running, errored, interrupted, partial or summary groups are never sealed clean", () => {
      const tool = (status: string) => ({ type: "tool", tool: "t", callID: "call_new", state: { status, input: {}, output: "x" } })
      const cases: Array<[string, Parameters<typeof sealCleanGroup>[2]]> = [
        ["missing group", undefined],
        ["pending tool", { ...newGroup, parts: [tool("pending")] }],
        ["running tool", { ...newGroup, parts: [tool("running")] }],
        ["tool error", { ...newGroup, parts: [tool("error")] }],
        ["assistant error", groupFor("msg_new", ["call_new"], "OUT", { error: { name: "AbortedError" } })],
        ["no finish (interrupted)", groupFor("msg_new", ["call_new"], "OUT", { finish: undefined })],
        ["summary", groupFor("msg_new", ["call_new"], "OUT", { summary: true })],
        ["extra tool call", groupFor("msg_new", ["call_new", "call_extra"])],
        ["missing tool call", groupFor("msg_new", [])],
        ["other assistant", groupFor("msg_other", ["call_new"])],
      ]
      for (const [name, group] of cases) {
        registerCleanGroup(sdk, "run_cert", certificate)
        expect(sealCleanGroup(sdk, "msg_new", group), name).toBe(false)
        expect(cleanGroupFor(sdk, "msg_new"), name).toBeUndefined()
      }
    })

    test("the content digest binds text, reasoning, tool input/output/mcp content and attachments, not accounting", () => {
      const base = (part: Record<string, unknown>) => ({
        info: { id: "msg_new", role: "assistant", finish: "stop" },
        parts: [{ type: "tool", tool: "t", callID: "c", state: { status: "completed", input: { q: 1 }, output: "o", ...part } }],
      })
      const digest = (g: ReturnType<typeof base>) => completedGroupDigest(g as never, ["c"])
      const reference = digest(base({}))!
      expect(digest(base({ time: { start: 9, end: 99 }, title: "other", metadata: { a: 1 } }))).toBe(reference)
      for (const changed of [
        { input: { q: 2 } },
        { output: "O" },
        { mcpResult: { content: [{ type: "text", text: "x" }] } },
        { attachments: [{ mime: "text/plain", url: "data:text/plain;base64,YQ==" }] },
        { time: { compacted: 1 } },
      ]) {
        expect(digest(base(changed))).not.toBe(reference)
      }
      const text = (t: string, kind = "text") => ({ info: { id: "m", role: "assistant", finish: "stop" }, parts: [{ type: kind, text: t }] })
      expect(completedGroupDigest(text("a") as never, [])).not.toBe(completedGroupDigest(text("b") as never, []))
      expect(completedGroupDigest(text("a") as never, [])).not.toBe(completedGroupDigest(text("a", "reasoning") as never, []))
    })

    test("a certificate is invalid under another runner generation, after release, and is bounded", () => {
      seal(certificate)
      expect(cleanGroupFor(sdk, "msg_new")).toBeDefined()
      runnerGenerations.set(sdk, "run_other")
      expect(cleanGroupFor(sdk, "msg_new")).toBeUndefined()
      expect(exemptCleanGroups(ctx, certOrigins, decision()).size).toBe(0)
      runnerGenerations.set(sdk, "run_cert")
      clearRunnerCertificates(sdk)
      expect(cleanGroupFor(sdk, "msg_new")).toBeUndefined()
      // cannot register against a generation that is not current
      registerCleanGroup(sdk, "run_stale", certificate)
      expect(cleanGroupFor(sdk, "msg_new")).toBeUndefined()
      for (let i = 0; i < 100; i++) seal({ ...certificate, assistantId: `msg_${i}`, toolCallIds: [] })
      expect(cleanGroupFor(sdk, "msg_0")).toBeUndefined()
      expect(cleanGroupFor(sdk, "msg_99")).toBeDefined()
    })

    test("projectPrompt keeps an exempt whole group (call and result together) and still drops the rest", () => {
      const marked = markModelMessages(
        [
          { role: "user", content: "earlier" },
          { role: "assistant", content: [{ type: "tool-call", toolCallId: "call_new", toolName: "t", input: {} }] },
          { role: "tool", content: [{ type: "tool-result", toolCallId: "call_new", toolName: "t", output: { type: "text", value: "FRESH" } }] },
          { role: "assistant", content: "old quote SECRET" },
          { role: "assistant", content: "derived SECRET" },
        ] as never,
        certOrigins,
      ) as unknown as PromptMessage[]
      const projected = projectPrompt(marked, certOrigins, { fromUserMessageId: "msg_a", sourceAnchorIds: ["msg_a"] }, "complete", new Set([1]))!
      expect(JSON.stringify(projected)).toContain("FRESH")
      expect(JSON.stringify(projected)).not.toContain("SECRET")
      expect(projected.map((m) => m.role)).toEqual(["user", "assistant", "tool"])
    })
  })

  describe("overlay-bearing projected answer: handoff certificate rules (stub producer)", () => {
    const sdk = "ses_ovl_unit"
    const OUT = "msg_ovl_out"
    const basis = producerBasis()
    beforeEach(() => runnerGenerations.set(sdk, "run_ovl"))
    afterEach(() => {
      runnerGenerations.delete(sdk)
      clearRunnerCertificates(sdk)
      resetGuardCaches()
    })
    const doneGroup = {
      info: { id: OUT, role: "assistant", finish: "tool-calls" },
      parts: [{ type: "tool", tool: "t", callID: "call_new", state: { status: "completed", input: {}, output: "OUT" } }],
    }
    const goodStream = [{ type: "tool-call", toolCallId: "call_new" }, { type: "finish" }]

    /** One real middleware attempt: transform (admission) then the actual provider handoff + stream. */
    const attempt = async (over: {
      response?: Record<string, unknown>
      stream?: Array<Record<string, unknown>>
      abortAtFinish?: boolean
      outputAssistantId?: string | undefined
      purpose?: "answer" | "compaction" | "summary"
    }) => {
      const abort = new AbortController()
      guardTransport.fetch = async (_url, init) => {
        const parsed = parseGuardRequest(JSON.parse(String(init.body)))
        if (!parsed.ok) throw new Error("bad request")
        const response =
          over.response ??
          projectFrom(parsed.value, "msg_a", ["msg_a"], { basisDigest: basis, overlay: { text: OVERLAY } })
        return new Response(JSON.stringify(respond(parsed.value, response)), { status: 200 })
      }
      const middleware = providerGuardMiddleware({
        sdkSessionId: sdk,
        userMessageId: "msg_c",
        agentName: "secretary",
        purpose: over.purpose ?? "answer",
        userKind: "authored",
        initiatingUserMessageId: null,
        origins: { ...origins, purpose: over.purpose ?? "answer" },
        userSystem: undefined,
        record: { schemaVersion: 1, managedSeen: true, guarded: false },
        integration: trustedRhythmIntegration({ mcp: rhythmMcp }),
        signal: abort.signal,
        isWorkflow: false,
        outputAssistantId: "outputAssistantId" in over ? over.outputAssistantId : OUT,
      })
      const params = { prompt: [...system, ...history] } as never
      const out = await middleware.transformParams!({ type: "stream", params, model: {} as never })
      const parts = over.stream ?? goodStream
      const stream = new ReadableStream({
        start(controller) {
          for (const part of parts) {
            if (part.type === "finish" && over.abortAtFinish) abort.abort()
            controller.enqueue(part)
          }
          controller.close()
        },
      })
      const handed = await middleware.wrapStream!({
        doStream: async () => ({ stream }) as never,
        doGenerate: async () => {
          throw new Error("unused")
        },
        params: out,
        model: {} as never,
      })
      const reader = handed.stream.getReader()
      while (!(await reader.read()).done) {}
      return out
    }
    const sealed = () => sealCleanGroup(sdk, OUT, doneGroup)

    test("a safe projected answer WITH a qualified overlay hands off, then seals once from the canonical group", async () => {
      const out = await attempt({})
      expect(JSON.stringify((out as { prompt: unknown }).prompt)).toContain("SYNTHETIC_QUALIFIED_ACTIVITY_5530") // overlay really exposed
      expect(cleanGroupFor(sdk, OUT)).toBeUndefined() // handoff alone is provisional
      expect(sealed()).toBe(true)
      expect(cleanGroupFor(sdk, OUT)).toMatchObject({ assistantId: OUT, toolCallIds: ["call_new"], basisDigest: basis, fromUserMessageId: "msg_a", sourceAnchorIds: ["msg_a"], agentName: "secretary" })
      expect(sealed()).toBe(false) // never resealed
    })

    test("failed, partial, interrupted or aborted streams leave no certificate", async () => {
      await attempt({ stream: [{ type: "tool-call", toolCallId: "call_new" }, { type: "error", error: "boom" }, { type: "finish" }] })
      expect(sealed()).toBe(false)
      await attempt({ stream: [{ type: "tool-call", toolCallId: "call_new" }] }) // truncated: no finish
      expect(sealed()).toBe(false)
      await attempt({ abortAtFinish: true })
      expect(sealed()).toBe(false)
    })

    test("allow (no projection), a missing assistant identity, and history-only purposes confer no exception", async () => {
      await attempt({ response: { decision: "allow", reason: "none", rawHistoryReusable: true, projection: null, basisDigest: basis, overlay: { text: OVERLAY } } })
      expect(sealed()).toBe(false)
      await attempt({ outputAssistantId: undefined })
      expect(sealed()).toBe(false)
      // compaction/summary never accept an overlay at all (existing rule); a projection without one is no answer
      await expect(attempt({ purpose: "summary" })).rejects.toThrow("provider guard held")
      expect(sealed()).toBe(false)
    })
  })

  test("trusted integration comes only from a loopback rhythm local MCP entry", () => {
    expect(trustedRhythmIntegration({ mcp: rhythmMcp })).toEqual({ url: AGENT_URL, token: TOKEN })
    expect(trustedRhythmIntegration({})).toBeUndefined()
    const bad = (url: string) =>
      trustedRhythmIntegration({ mcp: { rhythm: { type: "local", environment: { RHYTHM_AGENT_URL: url, RHYTHM_API_TOKEN: TOKEN } } } })
    expect(bad("https://api.vcrcapps.com")).toBeUndefined()
    expect(bad("http://evil.example:4001")).toBeUndefined()
    expect(bad("http://user:pw@127.0.0.1:4001")).toBeUndefined()
    expect(trustedRhythmIntegration({ mcp: { rhythm: { type: "local", enabled: false, environment: rhythmMcp.rhythm.environment } } })).toBeUndefined()
    expect(trustedRhythmIntegration({ mcp: { other: rhythmMcp.rhythm } })).toBeUndefined()
  })

  test("origins from stored messages: kinds, counts, initiating user for a control message", async () => {
    const stored = [
      { info: { id: "msg_1", role: "user" }, parts: [{ type: "text" }] },
      { info: { id: "msg_2", role: "assistant" }, parts: [{ type: "tool", callID: "call_9" }] },
      { info: { id: "msg_3", role: "assistant", summary: true }, parts: [{ type: "text" }] },
      { info: { id: "msg_4", role: "user" }, parts: [{ type: "compaction" }] },
    ]
    const origins = await buildProviderOrigins({
      purpose: "compaction",
      userMessageId: "msg_4",
      messages: stored.slice(0, 3),
      context: stored,
      convertedCount: async (m) => (m.info.id === "msg_2" ? 2 : 1),
      trailingControl: { id: "msg_4", derived: false },
    })
    expect(origins).toMatchObject({ userKind: "control", initiatingUserMessageId: "msg_1", trailingStatic: 0 })
    expect(origins.entries.map((e) => [e.id, e.kind, e.count, e.toolCallIds])).toEqual([
      ["msg_1", "authored_user", 1, []],
      ["msg_2", "assistant", 2, ["call_9"]],
      ["msg_3", "derived_summary", 1, []],
    ])
    expect(guardInputDigest({ a: 1 }, [])).toHaveLength(64)
  })
})


// Sol: actual converter parity, pure supplied canonical fixtures; no API/provider calls.
test("Sol mapped payload: every changed actual assistant conversion invalidates the sealed content digest", async () => {
  const model = { providerID: "test", id: "test-model", api: { npm: "@ai-sdk/anthropic", id: "test-model" } } as never
  const group = {
    info: { id: "msg_sol_mapped", role: "assistant", finish: "tool-calls", providerID: "test", modelID: "test-model" },
    parts: [
      { type: "reasoning", text: "synthetic reasoning", metadata: { anthropic: { signature: "SYN_SIG_A" } } },
      { type: "text", text: "synthetic text", metadata: { openai: { itemId: "SYN_TEXT_A" } } },
      { type: "tool", tool: "lookup", callID: "call_sol", metadata: { openai: { itemId: "SYN_CALL_A" } }, state: { status: "completed", input: { q: 1 }, output: "synthetic ordinary result", title: "ordinary", time: { start: 1, end: 2, compacted: 0 }, attachments: [{ mime: "image/png", url: "data:image/png;base64,YQ==", filename: "a.png" }] } },
    ],
  }
  const digest = (g: typeof group) => completedGroupDigest(g as never, ["call_sol"])
  const converted = async (g: typeof group) => JSON.stringify(await MessageV2.toModelMessages([g] as never, model))
  const baseline = await converted(group)
  const baseDigest = digest(group)
  expect(baseDigest).toBeDefined()
  const changes: Array<[string, (g: any) => void]> = [
    ["reasoning provider metadata/signature", g => { g.parts[0].metadata.anthropic.signature = "SYN_SIG_B" }],
    ["text provider metadata", g => { g.parts[1].metadata.openai.itemId = "SYN_TEXT_B" }],
    ["tool call provider metadata", g => { g.parts[2].metadata.openai.itemId = "SYN_CALL_B" }],
    ["tool providerExecuted", g => { g.parts[2].metadata.providerExecuted = true }],
    ["stored model selector", g => { g.info.modelID = "other-model" }],
    ["step-start structure", g => { g.parts.splice(2, 0, { type: "step-start" }) }],
    ["compacted truthiness 0 to 1", g => { g.parts[2].state.time.compacted = 1 }],
    ["attachment bytes", g => { g.parts[2].state.attachments[0].url = "data:image/png;base64,Yg==" }],
    ["attachment mime", g => { g.parts[2].state.attachments[0].mime = "image/jpeg" }],
  ]
  const missed: string[] = []
  for (const [name, mutate] of changes) {
    const changed = structuredClone(group)
    mutate(changed)
    expect(await converted(changed), `${name} must change the ACTUAL MessageV2 model input`).not.toBe(baseline)
    if (digest(changed) === baseDigest) missed.push(name)
  }
  // Completed state.metadata is accounting here; MCP content is conservatively sealed even though this converter consumes output.
  const accounting = structuredClone(group) as any
  accounting.parts[2].state.metadata = { synthetic_accounting: 9 }
  accounting.parts[2].state.title = "new title"
  accounting.parts[2].state.time.end = 99
  expect(await converted(accounting)).toBe(baseline)
  expect(digest(accounting)).toBe(baseDigest)
  const mcp = structuredClone(group) as any
  mcp.parts[2].state.mcpResult = { structuredContent: { value: "synthetic MCP result" }, _meta: { source: "synthetic" }, isError: false }
  expect(await converted(mcp)).toBe(baseline)
  expect(digest(mcp)).not.toBe(baseDigest)
  const ignoredFlags = structuredClone(group) as any
  ignoredFlags.parts[1].ignored = true
  ignoredFlags.parts[1].synthetic = true
  expect(await converted(ignoredFlags), "assistant text flags do not affect this converter (user flags do)").toBe(baseline)
  const directFile = structuredClone(group) as any
  directFile.parts.push({ type: "file", mime: "image/png", url: "data:image/png;base64,Yw==", filename: "ignored.png" })
  expect(await converted(directFile), "standalone assistant file parts are not rendered; tool attachments are").toBe(baseline)
  expect(missed, "actual converter inputs omitted from the clean-group seal").toEqual([])
})
