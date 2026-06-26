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

const MOCK_MCP_TOOLS: Record<string, ReturnType<typeof dynamicTool>> = {
  rhythm_ping: makeMockTool("rhythm ping"),
  rhythm_list_tasks: makeMockTool("rhythm list tasks"),
  rhythm_create_task: makeMockTool("rhythm create task"),
  obsidian_get_file: makeMockTool("obsidian get file"),
  obsidian_put_file: makeMockTool("obsidian put file"),
}

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
    tools: () => Effect.succeed(MOCK_MCP_TOOLS),
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

const ALL_MCP_KEYS = new Set(Object.keys(MOCK_MCP_TOOLS))

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
