import { beforeEach, expect, mock } from "bun:test"
import { Effect } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"
import { testEffect } from "../lib/effect"

const UI_EXTENSION = "io.modelcontextprotocol/ui"
const UI_MIME_TYPE = "text/html;profile=mcp-app"

type ToolFixture = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

interface MockClientState {
  tools: ToolFixture[]
  listToolsShouldFail: boolean
  listToolsError: string
  requestCalls: number
  serverCapabilities: Record<string, unknown>
  notificationHandlers: Map<unknown, (...args: any[]) => any>
}

const clientStates = new Map<string, MockClientState>()
const createdClientOptions: unknown[] = []
let lastCreatedClientName: string | undefined

function getOrCreateClientState(name: string): MockClientState {
  let state = clientStates.get(name)
  if (!state) {
    state = {
      tools: [],
      listToolsShouldFail: false,
      listToolsError: "listTools failed",
      requestCalls: 0,
      serverCapabilities: {},
      notificationHandlers: new Map(),
    }
    clientStates.set(name, state)
  }
  return state
}

class MockTransport {
  stderr: null = null
  pid = 12345
  // oxlint-disable-next-line no-useless-constructor
  constructor(..._args: unknown[]) {}
  async start() {}
  async close() {}
  async finishAuth() {}
}

void mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockTransport,
}))
void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockTransport,
}))
void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: MockTransport,
}))
void mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: class extends Error {},
}))

void mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    state!: MockClientState
    transport: unknown

    constructor(_clientInfo: unknown, options?: unknown) {
      createdClientOptions.push(options)
    }

    async connect(transport: { start: () => Promise<void> }) {
      this.transport = transport
      await transport.start()
      this.state = getOrCreateClientState(lastCreatedClientName ?? "default")
    }

    getServerCapabilities() {
      return this.state.serverCapabilities
    }

    setNotificationHandler(schema: unknown, handler: (...args: any[]) => any) {
      this.state?.notificationHandlers.set(schema, handler)
    }

    async listTools() {
      if (this.state.listToolsShouldFail) throw new Error(this.state.listToolsError)
      return { tools: this.state.tools }
    }

    async request(request: { method: string }, schema: { parse: (value: unknown) => unknown }) {
      this.state.requestCalls++
      if (request.method !== "tools/list") throw new Error(`unsupported request: ${request.method}`)
      return schema.parse({ tools: this.state.tools })
    }

    async listPrompts() {
      return { prompts: [] }
    }

    async listResources() {
      return { resources: [] }
    }

    async close() {}
  },
}))

beforeEach(() => {
  clientStates.clear()
  createdClientOptions.length = 0
  lastCreatedClientName = undefined
  process.env.RHYTHM_MCP_APPS_MODE = "off"
})

const { MCP } = await import("../../src/mcp/index")
const it = testEffect(MCP.defaultLayer)

const supportedServerCapabilities = {
  extensions: {
    [UI_EXTENSION]: { mimeTypes: [UI_MIME_TYPE] },
  },
}

function uiTool(name: string, uri: string, visibility: unknown = ["model", "app"]): ToolFixture {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
    _meta: {
      ui: {
        resourceUri: uri,
        visibility,
      },
    },
  }
}

type AppRegistrySurface = {
  appTools?: () => Effect.Effect<unknown>
}

function appTools(mcp: MCPNS.Interface): Effect.Effect<unknown> {
  const getter = (mcp as MCPNS.Interface & AppRegistrySurface).appTools
  // Regression caught: discovery caches descriptors only inside model tools,
  // leaving the host with no app registry after model-schema filtering.
  expect(getter).toBeFunction()
  return getter!()
}

const localConfig = { type: "local" as const, command: ["echo", "contract"] }

it.instance(
  "issue-1352-c1: validated UI descriptors survive normal and tolerant tool discovery",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        process.env.RHYTHM_MCP_APPS_MODE = "readonly"

        lastCreatedClientName = "normal-ui"
        const normal = getOrCreateClientState("normal-ui")
        normal.serverCapabilities = supportedServerCapabilities
        normal.tools = [uiTool("normal_dashboard", "ui://normal/dashboard")]
        yield* mcp.add("normal-ui", localConfig)

        lastCreatedClientName = "tolerant-ui"
        const tolerant = getOrCreateClientState("tolerant-ui")
        tolerant.serverCapabilities = supportedServerCapabilities
        tolerant.listToolsShouldFail = true
        tolerant.listToolsError = "can't resolve reference #/$defs/ScreenInstance from id # outputSchema"
        tolerant.tools = [
          {
            ...uiTool("tolerant_dashboard", "ui://tolerant/dashboard"),
            outputSchema: {
              type: "object",
              properties: { screen: { $ref: "#/$defs/ScreenInstance" } },
            },
          },
        ]
        yield* mcp.add("tolerant-ui", localConfig)

        const registry = JSON.stringify(yield* appTools(mcp))
        expect(registry).toContain("ui://normal/dashboard")
        expect(registry).toContain("ui://tolerant/dashboard")
        expect(tolerant.requestCalls).toBe(1)
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "issue-1352-c2: io.modelcontextprotocol/ui is advertised only when MCP Apps mode is enabled",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        process.env.RHYTHM_MCP_APPS_MODE = "readonly"
        lastCreatedClientName = "enabled"
        getOrCreateClientState("enabled")
        yield* mcp.add("enabled", localConfig)
        const enabledOptions = createdClientOptions.at(-1) as Record<string, any> | undefined
        expect(enabledOptions?.capabilities?.extensions?.[UI_EXTENSION]).toEqual({ mimeTypes: [UI_MIME_TYPE] })

        process.env.RHYTHM_MCP_APPS_MODE = "off"
        lastCreatedClientName = "disabled"
        getOrCreateClientState("disabled")
        yield* mcp.add("disabled", localConfig)
        const disabledOptions = createdClientOptions.at(-1) as Record<string, any> | undefined
        expect(disabledOptions?.capabilities?.extensions?.[UI_EXTENSION]).toBeUndefined()
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "issue-1352-c3: app-only tools stay in the app registry and never enter model schemas",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        process.env.RHYTHM_MCP_APPS_MODE = "readonly"
        lastCreatedClientName = "supported"
        const state = getOrCreateClientState("supported")
        state.serverCapabilities = supportedServerCapabilities
        state.tools = [
          uiTool("model_and_app", "ui://supported/main"),
          uiTool("refresh_private", "ui://supported/main", ["app"]),
        ]
        yield* mcp.add("supported", localConfig)

        const modelTools = yield* mcp.tools()
        expect(Object.keys(modelTools)).toContain("supported_model_and_app")
        expect(Object.keys(modelTools)).not.toContain("supported_refresh_private")
        expect(JSON.stringify(yield* appTools(mcp))).toContain("refresh_private")
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "issue-1352-c4: unsupported MCP peers retain legacy model-tool behavior",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        process.env.RHYTHM_MCP_APPS_MODE = "readonly"
        lastCreatedClientName = "legacy-peer"
        const state = getOrCreateClientState("legacy-peer")
        state.serverCapabilities = {}
        state.tools = [uiTool("legacy_refresh", "ui://legacy/dashboard", ["app"])]
        yield* mcp.add("legacy-peer", localConfig)

        const modelTools = yield* mcp.tools()
        expect(Object.keys(modelTools)).toContain("legacy-peer_legacy_refresh")
        expect(JSON.stringify(yield* appTools(mcp))).not.toContain("legacy_refresh")
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "issue-1352-c5: malformed or unknown UI visibility is excluded from every grant surface",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        process.env.RHYTHM_MCP_APPS_MODE = "readonly"
        lastCreatedClientName = "ambiguous"
        const state = getOrCreateClientState("ambiguous")
        state.serverCapabilities = supportedServerCapabilities
        state.tools = [
          uiTool("unknown_visibility", "ui://ambiguous/unknown", ["app", "administrator"]),
          uiTool("wrong_shape", "ui://ambiguous/wrong-shape", "app"),
          uiTool("empty_visibility", "ui://ambiguous/empty", []),
        ]
        yield* mcp.add("ambiguous", localConfig)

        const modelKeys = Object.keys(yield* mcp.tools())
        expect(modelKeys).not.toContain("ambiguous_unknown_visibility")
        expect(modelKeys).not.toContain("ambiguous_wrong_shape")
        expect(modelKeys).not.toContain("ambiguous_empty_visibility")
        const registry = JSON.stringify(yield* appTools(mcp))
        expect(registry).not.toContain("unknown_visibility")
        expect(registry).not.toContain("wrong_shape")
        expect(registry).not.toContain("empty_visibility")
      }),
    ),
  { config: { mcp: {} } },
)
