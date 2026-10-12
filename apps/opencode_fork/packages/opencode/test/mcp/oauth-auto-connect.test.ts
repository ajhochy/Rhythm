import { expect, mock, beforeEach } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { testEffect } from "../lib/effect"

// Mock UnauthorizedError to match the SDK's class
class MockUnauthorizedError extends Error {
  constructor(message?: string) {
    super(message ?? "Unauthorized")
    this.name = "UnauthorizedError"
  }
}

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown }
}> = []
const streamableFinishers: Array<{ finishAuth: (code: string) => Promise<void> }> = []

// Controls whether the mock transport simulates a 401 that triggers the SDK
// auth flow (which calls provider.state()) or a simple UnauthorizedError.
let simulateAuthFlow = true
let connectSucceedsImmediately = false
let genericFailure = false
let genericFailureAfterOAuthSetup = false
let finishAuthSavesTokens = false
let holdFinish = false
let resolveFinish: (() => void) | undefined
let closeCount = 0

// Mock the transport constructors to simulate OAuth auto-auth on 401
void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    authProvider:
      | {
          state?: () => Promise<string>
          redirectToAuthorization?: (url: URL) => Promise<void>
          saveCodeVerifier?: (v: string) => Promise<void>
          saveTokens?: (tokens: { access_token: string; token_type: string }) => Promise<void>
        }
      | undefined
    constructor(url: URL, options?: { authProvider?: unknown }) {
      this.authProvider = options?.authProvider as typeof this.authProvider
      streamableFinishers.push(this)
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async close() {
      closeCount++
    }
    async start() {
      if (genericFailureAfterOAuthSetup && this.authProvider) {
        await this.authProvider.state?.()
        await this.authProvider.saveCodeVerifier?.("synthetic-failed-verifier")
        throw new Error("synthetic connection failure after setup")
      }
      if (genericFailure) throw new Error("synthetic connection failure")
      if (connectSucceedsImmediately) return

      // Simulate what the real SDK transport does on 401:
      // It calls auth() which eventually calls provider.state(), then
      // provider.redirectToAuthorization(), then throws UnauthorizedError.
      if (simulateAuthFlow && this.authProvider) {
        // The SDK calls provider.state() to get the OAuth state parameter
        if (this.authProvider.state) {
          await this.authProvider.state()
        }
        // The SDK calls saveCodeVerifier before redirecting
        if (this.authProvider.saveCodeVerifier) {
          await this.authProvider.saveCodeVerifier("test-verifier")
        }
        // The SDK calls redirectToAuthorization to redirect the user
        if (this.authProvider.redirectToAuthorization) {
          await this.authProvider.redirectToAuthorization(new URL("https://auth.example.com/authorize?state=test"))
        }
        throw new MockUnauthorizedError()
      }
      throw new MockUnauthorizedError()
    }
    async finishAuth(_code: string) {
      if (holdFinish) await new Promise<void>((resolve) => (resolveFinish = resolve))
      if (finishAuthSavesTokens) {
        await this.authProvider?.saveTokens?.({ access_token: "finished-flow-token", token_type: "Bearer" })
      }
    }
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL, options?: { authProvider?: unknown }) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async close() {
      closeCount++
    }
    async start() {
      if (genericFailure) throw new Error("synthetic connection failure")
      throw new Error("Mock SSE transport cannot connect")
    }
  },
}))

// Mock the MCP SDK Client
void mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(transport: { start: () => Promise<void> }) {
      await transport.start()
    }

    getServerCapabilities() {
      return {}
    }

    setNotificationHandler() {}

    async listTools() {
      return { tools: [{ name: "test_tool", inputSchema: { type: "object", properties: {} } }] }
    }

    async close() {}
  },
}))

// Mock UnauthorizedError in the auth module so instanceof checks work
void mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

beforeEach(() => {
  transportCalls.length = 0
  streamableFinishers.length = 0
  simulateAuthFlow = true
  connectSucceedsImmediately = false
  genericFailure = false
  genericFailureAfterOAuthSetup = false
  finishAuthSavesTokens = false
  holdFinish = false
  resolveFinish = undefined
  closeCount = 0
})

// Import modules after mocking
const { MCP } = await import("../../src/mcp/index")
const { Bus } = await import("../../src/bus")
const { Config } = await import("../../src/config/config")
const { McpAuth } = await import("../../src/mcp/auth")
const { McpOAuthProvider } = await import("../../src/mcp/oauth-provider")
const { AppFileSystem } = await import("@opencode-ai/core/filesystem")
const { CrossSpawnSpawner } = await import("@opencode-ai/core/cross-spawn-spawner")

const mcpTest = testEffect(
  Layer.mergeAll(
    MCP.layer.pipe(
      Layer.provide(McpAuth.defaultLayer),
      Layer.provideMerge(Bus.layer),
      Layer.provide(Config.defaultLayer),
      Layer.provide(CrossSpawnSpawner.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
    ),
    McpAuth.defaultLayer,
  ),
)

const config = (name: string) => ({
  mcp: {
    [name]: {
      type: "remote" as const,
      url: "https://example.com/mcp",
    },
  },
})

mcpTest.instance(
  "first connect to OAuth server shows needs_auth instead of failed",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const result = yield* mcp.add("test-oauth", {
          type: "remote",
          url: "https://example.com/mcp",
        })

        const serverStatus = result.status as Record<string, { status: string; error?: string }>

        // The server should be detected as needing auth, NOT as failed.
        // Before the fix, provider.state() would throw a plain Error
        // ("No OAuth state saved for MCP server: test-oauth") which was
        // not caught as UnauthorizedError, causing status to be "failed".
        expect(serverStatus["test-oauth"]).toBeDefined()
        expect(serverStatus["test-oauth"].status).toBe("needs_auth")
      }),
    ),
  { config: config("test-oauth") },
)

mcpTest.instance("state() generates a new state when none is saved", () =>
  Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const provider = new McpOAuthProvider(
      "test-state-gen",
      "https://example.com/mcp",
      {},
      { onRedirect: async () => {} },
      auth,
    )

    const entryBefore = yield* McpAuth.Service.use((auth) => auth.get("test-state-gen"))
    expect(entryBefore?.oauthState).toBeUndefined()

    // state() should generate and return a new state, not throw
    const state = yield* Effect.promise(() => provider.state())
    expect(typeof state).toBe("string")
    expect(state.length).toBe(64) // 32 bytes as hex

    // The generated state should be persisted
    const entryAfter = yield* McpAuth.Service.use((auth) => auth.get("test-state-gen"))
    expect(entryAfter?.oauthState).toBe(state)
  }),
)

mcpTest.instance("state() returns existing state when one is saved", () =>
  Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const provider = new McpOAuthProvider(
      "test-state-existing",
      "https://example.com/mcp",
      {},
      { onRedirect: async () => {} },
      auth,
    )

    // Pre-save a state
    const existingState = "pre-saved-state-value"
    yield* McpAuth.Service.use((auth) => auth.updateOAuthState("test-state-existing", existingState))

    // state() should return the existing state
    const state = yield* Effect.promise(() => provider.state())
    expect(state).toBe(existingState)
  }),
)

mcpTest.instance(
  "authenticate() stores a connected client when auth completes without redirect",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const added = yield* mcp.add("test-oauth-connect", {
          type: "remote",
          url: "https://example.com/mcp",
        })
        const before = added.status as Record<string, { status: string; error?: string }>
        expect(before["test-oauth-connect"]?.status).toBe("needs_auth")

        simulateAuthFlow = false
        connectSucceedsImmediately = true

        const result = yield* mcp.authenticate("test-oauth-connect")
        expect(result.status).toBe("connected")

        const after = yield* mcp.status()
        expect(after["test-oauth-connect"]?.status).toBe("connected")
      }),
    ),
  { config: config("test-oauth-connect") },
)

mcpTest.instance(
  "automatic OAuth providers cannot persist into a replacement flow with the same owner",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const name = "automatic-oauth-stale-provider"
        yield* mcp.add(name, { type: "remote", url: "https://example.com/mcp" })
        const oldProvider = transportCalls.find((call) => call.type === "streamable")?.options.authProvider as {
          saveTokens: (tokens: { access_token: string; token_type: string }) => Promise<void>
        }
        expect(oldProvider).toBeDefined()

        yield* mcp.removeAuth(name)
        yield* mcp.add(name, { type: "remote", url: "https://example.com/mcp" })

        const staleWrite = yield* Effect.tryPromise({
          try: () => oldProvider.saveTokens({ access_token: "synthetic-stale-token", token_type: "Bearer" }),
          catch: (error) => error,
        }).pipe(Effect.exit)
        const auth = yield* McpAuth.Service
        const entry = yield* auth.get(name)

        expect(staleWrite._tag).toBe("Failure")
        expect(entry?.tokens?.accessToken).not.toBe("synthetic-stale-token")
      }),
    ),
  { config: config("automatic-oauth-stale-provider") },
)

mcpTest.instance(
  "automatic OAuth generic failures close every attempted transport",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        genericFailure = true
        const name = "automatic-oauth-network-failure"
        const result = yield* mcp.add(name, { type: "remote", url: "https://example.com/mcp" })

        expect((result.status as Record<string, { status: string }>)[name]?.status).toBe("failed")
        expect(closeCount).toBe(2)
      }),
    ),
  { config: config("automatic-oauth-network-failure") },
)

mcpTest.instance(
  "automatic OAuth generic failure clears only its own ephemeral state and verifier",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        genericFailure = true
        genericFailureAfterOAuthSetup = true
        const name = "automatic-oauth-ephemera"
        const auth = yield* McpAuth.Service
        yield* auth.updateTokens(name, { accessToken: "retained-token" })

        yield* mcp.add(name, { type: "remote", url: "https://example.com/mcp" })
        const entry = yield* auth.get(name)

        expect(entry?.tokens?.accessToken).toBe("retained-token")
        expect(entry?.oauthState).toBeUndefined()
        expect(entry?.codeVerifier).toBeUndefined()
      }),
    ),
  { config: config("automatic-oauth-ephemera") },
)

mcpTest.instance(
  "automatic OAuth finishing accepts token persistence only for its exact pending record",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const name = "automatic-oauth-finishing-owner"
        finishAuthSavesTokens = true
        yield* mcp.add(name, { type: "remote", url: "https://example.com/mcp" })

        yield* mcp.finishAuth(name, "synthetic-code")
        const auth = yield* McpAuth.Service
        const entry = yield* auth.get(name)
        expect(entry?.tokens?.accessToken).toBe("finished-flow-token")
      }),
    ),
  { config: config("automatic-oauth-finishing-owner") },
)

mcpTest.instance(
  "a stale automatic OAuth finishing transport cannot persist after replacement",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const name = "automatic-oauth-finishing-stale"
        finishAuthSavesTokens = true
        yield* mcp.add(name, { type: "remote", url: "https://example.com/mcp" })
        const oldTransport = streamableFinishers[0]!
        yield* mcp.removeAuth(name)
        yield* mcp.add(name, { type: "remote", url: "https://example.com/mcp" })

        const staleCompletion = yield* Effect.tryPromise({
          try: () => oldTransport.finishAuth("synthetic-old-code"),
          catch: (error) => error,
        }).pipe(Effect.exit)
        const auth = yield* McpAuth.Service
        const entry = yield* auth.get(name)

        expect(staleCompletion._tag).toBe("Failure")
        expect(entry?.tokens?.accessToken).not.toBe("finished-flow-token")
      }),
    ),
  { config: config("automatic-oauth-finishing-stale") },
)

mcpTest.instance(
  "late OAuth completion preserves a replacement flow's verifier and state",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const name = "automatic-oauth-late-completion"
        yield* mcp.add(name, { type: "remote", url: "https://example.com/mcp" })
        holdFinish = true
        const oldCompletion = yield* mcp.finishAuth(name, "synthetic-code").pipe(Effect.forkScoped)
        for (let attempt = 0; attempt < 20 && !resolveFinish; attempt++) yield* Effect.sleep("10 millis")
        expect(resolveFinish).toBeDefined()

        yield* mcp.removeAuth(name)
        yield* mcp.add(name, { type: "remote", url: "https://example.com/mcp" })
        const newProvider = transportCalls.filter((call) => call.type === "streamable").at(-1)?.options.authProvider as {
          saveCodeVerifier: (codeVerifier: string) => Promise<void>
        }
        yield* Effect.promise(() => newProvider.saveCodeVerifier("synthetic-new-flow-verifier"))

        resolveFinish!()
        const oldResult = yield* Fiber.join(oldCompletion)
        const auth = yield* McpAuth.Service
        const entry = yield* auth.get(name)

        expect(oldResult.status).toBe("failed")
        expect(entry?.codeVerifier).toBe("synthetic-new-flow-verifier")
        expect(entry?.oauthState).toBeDefined()
      }),
    ),
  { config: config("automatic-oauth-late-completion") },
)
