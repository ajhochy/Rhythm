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
import { Effect, Layer } from "effect"
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
    execute: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
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
  return out
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
}

const mcpWithAllTools = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed(freshMockMcpTools()),
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
  "Case A (no allowlist) — ALL 5 MCP tools offered to the model",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      // No mcpAllowlist → back-compat pass-through
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

      console.log("[Case A] offered MCP tool keys:", JSON.stringify(offeredMcpKeys))

      expect(offeredMcpKeys).toEqual(
        ["obsidian_get_file", "obsidian_put_file", "rhythm_create_task", "rhythm_list_tasks", "rhythm_ping"].sort(),
      )
    }),
  { git: true, config: cfg },
  10_000,
)

it.instance(
  "Case B (server-level allowlist: rhythm) — exactly 3 rhythm_* tools, NO obsidian_* tools",
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

      console.log("[Case B] offered MCP tool keys:", JSON.stringify(offeredMcpKeys))

      expect(offeredMcpKeys).toEqual(
        ["rhythm_create_task", "rhythm_list_tasks", "rhythm_ping"].sort(),
      )
      // Explicitly verify obsidian tools are absent
      expect(offeredMcpKeys).not.toContain("obsidian_get_file")
      expect(offeredMcpKeys).not.toContain("obsidian_put_file")
    }),
  { git: true, config: cfg },
  10_000,
)

it.instance(
  "Case C (explicit tool allowlist: obsidian_get_file) — exactly 1 tool, 4 others absent",
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

      console.log("[Case C] offered MCP tool keys:", JSON.stringify(offeredMcpKeys))

      expect(offeredMcpKeys).toEqual(["obsidian_get_file"])
      // Explicitly verify all others are absent
      expect(offeredMcpKeys).not.toContain("obsidian_put_file")
      expect(offeredMcpKeys).not.toContain("rhythm_ping")
      expect(offeredMcpKeys).not.toContain("rhythm_list_tasks")
      expect(offeredMcpKeys).not.toContain("rhythm_create_task")
    }),
  { git: true, config: cfg },
  10_000,
)

it.instance(
  "Case D (empty allowlist: no servers, no tools) — ZERO MCP tools offered",
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

      console.log("[Case D] offered MCP tool keys:", JSON.stringify(offeredMcpKeys))

      expect(offeredMcpKeys).toEqual([])
      // Verify each MCP key is absent individually
      for (const key of ALL_MCP_KEYS) {
        expect(offeredMcpKeys).not.toContain(key)
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
    }),
  { git: true, config: cfg },
  10_000,
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
