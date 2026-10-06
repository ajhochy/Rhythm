/**
 * Integration test: per-session MCP tool-schema scoping (E2E proof).
 *
 * Exercises the REAL resolveTools path in src/session/prompt.ts:
 *   mcp.tools() + mcp.toolClientNames() → filterMcpToolsByAllowlist → tools dict → LLM call
 *
 * The test is falsifiable: the offered tool set is captured from the *actual
 * HTTP request body* that the LLM server receives (hit.body.tools[].function.name).
 * If the gate (filterMcpToolsByAllowlist) were removed, all 5 tools would be
 * offered for every case and Cases B/C/D would fail.
 */

import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { dynamicTool, jsonSchema } from "ai"
import * as Log from "@opencode-ai/core/util/log"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
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
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Reference } from "../../src/reference/reference"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Ripgrep } from "../../src/file/ripgrep"
import { Format } from "../../src/format"
import * as Database from "../../src/storage/db"

void Log.init({ print: false })

// ---------------------------------------------------------------------------
// Mock MCP: 5 tools across 2 servers
//
// Servers:  "rhythm"   → tools: ping, list_tasks, create_task
//           "obsidian" → tools: get_file, put_file
//
// Composed keys used as dict keys (and as the names the LLM sees):
//   rhythm_ping, rhythm_list_tasks, rhythm_create_task
//   obsidian_get_file, obsidian_put_file
// ---------------------------------------------------------------------------

function makeMockTool(description: string) {
  return dynamicTool({
    description,
    inputSchema: jsonSchema({
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    }),
    execute: async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      structuredContent: { kind: "issue-1342-contract", count: 2 },
      _meta: { source: "mock-mcp-server", nested: { retained: true } },
      isError: false,
    }),
  })
}

const MOCK_TOOL_DESCRIPTIONS: Record<string, string> = {
  rhythm_ping: "rhythm ping",
  rhythm_list_tasks: "rhythm list tasks",
  rhythm_create_task: "rhythm create task",
  obsidian_get_file: "obsidian get file",
  obsidian_put_file: "obsidian put file",
}

/**
 * Build a FRESH tool dict on every call. resolveTools (session/prompt.ts, both
 * the eager loop and the deferred-mode wrapMcpTool patched in #843) mutates
 * `item.execute`/`item.inputSchema` in place — exactly like the REAL
 * mcp/index.ts#tools(), which calls convertMcpTool() fresh every invocation
 * (a brand-new dynamicTool() object each time, never a cached/shared one).
 * A previous version of this fixture returned one shared, module-level
 * MOCK_MCP_TOOLS object from every `tools()` call; that violates the real
 * implementation's "fresh object per call" contract and let one test's
 * resolveTools mutation leak into the next test's tool objects (rewrapping
 * an already-wrapped execute), which only surfaces once TWO resolveTools
 * consumers of the SAME key exist across tests — i.e. exactly what Case G's
 * dispatch-and-execute path (issue #843) added. Fixed here, in the fixture,
 * not in production code, since production never shared the object to begin
 * with.
 */
function freshMockMcpTools(): Record<string, ReturnType<typeof dynamicTool>> {
  const out: Record<string, ReturnType<typeof dynamicTool>> = {}
  for (const [key, description] of Object.entries(MOCK_TOOL_DESCRIPTIONS)) {
    out[key] = makeMockTool(description)
  }
  out.rhythm_strict = makeStrictTool()
  out.rhythm_dialect = makeCountedTool("rhythm_dialect", {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { value: { type: "array", prefixItems: [{ type: "integer" }] } },
    required: ["value"],
    additionalProperties: false,
  })
  // Two distinct tools that reuse one $id with different schemas.
  out.rhythm_id_a = makeCountedTool("rhythm_id_a", {
    $id: "https://example.test/shared.json",
    type: "object",
    properties: { a: { type: "string" } },
    required: ["a"],
    additionalProperties: false,
  })
  out.rhythm_id_b = makeCountedTool("rhythm_id_b", {
    $id: "https://example.test/shared.json",
    type: "object",
    properties: { b: { type: "integer" } },
    required: ["b"],
    additionalProperties: false,
  })
  return out
}

const counted: Record<string, number> = {}
/** JSON-schema-only tool (no validate hook) that counts real executions. */
function makeCountedTool(name: string, schema: Record<string, unknown>) {
  return dynamicTool({
    description: name,
    inputSchema: jsonSchema(schema as never),
    execute: async () => {
      counted[name] = (counted[name] ?? 0) + 1
      return { content: [{ type: "text" as const, text: `${name}-ok` }], isError: false }
    },
  })
}

/**
 * JSON-schema-only definition exactly like mcp/index.ts#convertMcpTool: plain
 * `jsonSchema(schema)` with NO validate hook. Counts real executions so a
 * malformed call that reaches the underlying tool is observable.
 */
let strictExecutions = 0
function makeStrictTool() {
  return dynamicTool({
    description: "rhythm strict",
    inputSchema: jsonSchema({
      type: "object" as const,
      properties: {
        payload: { type: "string" as const },
        nested: { type: "object" as const, properties: { n: { type: "integer" as const } }, required: ["n"] },
      },
      required: ["payload"],
      additionalProperties: false,
    }),
    execute: async () => {
      strictExecutions++
      return { content: [{ type: "text" as const, text: "strict-ok" }], isError: false }
    },
  })
}

/** Keys only, for tests that just need the known-key set (no mutation risk). */
const MOCK_MCP_TOOL_KEYS = Object.keys(MOCK_TOOL_DESCRIPTIONS)

/** composedKey → raw clientName */
const MOCK_KEY_TO_SERVER: Record<string, string> = {
  rhythm_ping: "rhythm",
  rhythm_list_tasks: "rhythm",
  rhythm_create_task: "rhythm",
  obsidian_get_file: "obsidian",
  obsidian_put_file: "obsidian",
  rhythm_strict: "rhythm",
  rhythm_dialect: "rhythm",
  rhythm_id_a: "rhythm",
  rhythm_id_b: "rhythm",
}

const mcpWithAllTools = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed(freshMockMcpTools()),
    appTools: () => Effect.succeed({}),
    toolClientNames: () => Effect.succeed(MOCK_KEY_TO_SERVER),
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

// ---------------------------------------------------------------------------
// LSP stub (same as prompt.test.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Provider config: same "test" provider as prompt.test.ts
// ---------------------------------------------------------------------------

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

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
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Layer stack — mirrors makeHttp() from prompt.test.ts but uses mcpWithAllTools
// ---------------------------------------------------------------------------

const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))

function makeHttpWithMcpAllTools() {
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
    mcpWithAllTools, // <-- custom MCP that exposes 5 tools
    AppFileSystem.defaultLayer,
    status,
    SyncEvent.defaultLayer,
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

  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
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
      Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
      Layer.provideMerge(deps),
    ),
  ).pipe(Layer.provide(summary))
}

const it = testEffect(makeHttpWithMcpAllTools())

// ---------------------------------------------------------------------------
// Helper: extract MCP tool names from an LLM request body.
//
// The AI SDK sends tools as: { tools: [{type:"function", function:{name: key}}] }
// in the OpenAI-compatible request format. The key IS the composed MCP key
// (e.g. "rhythm_ping") passed as the dict key to streamText({ tools }).
//
// We capture which of those keys are the MCP ones by intersecting with
// MOCK_MCP_TOOLS keys — built-in tools (glob, read, bash, etc.) are excluded.
// This is the correct falsification boundary: the tool name set in the request
// body is downstream of resolveTools, so removing the gate changes this set.
// ---------------------------------------------------------------------------

const ALL_MCP_KEYS = new Set(MOCK_MCP_TOOL_KEYS)

function extractMcpToolNames(inputs: Record<string, unknown>[]): string[] {
  // Use the FIRST non-title call (title requests have no tools array usually).
  for (const body of inputs) {
    if (!body || typeof body !== "object") continue
    const rawTools = (body as Record<string, unknown>).tools
    if (!Array.isArray(rawTools) || rawTools.length === 0) continue

    const names: string[] = []
    for (const t of rawTools) {
      if (!t || typeof t !== "object") continue
      // OpenAI chat format: { type: "function", function: { name, ... } }
      const fn = (t as Record<string, unknown>).function
      if (fn && typeof fn === "object") {
        const name = (fn as Record<string, unknown>).name
        if (typeof name === "string" && ALL_MCP_KEYS.has(name)) {
          names.push(name)
        }
      }
      // OpenAI responses format (if applicable): directly { name, ... }
      const directName = (t as Record<string, unknown>).name
      if (typeof directName === "string" && ALL_MCP_KEYS.has(directName)) {
        if (!names.includes(directName)) names.push(directName)
      }
    }

    if (names.length > 0 || rawTools.length > 0) {
      // Found the first substantive call — return the MCP names from it
      return names.sort()
    }
  }
  return []
}

// ---------------------------------------------------------------------------
// Helper to write config, prompt a message, run the loop, and return offered keys
// ---------------------------------------------------------------------------

const useServerConfig = Effect.fn("test.useServerConfig")(function* (
  config: (url: string) => Partial<typeof cfg>,
) {
  const llm = yield* TestLLMServer
  const directory = (yield* TestInstance).directory
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(
    `${directory}/opencode.json`,
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config(llm.url) }),
  )
  return { llm }
})

const addUserMessage = Effect.fn("test.addUserMessage")(function* (sessionID: SessionID, text: string) {
  const sessions = yield* Session.Service
  const msg = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

// ---------------------------------------------------------------------------
// The four E2E cases
// ---------------------------------------------------------------------------

it.instance(
  "Case A (no allowlist) — lazy default offers mcp_dispatch, cataloging all 5 MCP tools",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      // No mcpAllowlist → legacy session still defaults to lazy loading.
      const session = yield* sessions.create({
        title: "Case A — no allowlist",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        // mcpAllowlist intentionally omitted
      })
      yield* llm.text("done")
      yield* addUserMessage(session.id, "hello")

      yield* prompt.loop({ sessionID: session.id })

      const inputs = yield* llm.inputs
      const offeredMcpKeys = extractMcpToolNames(inputs)

      console.log("[Case A] eagerly offered MCP tool keys:", JSON.stringify(offeredMcpKeys))

      expect(offeredMcpKeys).toEqual([])
      const dispatchEntry = findToolEntry(inputs, "mcp_dispatch")
      const fn = dispatchEntry?.function as Record<string, unknown> | undefined
      const description = typeof fn?.description === "string" ? fn.description : ""
      expect(dispatchEntry).toBeDefined()
      for (const key of ALL_MCP_KEYS) expect(description).toContain(key)
    }),
  { git: true, config: cfg },
  10_000,
)

it.instance(
  "Case B (server-level allowlist: rhythm) — lazy default catalogs only the 3 rhythm tools",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const session = yield* sessions.create({
        title: "Case B — server allowlist",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        mcpAllowlist: { servers: ["rhythm"], tools: [] },
      })
      yield* llm.text("done")
      yield* addUserMessage(session.id, "hello")

      yield* prompt.loop({ sessionID: session.id })

      const inputs = yield* llm.inputs
      const offeredMcpKeys = extractMcpToolNames(inputs)

      console.log("[Case B] eagerly offered MCP tool keys:", JSON.stringify(offeredMcpKeys))

      expect(offeredMcpKeys).toEqual([])
      const dispatchEntry = findToolEntry(inputs, "mcp_dispatch")
      const fn = dispatchEntry?.function as Record<string, unknown> | undefined
      const description = typeof fn?.description === "string" ? fn.description : ""
      expect(dispatchEntry).toBeDefined()
      expect(description).toContain("rhythm_create_task")
      expect(description).toContain("rhythm_list_tasks")
      expect(description).toContain("rhythm_ping")
      expect(description).not.toContain("obsidian_get_file")
      expect(description).not.toContain("obsidian_put_file")
    }),
  { git: true, config: cfg },
  10_000,
)

it.instance(
  "Case C (explicit tool allowlist: obsidian_get_file) — lazy default catalogs only that tool",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const session = yield* sessions.create({
        title: "Case C — explicit tool",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        mcpAllowlist: { servers: [], tools: ["obsidian_get_file"] },
      })
      yield* llm.text("done")
      yield* addUserMessage(session.id, "hello")

      yield* prompt.loop({ sessionID: session.id })

      const inputs = yield* llm.inputs
      const offeredMcpKeys = extractMcpToolNames(inputs)

      console.log("[Case C] eagerly offered MCP tool keys:", JSON.stringify(offeredMcpKeys))

      expect(offeredMcpKeys).toEqual([])
      const dispatchEntry = findToolEntry(inputs, "mcp_dispatch")
      const fn = dispatchEntry?.function as Record<string, unknown> | undefined
      const description = typeof fn?.description === "string" ? fn.description : ""
      expect(dispatchEntry).toBeDefined()
      expect(description).toContain("obsidian_get_file")
      expect(description).not.toContain("obsidian_put_file")
      expect(description).not.toContain("rhythm_ping")
      expect(description).not.toContain("rhythm_list_tasks")
      expect(description).not.toContain("rhythm_create_task")
    }),
  { git: true, config: cfg },
  10_000,
)

it.instance(
  "Case D (empty allowlist: no servers, no tools) — lazy default offers only an empty dispatcher",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const session = yield* sessions.create({
        title: "Case D — empty allowlist",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        mcpAllowlist: { servers: [], tools: [] },
      })
      yield* llm.text("done")
      yield* addUserMessage(session.id, "hello")

      yield* prompt.loop({ sessionID: session.id })

      const inputs = yield* llm.inputs
      const offeredMcpKeys = extractMcpToolNames(inputs)

      console.log("[Case D] eagerly offered MCP tool keys:", JSON.stringify(offeredMcpKeys))

      expect(offeredMcpKeys).toEqual([])
      const dispatchEntry = findToolEntry(inputs, "mcp_dispatch")
      const fn = dispatchEntry?.function as Record<string, unknown> | undefined
      const description = typeof fn?.description === "string" ? fn.description : ""
      expect(dispatchEntry).toBeDefined()
      expect(description).toContain("No MCP tools are currently available.")
      for (const key of ALL_MCP_KEYS) {
        expect(description).not.toContain(key)
      }
    }),
  { git: true, config: cfg },
  10_000,
)

// ---------------------------------------------------------------------------
// Helper: find the request-body tool entry by function name (works for both
// AI SDK tool() and dynamicTool() shapes, which serialize identically).
// ---------------------------------------------------------------------------

function findToolEntry(inputs: Record<string, unknown>[], name: string): Record<string, unknown> | undefined {
  for (const body of inputs) {
    if (!body || typeof body !== "object") continue
    const rawTools = (body as Record<string, unknown>).tools
    if (!Array.isArray(rawTools) || rawTools.length === 0) continue
    for (const t of rawTools) {
      if (!t || typeof t !== "object") continue
      const fn = (t as Record<string, unknown>).function
      if (fn && typeof fn === "object" && (fn as Record<string, unknown>).name === name) {
        return t as Record<string, unknown>
      }
    }
  }
  return undefined
}

function firstToolsBody(inputs: Record<string, unknown>[]): Record<string, unknown> | undefined {
  for (const body of inputs) {
    if (!body || typeof body !== "object") continue
    const rawTools = (body as Record<string, unknown>).tools
    if (Array.isArray(rawTools) && rawTools.length > 0) return body as Record<string, unknown>
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Case E (issue #843, tokens-03): deferred mode — names-only catalog + ONE
// dispatcher tool schema, NOT one schema per MCP tool.
//
// Falsifiable the same way as Cases A-D: if the deferred branch in
// resolveTools (session/prompt.ts) were removed or bypassed, the individual
// rhythm_*/obsidian_* function names would appear directly in the request
// body's tools array (like Case B) instead of being folded into mcp_dispatch's
// description, and this test would fail.
// ---------------------------------------------------------------------------

it.instance(
  "Case E (deferred mode, server-level allowlist: rhythm) — only mcp_dispatch is offered, individual rhythm_* schemas are NOT",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const session = yield* sessions.create({
        title: "Case E — deferred mode",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        mcpAllowlist: { servers: ["rhythm"], tools: [], deferred: true },
      })
      yield* llm.text("done")
      yield* addUserMessage(session.id, "hello")

      yield* prompt.loop({ sessionID: session.id })

      const inputs = yield* llm.inputs
      const body = firstToolsBody(inputs)
      const rawTools = (body?.tools ?? []) as Record<string, unknown>[]
      const offeredNames = rawTools
        .map((t) => {
          const fn = (t as Record<string, unknown>).function
          return fn && typeof fn === "object" ? (fn as Record<string, unknown>).name : undefined
        })
        .filter((n): n is string => typeof n === "string")

      console.log("[Case E] offered tool names:", JSON.stringify(offeredNames))

      // The dispatcher IS offered...
      expect(offeredNames).toContain("mcp_dispatch")
      // ...but NONE of the individual MCP tool schemas are — this is the
      // token-surface win #843 exists to deliver.
      expect(offeredNames).not.toContain("rhythm_ping")
      expect(offeredNames).not.toContain("rhythm_list_tasks")
      expect(offeredNames).not.toContain("rhythm_create_task")
      expect(offeredNames).not.toContain("obsidian_get_file")
      expect(offeredNames).not.toContain("obsidian_put_file")

      // The names-only catalog (name + description) IS present in the
      // dispatcher's own description — that's where the "cheap" metadata
      // lives instead of in per-tool schemas.
      const dispatchEntry = findToolEntry(inputs, "mcp_dispatch")
      const fn = dispatchEntry?.function as Record<string, unknown> | undefined
      const description = typeof fn?.description === "string" ? fn.description : ""
      expect(description).toContain("rhythm_ping")
      expect(description).toContain("rhythm_list_tasks")
      expect(description).toContain("rhythm_create_task")
      // And obsidian tools (out of the server-level allowlist) must be absent
      // from the catalog too — deferred mode must not silently widen scope.
      expect(description).not.toContain("obsidian_get_file")
      expect(description).not.toContain("obsidian_put_file")
    }),
  { git: true, config: cfg },
  10_000,
)

// ---------------------------------------------------------------------------
// Case G (issue #843, tokens-03): "first use loads the schema" — dispatching
// mcp_dispatch({name:"rhythm_ping"}) actually invokes rhythm_ping's real
// execute() and returns its real output, proving the deferred path isn't
// just a smaller catalog but a genuinely working call-through.
//
// Falsifiable: if mcp_dispatch's execute looked up the wrong tool, swallowed
// the call, or returned a stub instead of calling wrapMcpTool + the real MCP
// tool's execute, the completed tool part's output would not contain the
// mock tool's real output "rhythm ping" (MOCK_MCP_TOOLS' description doubles
// as its identifiable executed marker is NOT used here — execute() always
// returns the literal string "ok" per makeMockTool, which this test asserts).
// ---------------------------------------------------------------------------

type CompletedToolPart = MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted }

it.instance(
  "Case G (deferred mode) — dispatching mcp_dispatch({name:'rhythm_ping'}) executes the real rhythm_ping tool",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const session = yield* sessions.create({
        title: "Case G — deferred dispatch executes real tool",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        mcpAllowlist: { servers: ["rhythm"], tools: [], deferred: true },
      })

      yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "ping rhythm" }],
      })
      yield* llm.tool("mcp_dispatch", { name: "rhythm_ping", arguments: {} })
      yield* llm.text("done")

      const result = yield* prompt.loop({ sessionID: session.id })
      expect(result.info.role).toBe("assistant")

      const msgs = yield* MessageV2.filterCompactedEffect(session.id)
      const dispatchPart = msgs
        .flatMap((msg) => msg.parts)
        .find(
          (part): part is CompletedToolPart =>
            part.type === "tool" && part.tool === "mcp_dispatch" && part.state.status === "completed",
        )

      expect(dispatchPart).toBeDefined()
      // makeMockTool's execute() always returns the literal text "ok" — this
      // proves the REAL rhythm_ping.execute ran, not a stub/no-op.
      expect(dispatchPart?.state.output).toContain("ok")

      // Regression caught: wrapMcpTool flattened CallToolResult to text and
      // silently discarded the standard MCP result fields before the session
      // part could be persisted. The assertion fails unless the real execute
      // path retains the additive, JSON-safe result envelope.
      expect(dispatchPart?.state).toMatchObject({
        mcpResult: {
          structuredContent: { kind: "issue-1342-contract", count: 2 },
          _meta: { source: "mock-mcp-server", nested: { retained: true } },
          isError: false,
        },
      })
    }),
  { git: true, config: cfg },
  10_000,
)

// ---------------------------------------------------------------------------
// Case I (F1): the selected tool is JSON-schema-only (no validate hook). describe
// returns its exact schema; malformed execute arguments never reach the
// underlying execute; the valid call executes exactly once.
// ---------------------------------------------------------------------------

it.instance(
  "Case I (deferred mode) — JSON-schema-only arguments are enforced before execution; valid call runs once",
  () =>
    Effect.gen(function* () {
      strictExecutions = 0
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const session = yield* sessions.create({
        title: "Case I — schema enforcement",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        mcpAllowlist: { servers: ["rhythm"], tools: [], deferred: true },
      })
      yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "use rhythm_strict" }],
      })
      const dispatch = (args: Record<string, unknown>) => llm.tool("mcp_dispatch", { name: "rhythm_strict", ...args })
      yield* llm.tool("mcp_dispatch", { action: "search", query: "strict" })
      yield* dispatch({ action: "describe" })
      yield* dispatch({ action: "execute", arguments: {} })
      yield* dispatch({ action: "execute", arguments: { payload: 1 } })
      yield* dispatch({ action: "execute", arguments: { payload: "x", extra: true } })
      yield* dispatch({ action: "execute", arguments: { payload: "x", nested: { n: "no" } } })
      yield* dispatch({ action: "execute", arguments: { payload: "x", nested: { n: 2 } } })
      yield* llm.text("done")

      yield* prompt.loop({ sessionID: session.id })

      const parts = (yield* MessageV2.filterCompactedEffect(session.id))
        .flatMap((msg) => msg.parts)
        .filter((part): part is MessageV2.ToolPart => part.type === "tool" && part.tool === "mcp_dispatch")
      expect(parts.map((part) => part.state.status)).toEqual([
        "completed",
        "completed",
        "error",
        "error",
        "error",
        "error",
        "completed",
      ])
      expect((parts[0].state as MessageV2.ToolStateCompleted).output).toContain("rhythm_strict")
      const describe = parts[1].state as MessageV2.ToolStateCompleted
      expect(describe.output).toContain('"required":["payload"]')
      expect(describe.output).toContain('"additionalProperties":false')
      expect(strictExecutions).toBe(1)
      expect((parts[6].state as MessageV2.ToolStateCompleted).output).toContain("strict-ok")
    }),
  { git: true, config: cfg },
  20_000,
)

// Hosted builtins: with the default (no allowlist) only mcp_dispatch is offered;
// builtins are discovered, described and executed through family="builtin" using
// the original wrapped executors, with current permission/eligibility applied.
it.instance(
  "Case K (lazy default) — hosted builtins are deferred behind mcp_dispatch family=builtin",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const directory = (yield* TestInstance).directory
      const fs = yield* AppFileSystem.Service
      yield* fs.writeWithDirs(`${directory}/hello.txt`, "hello-lazy-read")
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const session = yield* sessions.create({
        title: "Case K — builtins",
        // bash is denied for this session; everything else is allowed.
        permission: [
          { permission: "*", pattern: "*", action: "allow" },
          { permission: "bash", pattern: "*", action: "deny" },
        ],
      })
      yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "use builtins lazily" }],
      })
      const b = (args: Record<string, unknown>) => llm.tool("mcp_dispatch", { family: "builtin", ...args })
      yield* b({ action: "search", query: "read" })
      yield* b({ action: "describe", name: "read" })
      yield* b({ action: "execute", name: "read", arguments: {} })
      yield* b({ action: "execute", name: "read", arguments: { filePath: `${directory}/hello.txt` } })
      yield* b({ action: "describe", name: "bash" })
      yield* b({ action: "execute", name: "bash", arguments: { command: "echo denied", description: "x" } })
      yield* b({ action: "execute", name: "no_such_builtin", arguments: {} })
      yield* llm.tool("mcp_dispatch", { action: "execute", name: "read", arguments: { filePath: `${directory}/hello.txt` } })
      yield* llm.text("done")

      yield* prompt.loop({ sessionID: session.id })

      const inputs = yield* llm.inputs
      const offered = ((inputs.find((body) => Array.isArray((body as { tools?: unknown }).tools)) as { tools: unknown[] })
        .tools as { function?: { name?: string } }[]).map((t) => t.function?.name)
      expect(offered).toEqual(["mcp_dispatch"])
      const description = String(
        (findToolEntry(inputs, "mcp_dispatch")?.function as Record<string, unknown> | undefined)?.description,
      )
      expect(description).toContain("<builtin_tools")
      expect(description).toContain("read")
      expect(description).not.toContain("bash")

      const parts = (yield* MessageV2.filterCompactedEffect(session.id))
        .flatMap((msg) => msg.parts)
        .filter((part): part is MessageV2.ToolPart => part.type === "tool" && part.tool === "mcp_dispatch")
      expect(parts.map((part) => part.state.status)).toEqual([
        "completed", // search
        "completed", // describe read
        "error", // read with {} fails original Schema decode
        "completed", // read executes
        "error", // bash denied: not discoverable
        "error", // bash denied: not executable
        "error", // unknown builtin
        "error", // legacy mcp family cannot reach a builtin id
      ])
      const search = (parts[0].state as MessageV2.ToolStateCompleted).output
      expect(search).toContain('"family":"builtin"')
      expect(search).not.toContain('"name":"bash"')
      expect((parts[1].state as MessageV2.ToolStateCompleted).output).toContain("filePath")
      const read = parts[3].state as MessageV2.ToolStateCompleted
      expect(read.output).toContain("hello-lazy-read")
      // Native outer part keeps the dispatcher input, not the underlying args.
      expect(read.input).toMatchObject({ family: "builtin", name: "read" })
    }),
  { git: true, config: cfg },
  30_000,
)

// Revocation during an awaited tool.execute.before plugin hook: authority must be
// read at the underlying ask (after the hook), not captured before the await.
it.instance(
  "Case L (deferred builtin) — path denial installed while tool.execute.before is awaiting blocks the read",
  () =>
    Effect.gen(function* () {
      const g = globalThis as unknown as { __lazyBefore?: { entered: boolean; gate: Promise<void> } }
      let release!: () => void
      g.__lazyBefore = { entered: false, gate: new Promise<void>((done) => (release = done)) }
      const { llm } = yield* useServerConfig(providerCfg)
      const directory = (yield* TestInstance).directory
      const fs = yield* AppFileSystem.Service
      yield* fs.writeWithDirs(`${directory}/secret.txt`, "SYNTHETIC_HOOK_REVOKED")
      yield* fs.writeWithDirs(
        `${directory}/.opencode/plugin/before-gate.ts`,
        [
          "export default {",
          '  id: "demo.before-gate",',
          "  server: async () => ({",
          '    "tool.execute.before": async () => {',
          "      const state = (globalThis as any).__lazyBefore",
          "      state.entered = true",
          "      await state.gate",
          "    },",
          "  }),",
          "}",
        ].join("\n"),
      )
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service
      const session = yield* sessions.create({
        title: "Case L",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "read secret" }],
      })
      yield* llm.tool("mcp_dispatch", {
        family: "builtin",
        action: "execute",
        name: "read",
        arguments: { filePath: `${directory}/secret.txt` },
      })
      yield* llm.text("done")
      const fiber = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)
      for (let attempt = 0; attempt < 300 && !g.__lazyBefore.entered; attempt++) yield* Effect.sleep("10 millis")
      expect(g.__lazyBefore.entered).toBe(true)
      yield* sessions.setPermission({
        sessionID: session.id,
        permission: [
          { permission: "*", pattern: "*", action: "allow" },
          { permission: "read", pattern: "secret.txt", action: "deny" },
        ],
      })
      release()
      yield* Fiber.join(fiber)

      const part = (yield* MessageV2.filterCompactedEffect(session.id))
        .flatMap((msg) => msg.parts)
        .find((p): p is MessageV2.ToolPart => p.type === "tool" && p.tool === "mcp_dispatch")
      expect(part?.state.status).toBe("error")
      expect(JSON.stringify(part?.state)).not.toContain("SYNTHETIC_HOOK_REVOKED")
    }),
  { git: true, config: cfg },
  30_000,
)

// F1 dialect/$id: declared 2020-12 prefixItems is refused (not silently ignored)
// with zero effects; two tools sharing one $id each validate against their OWN schema.
it.instance(
  "Case J (deferred mode) — unsupported 2020-12 keywords are refused; shared $id never reuses another schema",
  () =>
    Effect.gen(function* () {
      for (const key of ["rhythm_dialect", "rhythm_id_a", "rhythm_id_b"]) counted[key] = 0
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const session = yield* sessions.create({
        title: "Case J — dialect and $id",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        mcpAllowlist: { servers: ["rhythm"], tools: [], deferred: true },
      })
      yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "dialect and id" }],
      })
      const exec = (name: string, args: Record<string, unknown>) =>
        llm.tool("mcp_dispatch", { action: "execute", name, arguments: args })
      yield* exec("rhythm_dialect", { value: ["wrong"] })
      yield* exec("rhythm_id_a", { a: "ok" })
      yield* exec("rhythm_id_b", { b: 1 })
      yield* exec("rhythm_id_a", { b: 1 })
      yield* exec("rhythm_id_b", { a: "ok" })
      yield* llm.text("done")

      yield* prompt.loop({ sessionID: session.id })

      const parts = (yield* MessageV2.filterCompactedEffect(session.id))
        .flatMap((msg) => msg.parts)
        .filter((part): part is MessageV2.ToolPart => part.type === "tool" && part.tool === "mcp_dispatch")
      expect(parts.map((part) => part.state.status)).toEqual(["error", "completed", "completed", "error", "error"])
      expect(counted.rhythm_dialect).toBe(0)
      expect(counted.rhythm_id_a).toBe(1)
      expect(counted.rhythm_id_b).toBe(1)
    }),
  { git: true, config: cfg },
  20_000,
)

// ---------------------------------------------------------------------------
// Case H (issue #843, tokens-03 / #765-class regression guard): dispatching
// an out-of-scope tool name is REJECTED at execute time, not just excluded
// from the catalog — defense in depth mirroring tool/skill.ts's execute-time
// isSkillAllowed guard (#775). Falsified in this run by temporarily removing
// the isDeferredMcpToolAllowed check in session/prompt.ts's mcp_dispatch
// execute() (confirmed this test fails without it), then restoring it.
// ---------------------------------------------------------------------------

it.instance(
  "Case H (deferred mode) — dispatching an out-of-scope tool name (obsidian_get_file, allowlist=rhythm only) throws and does NOT execute",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const session = yield* sessions.create({
        title: "Case H — dispatch-time guard rejects out-of-scope tool",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        mcpAllowlist: { servers: ["rhythm"], tools: [], deferred: true },
      })

      yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "read an obsidian file" }],
      })
      yield* llm.tool("mcp_dispatch", { name: "obsidian_get_file", arguments: {} })
      yield* llm.text("done")

      const result = yield* prompt.loop({ sessionID: session.id })
      expect(result.info.role).toBe("assistant")

      const msgs = yield* MessageV2.filterCompactedEffect(session.id)
      const dispatchPart = msgs
        .flatMap((msg) => msg.parts)
        .find((part) => part.type === "tool" && part.tool === "mcp_dispatch")

      expect(dispatchPart).toBeDefined()
      // Must NOT be a "completed" state carrying real obsidian output — either
      // an error state, or completed output describing the rejection. Either
      // way, the literal mock output "ok" (which makeMockTool's obsidian_get_file
      // execute would return if it actually ran) must never appear.
      const asAny = dispatchPart as { state?: { status?: string; output?: unknown; error?: unknown } }
      if (asAny.state?.status === "completed") {
        expect(String(asAny.state.output)).not.toBe("ok")
        expect(String(asAny.state.output)).toContain("not permitted")
      } else {
        expect(asAny.state?.status).toBe("error")
      }
    }),
  { git: true, config: cfg },
  10_000,
)

it.instance(
  "Case F (deferred mode, empty allowlist) — mcp_dispatch catalog is empty, dispatch of any name is rejected",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const session = yield* sessions.create({
        title: "Case F — deferred mode, empty allowlist",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        mcpAllowlist: { servers: [], tools: [], deferred: true },
      })
      yield* llm.text("done")
      yield* addUserMessage(session.id, "hello")

      yield* prompt.loop({ sessionID: session.id })

      const inputs = yield* llm.inputs
      const dispatchEntry = findToolEntry(inputs, "mcp_dispatch")
      const fn = dispatchEntry?.function as Record<string, unknown> | undefined
      const description = typeof fn?.description === "string" ? fn.description : ""

      console.log("[Case F] dispatch description:", description)

      expect(description).toContain("No MCP tools are currently available.")
      for (const key of ALL_MCP_KEYS) {
        expect(description).not.toContain(key)
      }
    }),
  { git: true, config: cfg },
  10_000,
)
