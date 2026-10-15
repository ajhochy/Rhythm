// Sol-owned verification; existing request-level fixture layer reused from mcp_allowlist_e2e.test.ts.

import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { expect, test } from "bun:test"
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
import { TestLLMServer, reply } from "../lib/llm-server"
import { validateDeferredMcpArguments } from "../../src/session/mcp_deferred_tools"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Ripgrep } from "../../src/file/ripgrep"
import { Format } from "../../src/format"
import * as Database from "../../src/storage/db"

void Log.init({ print: false })

// Mock MCP: 5 tools across 2 servers
//
// Servers:  "rhythm"   → tools: ping, list_tasks, create_task
//           "obsidian" → tools: get_file, put_file
//
// Composed keys used as dict keys (and as the names the LLM sees):
//   rhythm_ping, rhythm_list_tasks, rhythm_create_task
//   obsidian_get_file, obsidian_put_file

const modernRefSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { value: { $ref: "#/$defs/base", type: "object", required: ["must"] } },
  required: ["value"],
  $defs: { base: { type: "object" } },
}
function freshMockMcpTools(): Record<string, ReturnType<typeof dynamicTool>> {
  return { rhythm_modern: makeCountedTool("rhythm_modern", modernRefSchema) }
}

const counted: Record<string, number> = {}
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

const MOCK_KEY_TO_SERVER: Record<string, string> = { rhythm_modern: "rhythm" }

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

// LSP stub (same as prompt.test.ts)

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

// Provider config: same "test" provider as prompt.test.ts

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

// Existing layer stack from mcp_allowlist_e2e.test.ts; one counted tool fixture.

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
    mcpWithAllTools,
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

const dispatchParts = Effect.fn("sol.dispatchParts")(function* (sessionID: SessionID) {
  return (yield* MessageV2.filterCompactedEffect(sessionID)).flatMap((message) => message.parts)
    .filter((part): part is MessageV2.ToolPart => part.type === "tool" && part.tool === "mcp_dispatch")
})

test("Sol dialect: actual validator enforces ref siblings on invalid 2020 data", () => {
  expect(validateDeferredMcpArguments(modernRefSchema, { value: {} })).toBeDefined()
  expect(validateDeferredMcpArguments(modernRefSchema, { value: "wrong" })).toBeDefined()
})

it.instance("Sol dialect: declared 2020 ref-sibling fixture accepts valid data only as current behavior", () =>
  Effect.gen(function* () {
    counted.rhythm_modern = 0
    const { llm } = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({ permission: [{ permission: "*", pattern: "*", action: "allow" }] })
    yield* prompt.prompt({ sessionID: session.id, agent: "build", noReply: true, parts: [{ type: "text", text: "Check declared dialect" }] })
    yield* llm.tool("mcp_dispatch", { action: "execute", name: "rhythm_modern", arguments: { value: { must: true } } })
    yield* llm.text("done")
    yield* prompt.loop({ sessionID: session.id })
    expect(counted.rhythm_modern).toBe(1)
    expect((yield* dispatchParts(session.id))[0].state.status).toBe("completed")
  }), { git: true, config: cfg }, 20_000)

it.instance("Sol revoked path: current eligible read cannot use captured allow after revocation", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const directory = (yield* TestInstance).directory
    const fs = yield* AppFileSystem.Service
    yield* fs.writeWithDirs(`${directory}/secret.txt`, "SYNTHETIC_REVOKED_CONTENT")
    const session = yield* sessions.create({ permission: [{ permission: "*", pattern: "*", action: "allow" }] })
    yield* prompt.prompt({ sessionID: session.id, agent: "build", noReply: true, parts: [{ type: "text", text: "Read a fixture" }] })
    let release!: () => void
    const held = new Promise<void>((done) => { release = done })
    yield* llm.push(reply().wait(held).tool("mcp_dispatch", { family: "builtin", action: "execute", name: "read", arguments: { filePath: `${directory}/secret.txt` } }))
    yield* llm.text("done")
    const fiber = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    const currentRules = [
      { permission: "*", pattern: "*", action: "allow" as const },
      { permission: "read", pattern: "secret.txt", action: "deny" as const },
    ]
    // A path-specific denial does not remove the whole read tool.
    expect(Permission.disabled(["read"], currentRules).has("read")).toBe(false)
    yield* sessions.setPermission({ sessionID: session.id, permission: currentRules })
    release()
    yield* Fiber.join(fiber)
    const part = (yield* dispatchParts(session.id))[0]
    if (part.state.status === "completed") expect(part.state.output).not.toContain("SYNTHETIC_REVOKED_CONTENT")
    expect(part.state.status).toBe("error")
  }), { git: true, config: cfg }, 20_000)

it.instance("Sol ask: deferred read remains pending until exact outer permission is answered", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const directory = (yield* TestInstance).directory
    const fs = yield* AppFileSystem.Service
    yield* fs.writeWithDirs(`${directory}/ask.txt`, "SYNTHETIC_ASK_RESULT")
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const permission = yield* Permission.Service
    const session = yield* sessions.create({ permission: [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "read", pattern: "ask.txt", action: "ask" },
    ] })
    yield* prompt.prompt({ sessionID: session.id, agent: "build", noReply: true, parts: [{ type: "text", text: "Ask fixture" }] })
    yield* llm.tool("mcp_dispatch", { family: "builtin", action: "execute", name: "read", arguments: { filePath: `${directory}/ask.txt` } })
    yield* llm.text("done")
    const fiber = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)
    for (let attempt = 0; attempt < 100; attempt++) {
      const requests = yield* permission.list()
      if (requests.length) break
      yield* Effect.sleep("10 millis")
    }
    const requests = yield* permission.list()
    expect(requests).toHaveLength(1)
    const part = (yield* dispatchParts(session.id))[0]
    expect(part.state.status).toBe("running")
    expect(requests[0].tool?.callID).toBe(part.callID)
    expect(requests[0].tool?.messageID).toBe(part.messageID)
    yield* permission.reply({ requestID: requests[0].id, sessionID: session.id, reply: "once" })
    yield* Fiber.join(fiber)
    const completed = (yield* dispatchParts(session.id))[0]
    expect(completed.state.status).toBe("completed")
    if (completed.state.status === "completed") expect(completed.state.output).toContain("SYNTHETIC_ASK_RESULT")
  }), { git: true, config: cfg }, 20_000)

it.instance("Sol question: deferred question preserves exact outer identity and answer lifecycle", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const question = yield* Question.Service
    const session = yield* sessions.create({ permission: [{ permission: "*", pattern: "*", action: "allow" }] })
    yield* prompt.prompt({ sessionID: session.id, agent: "build", noReply: true, parts: [{ type: "text", text: "Question fixture" }] })
    yield* llm.tool("mcp_dispatch", { family: "builtin", action: "execute", name: "question", arguments: { questions: [{ question: "Select fixture", header: "Fixture", options: [{ label: "A", description: "Fixture A" }, { label: "B", description: "Fixture B" }] }] } })
    yield* llm.text("done")
    const fiber = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((yield* question.list()).length) break
      yield* Effect.sleep("10 millis")
    }
    const requests = yield* question.list()
    expect(requests).toHaveLength(1)
    const part = (yield* dispatchParts(session.id))[0]
    expect(part.state.status).toBe("running")
    expect(requests[0].tool?.callID).toBe(part.callID)
    yield* question.reply({ requestID: requests[0].id, answers: [["A"]] })
    yield* Fiber.join(fiber)
    const completed = (yield* dispatchParts(session.id))[0]
    expect(completed.state.status).toBe("completed")
    if (completed.state.status === "completed") expect(completed.state.output).toContain('"Select fixture"="A"')
  }), { git: true, config: cfg }, 20_000)

it.instance("Sol user disable: deferred read cannot bypass per-message tools false", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const directory = (yield* TestInstance).directory
    const session = yield* sessions.create({ permission: [{ permission: "*", pattern: "*", action: "allow" }] })
    yield* prompt.prompt({ sessionID: session.id, agent: "build", tools: { read: false }, noReply: true, parts: [{ type: "text", text: "Disabled fixture" }] })
    yield* llm.tool("mcp_dispatch", { family: "builtin", action: "describe", name: "read" })
    yield* llm.tool("mcp_dispatch", { family: "builtin", action: "execute", name: "read", arguments: { filePath: `${directory}/absent.txt` } })
    yield* llm.text("done")
    yield* prompt.loop({ sessionID: session.id })
    expect((yield* dispatchParts(session.id)).map((part) => part.state.status)).toEqual(["error", "error"])
  }), { git: true, config: cfg }, 20_000)

it.instance("Sol task: deferred task uses actual child lifecycle and outer metadata", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({ permission: [{ permission: "*", pattern: "*", action: "allow" }] })
    yield* prompt.prompt({ sessionID: session.id, agent: "build", noReply: true, parts: [{ type: "text", text: "Task fixture" }] })
    yield* llm.tool("mcp_dispatch", { family: "builtin", action: "execute", name: "task", arguments: { description: "Fixture child", prompt: "Return synthetic result", subagent_type: "general" } })
    yield* llm.text("SYNTHETIC_CHILD_RESULT")
    yield* llm.text("root finished")
    yield* prompt.loop({ sessionID: session.id })
    const part = (yield* dispatchParts(session.id))[0]
    expect(part.state.status).toBe("completed")
    if (part.state.status === "completed") {
      expect(part.state.input).toMatchObject({ family: "builtin", name: "task" })
      expect(part.state.output).toContain("SYNTHETIC_CHILD_RESULT")
      expect(part.state.metadata.sessionId).toBeDefined()
      const child = yield* sessions.get(SessionID.make(part.state.metadata.sessionId as string))
      expect(child.parentID).toBe(session.id)
    }
  }), { git: true, config: cfg }, 20_000)

for (const apiModel of ["gpt-6", "gpt-4o"]) {
  it.instance(`Sol model selection: ${apiModel} keeps deferred patch versus edit/write inventory`, () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => {
        const base = providerCfg(url)
        return { ...base, provider: { test: { ...base.provider.test, models: { ...base.provider.test.models, [apiModel]: { ...base.provider.test.models["test-model"], id: apiModel } } } } }
      })
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service
      const session = yield* sessions.create({ permission: [{ permission: "*", pattern: "*", action: "allow" }] })
      yield* prompt.prompt({ sessionID: session.id, model: { providerID: ProviderID.make("test"), modelID: ModelID.make(apiModel) }, agent: "build", noReply: true, parts: [{ type: "text", text: "Inventory fixture" }] })
      for (const name of ["apply_patch", "edit", "write"]) yield* llm.tool("mcp_dispatch", { family: "builtin", action: "describe", name })
      yield* llm.text("done")
      yield* prompt.loop({ sessionID: session.id })
      const parts = yield* dispatchParts(session.id)
      expect(parts.map((part) => part.state.status)).toEqual(apiModel === "gpt-6" ? ["completed", "error", "error"] : ["error", "completed", "completed"])
      const request = (yield* llm.inputs).find((body) => Array.isArray(body.tools))
      const names = (request?.tools as { function: { name: string } }[]).map((tool) => tool.function.name)
      expect(names).not.toContain("apply_patch")
      expect(names).not.toContain("edit")
      expect(names).not.toContain("write")
    }), { git: true, config: cfg }, 20_000)
}

it.instance("Sol StructuredOutput: conditional direct schema is required by actual json-schema loop", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({ permission: [{ permission: "*", pattern: "*", action: "allow" }] })
    yield* prompt.prompt({ sessionID: session.id, agent: "build", noReply: true, format: { type: "json_schema", schema: { type: "object", properties: { fixture: { type: "string" } }, required: ["fixture"] }, retryCount: 0 }, parts: [{ type: "text", text: "Structured fixture" }] })
    yield* llm.tool("StructuredOutput", { fixture: "synthetic" })
    const result = yield* prompt.loop({ sessionID: session.id })
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") expect(result.info.structured).toEqual({ fixture: "synthetic" })
    const request = (yield* llm.inputs).find((body) => Array.isArray(body.tools))
    expect(request?.tool_choice).toBe("required")
    expect((request?.tools as { function: { name: string } }[]).map((tool) => tool.function.name)).toContain("StructuredOutput")
  }), { git: true, config: cfg }, 20_000)

it.instance("Sol legacy default gap: selective MCP field alone must not leave read eager", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({ permission: [{ permission: "*", pattern: "*", action: "allow" }], mcpAllowlist: { servers: ["rhythm"], tools: [], deferredServers: ["rhythm"] } })
    yield* prompt.prompt({ sessionID: session.id, agent: "build", noReply: true, parts: [{ type: "text", text: "Legacy default fixture" }] })
    yield* llm.text("done")
    yield* prompt.loop({ sessionID: session.id })
    const request = (yield* llm.inputs).find((body) => Array.isArray(body.tools))
    const names = (request?.tools as { function: { name: string } }[]).map((tool) => tool.function.name)
    expect(names).toContain("mcp_dispatch")
    expect(names).not.toContain("read")
  }), { git: true, config: cfg }, 20_000)
