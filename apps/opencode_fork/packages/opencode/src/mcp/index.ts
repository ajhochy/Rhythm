import { dynamicTool, type Tool, jsonSchema, type JSONSchema7, type ToolExecutionOptions } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  InitializeResultSchema,
  ListToolsResultSchema,
  ServerCapabilitiesSchema,
  ToolSchema,
  type Tool as MCPToolDef,
  type ClientRequest,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type { AnySchema, SchemaOutput } from "@modelcontextprotocol/sdk/server/zod-compat.js"
import { z } from "zod/v4"
import { Config } from "@/config/config"
import { ConfigMCP } from "../config/mcp"
import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import { Installation } from "../installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { withTimeout } from "@/util/timeout"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import open from "open"
import { Effect, Exit, Layer, Option, Context, Schema, Stream } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { signRhythmMcpCall, type RhythmMcpCallIdentity } from "@/security/rhythm-mcp-proof"
import { createHash } from "node:crypto"

const log = Log.create({ service: "mcp" })
const DEFAULT_TIMEOUT = 30_000
// Rhythm carried patch (mcp-list-bound): prompts/resources listing feeds the
// per-directory Command state and the /command route. One unresponsive server
// used to hold them for the SDK's 60s request default, so a cold directory
// (e.g. a phone opening a new project) waited a minute. Cap each server's list.
const LIST_TIMEOUT = 5_000
const MCP_UI_EXTENSION = "io.modelcontextprotocol/ui"
const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"

// SDK 1.27.1 validates initialize responses with a capability schema that
// strips extension keys. Keep the SDK's normal validation everywhere else and
// admit only the bounded MCP Apps capability that we advertise.
const AppInitializeResultSchema = InitializeResultSchema.extend({
  capabilities: ServerCapabilitiesSchema.extend({
    extensions: z
      .object({
        [MCP_UI_EXTENSION]: z.object({ mimeTypes: z.array(z.string().max(200)).max(8) }).optional(),
      })
      .optional(),
  }),
})

function createAppAwareClient() {
  // Resolve the SDK constructor only when connecting. This retains the normal
  // SDK constructor seam (including test transports) while narrowing only its
  // initialize result schema.
  const BaseClient = Client
  class AppAwareClient extends BaseClient {
    override request<T extends AnySchema>(
      request: ClientRequest,
      resultSchema: T,
      options?: RequestOptions,
    ): Promise<SchemaOutput<T>> {
      const schema = request.method === "initialize" ? AppInitializeResultSchema : resultSchema
      return super.request(request, schema, options) as Promise<SchemaOutput<T>>
    }
  }
  return new AppAwareClient(
    { name: "opencode", version: InstallationVersion },
    mcpAppsClientOptions() as ConstructorParameters<typeof Client>[1],
  )
}

type McpAppsMode = "off" | "readonly" | "interactive"

function mcpAppsMode(): McpAppsMode {
  const value = process.env.RHYTHM_MCP_APPS_MODE
  if (value === "readonly" || value === "interactive") return value
  return "off"
}

function mcpAppsClientOptions() {
  if (mcpAppsMode() === "off") return undefined
  return {
    capabilities: {
      extensions: {
        [MCP_UI_EXTENSION]: { mimeTypes: [MCP_APP_MIME_TYPE] },
      },
    },
  }
}

function supportsMcpApps(client: MCPClient) {
  const capabilities = client.getServerCapabilities() as Record<string, unknown> | undefined
  const extensions = capabilities?.extensions
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) return false
  const extension = (extensions as Record<string, unknown>)[MCP_UI_EXTENSION]
  if (!extension || typeof extension !== "object" || Array.isArray(extension)) return false
  const mimeTypes = (extension as Record<string, unknown>).mimeTypes
  return Array.isArray(mimeTypes) && mimeTypes.includes(MCP_APP_MIME_TYPE)
}

type McpAppVisibility = "model" | "app"

export interface McpAppTool extends MCPToolDef {
  client: string
  ui: {
    resourceUri: string
    visibility: McpAppVisibility[]
  }
}

type UiDescriptorResult =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; resourceUri: string; visibility: McpAppVisibility[] }

function uiDescriptor(tool: MCPToolDef): UiDescriptorResult {
  const meta = tool._meta
  if (!meta || typeof meta !== "object" || Array.isArray(meta) || !("ui" in meta)) return { kind: "none" }
  const ui = meta.ui
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) return { kind: "invalid" }

  const resourceUri = (ui as Record<string, unknown>).resourceUri
  if (typeof resourceUri !== "string" || resourceUri.length === 0 || resourceUri.trim() !== resourceUri) {
    return { kind: "invalid" }
  }
  try {
    if (new URL(resourceUri).protocol !== "ui:") return { kind: "invalid" }
  } catch {
    return { kind: "invalid" }
  }

  const rawVisibility = (ui as Record<string, unknown>).visibility
  if (rawVisibility === undefined) {
    return { kind: "valid", resourceUri, visibility: ["model", "app"] }
  }
  if (!Array.isArray(rawVisibility) || rawVisibility.length === 0 || rawVisibility.length > 2) {
    return { kind: "invalid" }
  }
  if (!rawVisibility.every((value) => value === "model" || value === "app")) return { kind: "invalid" }
  if (new Set(rawVisibility).size !== rawVisibility.length) return { kind: "invalid" }
  return { kind: "valid", resourceUri, visibility: rawVisibility as McpAppVisibility[] }
}

/** Resolve only already-cached model-visible definitions; never acquires or warms a server. */
export function resolvePassiveMcpToolIdentity(
  input: {
    defs: Record<string, readonly MCPToolDef[] | undefined>
    mcpAppsSupported: Record<string, boolean | undefined>
  },
  toolKey: string,
): { serverName: string; toolName: string } | undefined {
  const matches = Object.entries(input.defs).flatMap(([serverName, listed]) =>
    (listed ?? []).flatMap((mcpTool) => {
      const descriptor = input.mcpAppsSupported[serverName] ? uiDescriptor(mcpTool) : { kind: "none" as const }
      if (descriptor.kind === "invalid") return []
      if (descriptor.kind === "valid" && !descriptor.visibility.includes("model")) return []
      if (sanitize(serverName) + "_" + sanitize(mcpTool.name) !== toolKey) return []
      return [{ serverName, toolName: mcpTool.name }]
    }),
  )
  if (matches.length !== 1) return
  return matches[0]
}

/**
 * Rhythm-only MCP request metadata. The engine adds this after the model has
 * produced tool arguments, so the model cannot forge session/turn identity.
 * The receiving MCP server reads it from RequestHandlerExtra._meta.
 */
export const RHYTHM_SECURITY_CONTEXT_META_KEY = "com.vcrc.rhythm/security-context"

export type RhythmMcpSecurityContext = RhythmMcpCallIdentity

const RHYTHM_SECURITY_CONTEXT = Symbol("rhythm-mcp-security-context")
type RhythmToolExecutionOptions = ToolExecutionOptions & {
  [RHYTHM_SECURITY_CONTEXT]?: RhythmMcpSecurityContext
}

export function withRhythmSecurityContext(
  options: ToolExecutionOptions,
  context: RhythmMcpSecurityContext,
): ToolExecutionOptions {
  return Object.assign({}, options, { [RHYTHM_SECURITY_CONTEXT]: context })
}

export function rhythmSecurityRequestMeta(
  options: ToolExecutionOptions,
  toolName: string,
  args: unknown,
): Record<string, unknown> | undefined {
  const context = (options as RhythmToolExecutionOptions)[RHYTHM_SECURITY_CONTEXT]
  if (!context) return undefined
  return {
    [RHYTHM_SECURITY_CONTEXT_META_KEY]: signRhythmMcpCall(context, toolName, args),
  }
}

function rhythmSecurityContext(options: ToolExecutionOptions) {
  return (options as RhythmToolExecutionOptions)[RHYTHM_SECURITY_CONTEXT]
}

const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

export const Resource = Schema.Struct({
  name: Schema.String,
  uri: Schema.String,
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  client: Schema.String,
}).annotate({ identifier: "McpResource" })
export type Resource = Schema.Schema.Type<typeof Resource>

export const ToolsChanged = BusEvent.define(
  "mcp.tools.changed",
  Schema.Struct({
    server: Schema.String,
  }),
)

/**
 * A directory-local MCP transport acquired or refreshed metadata. Consumers
 * such as `/command` can refresh their passive catalog without connecting an
 * otherwise unselected server.
 */
export const MetadataChanged = BusEvent.define(
  "mcp.metadata.changed",
  Schema.Struct({
    server: Schema.String,
  }),
)

export const BrowserOpenFailed = BusEvent.define(
  "mcp.browser.open.failed",
  Schema.Struct({
    mcpName: Schema.String,
    url: Schema.String,
  }),
)

export const Failed = NamedError.create("MCPFailed", {
  name: Schema.String,
})

type MCPClient = Client

const StatusConnected = Schema.Struct({ status: Schema.Literal("connected") }).annotate({
  identifier: "MCPStatusConnected",
})
const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "MCPStatusDisabled",
})
const StatusConfigured = Schema.Struct({ status: Schema.Literal("configured") }).annotate({
  identifier: "MCPStatusConfigured",
})
const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "MCPStatusFailed",
})
const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "MCPStatusNeedsAuth",
})
const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "MCPStatusNeedsClientRegistration" })

export const Status = Schema.Union([
  StatusConnected,
  StatusDisabled,
  StatusConfigured,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration,
]).annotate({ identifier: "MCPStatus", discriminator: "status" })
export type Status = Schema.Schema.Type<typeof Status>

// Store transports for OAuth servers to allow finishing auth
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
type PendingOAuthTransport = {
  owner?: object
  transport: TransportWithAuth
  directory: string
  configFingerprint?: string
  state?: string
  codeVerifier?: string
  authorizationUrl?: string
  deadline: number
  phase: "waiting" | "finishing"
  timer?: ReturnType<typeof setTimeout>
}
const pendingOAuthTransports = new Map<string, PendingOAuthTransport>()
const OAUTH_PENDING_MS = 5 * 60 * 1000

function oauthConfigFingerprint(mcp: ConfigMCP.Info & { type: "remote" }) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        type: mcp.type,
        url: mcp.url,
        oauth: mcp.oauth,
        headers: Object.fromEntries(Object.entries(mcp.headers ?? {}).sort(([a], [b]) => a.localeCompare(b))),
      }),
    )
    .digest("base64url")
}

function registerPendingOAuth(
  name: string,
  transport: TransportWithAuth,
  directory: string,
  input?: Pick<PendingOAuthTransport, "owner" | "configFingerprint" | "state" | "authorizationUrl">,
) {
  const existing = pendingOAuthTransports.get(name)
  if (existing && existing.deadline > Date.now()) return undefined
  if (existing) {
    if (existing.timer) clearTimeout(existing.timer)
    void existing.transport.close().catch(() => {})
  }
  const pending: PendingOAuthTransport = {
    transport,
    directory,
    deadline: Date.now() + OAUTH_PENDING_MS,
    phase: "waiting",
    ...input,
  }
  pending.timer = setTimeout(() => {
    if (pendingOAuthTransports.get(name) !== pending) return
    pendingOAuthTransports.delete(name)
    if (pending.state) McpOAuthCallback.cancelState(pending.state)
    void pending.transport.close().catch(() => {})
  }, OAUTH_PENDING_MS)
  pendingOAuthTransports.set(name, pending)
  return pending
}

// Prompt cache types
type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
type McpEntry = NonNullable<Config.Info["mcp"]>[string]

function isMcpConfigured(entry: McpEntry): entry is ConfigMCP.Info {
  return typeof entry === "object" && entry !== null && "type" in entry
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

function remoteURL(key: string, value: string) {
  if (URL.canParse(value)) return new URL(value)
  log.warn("invalid remote mcp url", { key })
}

function isOutputSchemaValidationError(error: Error) {
  return /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
    error.message,
  )
}

function listTools(key: string, client: MCPClient, timeout: number) {
  return Effect.tryPromise({
    try: () => client.listTools(undefined, { timeout }),
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  }).pipe(
    Effect.map((result) => result.tools),
    Effect.catch((error) => {
      if (!isOutputSchemaValidationError(error)) return Effect.fail(error)

      log.warn("failed to validate MCP tool output schemas, retrying without output schema validation", { key, error })
      return Effect.tryPromise({
        try: () =>
          client.request({ method: "tools/list" }, TolerantListToolsResultSchema, {
            timeout,
          }),
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      }).pipe(Effect.map((result) => result.tools.map((tool) => ({ ...tool }))))
    }),
  )
}

// Convert MCP tool definition to AI SDK Tool type
function convertMcpTool(
  mcpTool: MCPToolDef,
  client: MCPClient,
  timeout?: number,
  execute?: (args: unknown, options: ToolExecutionOptions) => Promise<Awaited<ReturnType<MCPClient["callTool"]>>>,
): Tool {
  const inputSchema = mcpTool.inputSchema

  // Spread first, then override type to ensure it's always "object"
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: "object",
    properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }

  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown, options: ToolExecutionOptions) => {
      if (execute) return execute(args, options)
      const securityMeta = rhythmSecurityRequestMeta(options, mcpTool.name, args)
      return client.callTool(
        {
          name: mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>,
          ...(securityMeta && { _meta: securityMeta }),
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          timeout,
        },
      )
    },
  })
}

function defs(key: string, client: MCPClient, timeout?: number) {
  return listTools(key, client, timeout ?? DEFAULT_TIMEOUT).pipe(
    Effect.catch((err) => {
      log.error("failed to get tools from client", { key, error: err })
      return Effect.succeed(undefined)
    }),
  )
}

function fetchFromClient<T extends { name: string }>(
  clientName: string,
  client: Client,
  listFn: (c: Client) => Promise<T[]>,
  label: string,
) {
  return Effect.tryPromise({
    try: () => listFn(client),
    catch: (e: any) => {
      log.error(`failed to get ${label}`, { clientName, error: e.message })
      return e
    },
  }).pipe(
    Effect.map((items) => {
      const out: Record<string, T & { client: string }> = {}
      const sanitizedClient = sanitize(clientName)
      for (const item of items) {
        out[sanitizedClient + ":" + sanitize(item.name)] = { ...item, client: clientName }
      }
      return out
    }),
    Effect.orElseSucceed(() => undefined),
  )
}

interface CreateResult {
  mcpClient?: MCPClient
  status: Status
  defs?: MCPToolDef[]
  mcpAppsSupported?: boolean
}

interface AuthResult {
  authorizationUrl: string
  oauthState: string
  client?: MCPClient
}

// --- Effect Service ---

interface State {
  status: Record<string, Status>
  clients: Record<string, MCPClient>
  defs: Record<string, MCPToolDef[]>
  mcpAppsSupported: Record<string, boolean>
  /** One acquisition per directory/server. This is deliberately state-local. */
  acquiring: Record<string, Promise<Status>>
  leases: Record<string, number>
  leaseWaiters: Record<string, Array<() => void>>
  generations: Record<string, number>
  idleTimers: Record<string, ReturnType<typeof setTimeout>>
  appOrigins: Record<
    string,
    {
      server: string
      expiresAt: number
      client: MCPClient
      generation: number
      timer: ReturnType<typeof setTimeout>
      sessionID: string
      messageID: string
      partID: string
      cwd: string
      resourceUri: string
      persisted: boolean
    }
  >
  /** A successful trusted App tool call owns its producing transport until its result is persisted. */
  provisionalAppOrigins: Record<
    string,
    { server: string; client: MCPClient; generation: number; sessionID: string; callID: string }
  >
  bridge: EffectBridge.Shape
  oauthOwner: object
}

export interface ToolSelection {
  servers: string[]
  tools: string[]
}

export interface AppOriginOwner {
  sessionID: string
  callID: string
  serverName: string
  cwd: string
  resourceUri: string
  expiresAt: string
  part: {
    sessionID: string
    messageID: string
    partID: string
  }
}

export type AppOriginProvenance = Omit<AppOriginOwner, "part">

export interface PersistedAppOriginPart {
  sessionID: string
  messageID: string
  partID: string
}

export interface Interface {
  readonly status: () => Effect.Effect<Record<string, Status>>
  readonly clients: () => Effect.Effect<Record<string, MCPClient>>
  /**
   * Acquire only the configured servers selected for a session. An omitted
   * selection retains legacy unrestricted behaviour; an explicit empty
   * selection is deny-all and therefore acquires nothing.
   */
  readonly tools: (selection?: ToolSelection) => Effect.Effect<Record<string, Tool>>
  /** Return cached catalog metadata without acquiring a transport. */
  readonly catalog?: () => Effect.Effect<string[]>
  readonly appTools: () => Effect.Effect<Record<string, McpAppTool>>
  readonly executeAppTool?: (
    key: string,
    args: Record<string, unknown>,
    options: ToolExecutionOptions,
  ) => Effect.Effect<unknown, Error>
  readonly readAppResource?: (
    origin: AppOriginProvenance,
    part: PersistedAppOriginPart,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>>, Error>
  readonly executeAppToolForOrigin?: (
    origin: AppOriginProvenance,
    part: PersistedAppOriginPart,
    key: string,
    args: Record<string, unknown>,
    options: ToolExecutionOptions,
  ) => Effect.Effect<unknown, Error>
  readonly retainAppOrigin?: (origin: AppOriginOwner) => Effect.Effect<boolean>
  readonly releaseAppOrigin?: (sessionID: string, callID: string) => Effect.Effect<void>
  readonly releaseProvisionalAppOrigin?: (sessionID: string, callID: string) => Effect.Effect<void>
  /** Rhythm carried patch (mcp-scope): returns composedKey → raw clientName for every connected tool. */
  readonly toolClientNames: () => Effect.Effect<Record<string, string>>
  /** Resolve one already-cached model-visible composed key without acquiring or warming a server. */
  readonly toolIdentity?: (toolKey: string) => Effect.Effect<{ serverName: string; toolName: string } | undefined>
  readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
  readonly resources: () => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
  readonly add: (name: string, mcp: ConfigMCP.Info) => Effect.Effect<{ status: Record<string, Status> | Status }>
  readonly connect: (name: string) => Effect.Effect<void>
  readonly disconnect: (name: string) => Effect.Effect<void>
  readonly getPrompt: (
    clientName: string,
    name: string,
    args?: Record<string, string>,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["getPrompt"]>> | undefined>
  readonly readResource: (
    clientName: string,
    resourceUri: string,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>> | undefined>
  readonly startAuth: (mcpName: string) => Effect.Effect<{ authorizationUrl: string; oauthState: string }>
  readonly authenticate: (mcpName: string) => Effect.Effect<Status>
  readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect.Effect<Status>
  readonly removeAuth: (mcpName: string) => Effect.Effect<void>
  readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean>
  readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>
  readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MCP") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const auth = yield* McpAuth.Service
    const bus = yield* Bus.Service

    type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

    /**
     * Connect a client via the given transport with resource safety:
     * on failure the transport is closed; on success the caller owns it.
     */
    const connectTransport = (
      transport: Transport,
      timeout: number,
      retainFailure?: (error: unknown) => boolean,
    ) => {
      let retained = false
      return Effect.acquireUseRelease(
        Effect.succeed(transport),
        (t) =>
          Effect.tryPromise({
            try: async () => {
              try {
                const client = createAppAwareClient()
                return await withTimeout(client.connect(t), timeout).then(() => client)
              } catch (error) {
                retained = retainFailure?.(error) ?? false
                throw error
              }
            },
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          }),
        (t, exit) =>
          Exit.isFailure(exit) && !retained ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void,
      )
    }

    const DISABLED_RESULT: CreateResult = { status: { status: "disabled" } }

    const connectRemote = Effect.fn("MCP.connectRemote")(function* (
      key: string,
      mcp: ConfigMCP.Info & { type: "remote" },
      owner?: object,
    ) {
      const directory = yield* InstanceState.directory
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      const url = remoteURL(key, mcp.url)
      if (!url) {
        return {
          client: undefined as MCPClient | undefined,
          status: { status: "failed" as const, error: `Invalid MCP URL for "${key}"` },
        }
      }
      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      const fingerprint = oauthConfigFingerprint(mcp)
      let lastStatus: Status | undefined

      for (const name of ["StreamableHTTP", "SSE"] as const) {
        let capturedPending: PendingOAuthTransport | undefined
        let capturedTransport: TransportWithAuth | undefined
        const isCapturedPending = () => {
          const pending = capturedPending
          return (
            !!pending &&
            pendingOAuthTransports.get(key) === pending &&
            pending.owner === owner &&
            pending.directory === directory &&
            pending.configFingerprint === fingerprint &&
            pending.transport === capturedTransport &&
            pending.deadline > Date.now() &&
            (pending.phase === "waiting" || pending.phase === "finishing")
          )
        }
        const authProvider = oauthDisabled
          ? undefined
          : new McpOAuthProvider(
              key,
              mcp.url,
              {
                clientId: oauthConfig?.clientId,
                clientSecret: oauthConfig?.clientSecret,
                scope: oauthConfig?.scope,
                redirectUri: oauthConfig?.redirectUri,
              },
              {
                onRedirect: async (redirect) => {
                  if (!isCapturedPending()) return
                  log.info("oauth redirect requested", { key, url: redirect.toString() })
                  const pending = capturedPending
                  if (pending) pending.authorizationUrl = redirect.toString()
                },
                canPersist: isCapturedPending,
                onState: (oauthState) => {
                  const pending = capturedPending
                  if (pending && isCapturedPending()) pending.state = oauthState
                },
                onCodeVerifier: (codeVerifier) => {
                  const pending = capturedPending
                  if (pending && isCapturedPending()) pending.codeVerifier = codeVerifier
                },
              },
              auth,
            )
        const transport: TransportWithAuth =
          name === "StreamableHTTP"
            ? new StreamableHTTPClientTransport(url, {
                authProvider,
                requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
              })
            : new SSEClientTransport(url, {
                authProvider,
                requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
              })
        capturedTransport = transport

        if (!oauthDisabled) {
          capturedPending = registerPendingOAuth(key, transport, directory, { owner, configFingerprint: fingerprint })
        }
        if (!oauthDisabled && !capturedPending) {
          yield* Effect.tryPromise(() => transport.close()).pipe(Effect.ignore)
          return {
            client: undefined as MCPClient | undefined,
            status: { status: "failed" as const, error: "Authorization already pending" },
          }
        }
        const pending = capturedPending
        const result = yield* connectTransport(
          transport,
          connectTimeout,
          (error) => {
            const lastError = error instanceof Error ? error : new Error(String(error))
            return (
              (error instanceof UnauthorizedError || (!!authProvider && lastError.message.includes("OAuth"))) &&
              isCapturedPending() &&
              pending?.transport === transport
            )
          },
        ).pipe(
          Effect.map((client) => ({ client, transportName: name })),
          Effect.catch((error) => {
            const lastError = error instanceof Error ? error : new Error(String(error))
            const isAuthError =
              error instanceof UnauthorizedError || (!!authProvider && lastError.message.includes("OAuth"))

            if (isAuthError) {
              log.info("mcp server requires authentication", { key, transport: name })

              if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                lastStatus = {
                  status: "needs_client_registration" as const,
                  error: "Server does not support dynamic client registration. Please provide clientId in config.",
                }
                return bus
                  .publish(TuiEvent.ToastShow, {
                    title: "MCP Authentication Required",
                    message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                    variant: "warning",
                    duration: 8000,
                  })
                  .pipe(Effect.ignore, Effect.as(undefined))
              } else {
                lastStatus = { status: "needs_auth" as const }
                return bus
                  .publish(TuiEvent.ToastShow, {
                    title: "MCP Authentication Required",
                    message: `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`,
                    variant: "warning",
                    duration: 8000,
                  })
                  .pipe(Effect.ignore, Effect.as(undefined))
              }
            }

            const cleanupEphemera = pending
              ? Effect.sync(() => {
                  if (pendingOAuthTransports.get(key) !== pending) return false
                  pendingOAuthTransports.delete(key)
                  if (pending.timer) clearTimeout(pending.timer)
                  if (pending.state) McpOAuthCallback.cancelState(pending.state)
                  return true
                }).pipe(
                  Effect.flatMap((isCurrent) =>
                    isCurrent
                      ? auth.clearOAuthEphemeraIfMatches(key, {
                          oauthState: pending.state,
                          codeVerifier: pending.codeVerifier,
                        })
                      : Effect.void,
                  ),
                )
              : Effect.void
            log.debug("transport connection failed", {
              key,
              transport: name,
              url: mcp.url,
              error: lastError.message,
            })
            lastStatus = { status: "failed" as const, error: lastError.message }
            return cleanupEphemera.pipe(Effect.as(undefined))
          }),
        )
        if (result) {
          if (pending && pendingOAuthTransports.get(key) === pending) {
            pendingOAuthTransports.delete(key)
            if (pending.timer) clearTimeout(pending.timer)
          }
          log.info("connected", { key, transport: result.transportName })
          return { client: result.client as MCPClient | undefined, status: { status: "connected" } as Status }
        }
        // If this was an auth error, stop trying other transports
        if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
      }

      return {
        client: undefined as MCPClient | undefined,
        status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
      }
    })

    const connectLocal = Effect.fn("MCP.connectLocal")(function* (
      key: string,
      mcp: ConfigMCP.Info & { type: "local" },
    ) {
      const [cmd, ...args] = mcp.command
      const cwd = yield* InstanceState.directory
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...process.env,
          ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
          ...mcp.environment,
        },
      })
      transport.stderr?.on("data", (chunk: Buffer) => {
        log.info(`mcp stderr: ${chunk.toString()}`, { key })
      })

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      return yield* connectTransport(transport, connectTimeout).pipe(
        Effect.map((client): { client: MCPClient | undefined; status: Status } => ({
          client,
          status: { status: "connected" },
        })),
        Effect.catch((error): Effect.Effect<{ client: MCPClient | undefined; status: Status }> => {
          const msg = error instanceof Error ? error.message : String(error)
          log.error("local mcp startup failed", { key, command: mcp.command, cwd, error: msg })
          return Effect.succeed({ client: undefined, status: { status: "failed", error: msg } })
        }),
      )
    })

    const create = Effect.fn("MCP.create")(function* (key: string, mcp: ConfigMCP.Info, owner?: object) {
      if (mcp.enabled === false) {
        log.info("mcp server disabled", { key })
        return DISABLED_RESULT
      }

      log.info("found", { key, type: mcp.type })

      const { client: mcpClient, status } =
        mcp.type === "remote"
          ? yield* connectRemote(key, mcp as ConfigMCP.Info & { type: "remote" }, owner)
          : yield* connectLocal(key, mcp as ConfigMCP.Info & { type: "local" })

      if (!mcpClient) {
        return { status } satisfies CreateResult
      }

      const listed = yield* defs(key, mcpClient, mcp.timeout)
      if (!listed) {
        yield* Effect.tryPromise(() => mcpClient.close()).pipe(Effect.ignore)
        return { status: { status: "failed", error: "Failed to get tools" } } satisfies CreateResult
      }

      log.info("create() successfully created client", { key, toolCount: listed.length })
      return {
        mcpClient,
        status,
        defs: listed,
        mcpAppsSupported: mcpAppsMode() !== "off" && supportsMcpApps(mcpClient),
      } satisfies CreateResult
    })
    const cfgSvc = yield* Config.Service

    const descendants = Effect.fnUntraced(
      function* (pid: number) {
        if (process.platform === "win32") return [] as number[]
        const pids: number[] = []
        const queue = [pid]
        while (queue.length > 0) {
          const current = queue.shift()!
          const handle = yield* spawner.spawn(ChildProcess.make("pgrep", ["-P", String(current)], { stdin: "ignore" }))
          const text = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          yield* handle.exitCode
          for (const tok of text.split("\n")) {
            const cpid = parseInt(tok, 10)
            if (!isNaN(cpid) && !pids.includes(cpid)) {
              pids.push(cpid)
              queue.push(cpid)
            }
          }
        }
        return pids
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed([] as number[])),
    )

    function watch(s: State, name: string, client: MCPClient, bridge: EffectBridge.Shape, timeout?: number) {
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        log.info("tools list changed notification received", { server: name })
        if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

        const listed = await bridge.promise(defs(name, client, timeout))
        if (!listed) return
        if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

        s.defs[name] = listed
        await bridge.promise(bus.publish(ToolsChanged, { server: name }).pipe(Effect.ignore))
      })
    }

    const state = yield* InstanceState.make<State>(
      Effect.fn("MCP.state")(function* () {
        const cfg = yield* cfgSvc.get()
        const bridge = yield* EffectBridge.make()
        const config = cfg.mcp ?? {}
        const s: State = {
          status: {},
          clients: {},
          defs: {},
          mcpAppsSupported: {},
          acquiring: {},
          leases: {},
          leaseWaiters: {},
          generations: {},
          idleTimers: {},
          appOrigins: {},
          provisionalAppOrigins: {},
          bridge,
          oauthOwner: {},
        }

        for (const [key, mcp] of Object.entries(config)) {
          if (!isMcpConfigured(mcp)) {
            log.error("Ignoring MCP config entry without type", { key })
            continue
          }
          // Merely constructing directory state must not spawn every configured
          // transport. Discovery and explicit connect acquire clients below.
          s.status[key] = mcp.enabled === false ? { status: "disabled" } : { status: "configured" }
        }

        const unsubscribe = yield* bus.subscribeAllCallback((event) => {
          if (event.type === "message.part.updated") {
            const part = (event.properties as {
              part?: {
                id?: string
                callID?: string
                messageID?: string
                sessionID?: string
                type?: string
                state?: { status?: string; mcpAppResource?: AppOriginOwner }
              }
            }).part
            const sessionID = (event.properties as { sessionID?: string }).sessionID
            if (sessionID && part?.id && part.callID && part.type === "tool") {
              const owner = s.appOrigins[appOriginKey(sessionID, part.callID)]
              if (!owner) return
              if (owner.partID !== part.id || owner.messageID !== part.messageID || part.sessionID !== sessionID) {
                releaseAppOriginOwner(s, appOriginKey(sessionID, part.callID))
                return
              }
              if (part.state?.status === "error") {
                releaseAppOriginOwner(s, appOriginKey(sessionID, part.callID))
                return
              }
              if (part.state?.status !== "completed") return
              if (
                !sameAppOrigin(part.state.mcpAppResource, {
                  sessionID,
                  callID: part.callID,
                  serverName: owner.server,
                  expiresAt: new Date(owner.expiresAt).toISOString(),
                })
              ) {
                releaseAppOriginOwner(s, appOriginKey(sessionID, part.callID))
                return
              }
              owner.persisted = true
            }
            return
          }
          if (event.type === "message.part.removed") {
            const properties = event.properties as { sessionID?: string; messageID?: string; partID?: string }
            for (const [key, owner] of Object.entries(s.appOrigins)) {
              if (
                owner.partID !== properties.partID ||
                owner.messageID !== properties.messageID ||
                owner.sessionID !== properties.sessionID
              )
                continue
              releaseAppOriginOwner(s, key)
            }
            return
          }
          if (event.type === "message.removed") {
            const properties = event.properties as { sessionID?: string; messageID?: string }
            for (const [key, owner] of Object.entries(s.appOrigins)) {
              if (owner.messageID !== properties.messageID || owner.sessionID !== properties.sessionID) continue
              releaseAppOriginOwner(s, key)
            }
            return
          }
          if (event.type !== "session.deleted") return
          const sessionID = (event.properties as { sessionID?: string }).sessionID
          if (!sessionID) return
          for (const [key, owner] of Object.entries(s.appOrigins)) {
            if (owner.sessionID !== sessionID) continue
            releaseAppOriginOwner(s, key)
          }
          for (const [key, owner] of Object.entries(s.provisionalAppOrigins)) {
            if (owner.sessionID !== sessionID) continue
            delete s.provisionalAppOrigins[key]
            if ((s.leases[owner.server] ?? 0) === 0) scheduleIdleClose(s, owner.server, owner.client, owner.generation)
          }
        })

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            unsubscribe()
            for (const [name, pending] of pendingOAuthTransports) {
              if (pending.owner !== s.oauthOwner) continue
              pendingOAuthTransports.delete(name)
              if (pending.timer) clearTimeout(pending.timer)
              if (pending.state) McpOAuthCallback.cancelState(pending.state)
              yield* Effect.tryPromise(() => pending.transport.close()).pipe(Effect.ignore)
            }
            for (const owner of Object.values(s.appOrigins)) clearTimeout(owner.timer)
            s.appOrigins = {}
            s.provisionalAppOrigins = {}
            yield* Effect.forEach(
              Object.values(s.clients),
              (client) =>
                Effect.gen(function* () {
                  const pid = client.transport instanceof StdioClientTransport ? client.transport.pid : null
                  if (typeof pid === "number") {
                    const pids = yield* descendants(pid)
                    for (const dpid of pids) {
                      try {
                        process.kill(dpid, "SIGTERM")
                      } catch {}
                    }
                  }
                  yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
                }),
              { concurrency: "unbounded" },
            )
          }),
        )

        return s
      }),
    )

    function appOriginKey(sessionID: string, callID: string) {
      return JSON.stringify([sessionID, callID])
    }

    function sameAppOrigin(
      origin: AppOriginOwner | undefined,
      expected: Pick<AppOriginOwner, "sessionID" | "callID" | "serverName" | "expiresAt">,
    ) {
      return !!origin && Object.entries(expected).every(([key, value]) => origin[key as keyof AppOriginOwner] === value)
    }

    function releaseAppOriginOwner(s: State, key: string) {
      const owner = s.appOrigins[key]
      if (!owner) return
      clearTimeout(owner.timer)
      delete s.appOrigins[key]
      if ((s.leases[owner.server] ?? 0) === 0) scheduleIdleClose(s, owner.server, owner.client, owner.generation)
    }

    function closeClient(s: State, name: string) {
      const timer = s.idleTimers[name]
      if (timer) clearTimeout(timer)
      delete s.idleTimers[name]
      const client = s.clients[name]
      if (!client) return Effect.void
      // Replacing/disconnecting a server must not cut off a tool request which
      // already leased the old transport. `add()` waits here; ordinary idle
      // retirement is handled separately below and keeps the cached schema.
      const waitForLeases =
        (s.leases[name] ?? 0) === 0
          ? Effect.void
          : Effect.promise(
              () => new Promise<void>((resolve) => (s.leaseWaiters[name] ??= []).push(resolve)),
            )
      return waitForLeases.pipe(
        Effect.andThen(
          Effect.sync(() => {
            // A concurrent replacement already took ownership of this name.
            if (s.clients[name] !== client) return false
            const generation = s.generations[name] ?? 0
            for (const [key, owner] of Object.entries(s.appOrigins)) {
              if (owner.server !== name || owner.client !== client || owner.generation !== generation) continue
              clearTimeout(owner.timer)
              delete s.appOrigins[key]
            }
            for (const [key, owner] of Object.entries(s.provisionalAppOrigins)) {
              if (owner.server !== name || owner.client !== client || owner.generation !== generation) continue
              delete s.provisionalAppOrigins[key]
            }
            s.generations[name] = (s.generations[name] ?? 0) + 1
            delete s.clients[name]
            delete s.defs[name]
            delete s.mcpAppsSupported[name]
            return true
          }),
        ),
        Effect.flatMap((shouldClose) =>
          shouldClose ? Effect.tryPromise(() => client.close()).pipe(Effect.ignore) : Effect.void,
        ),
      )
    }

    const idleGraceMs = () => {
      const configured = Number(process.env.RHYTHM_MCP_IDLE_GRACE_MS)
      return Number.isFinite(configured) && configured >= 0 ? configured : 30_000
    }

    function scheduleIdleClose(s: State, name: string, client: MCPClient, generation: number) {
      if (s.leases[name] === undefined) s.leases[name] = 0
      if (s.generations[name] === undefined) s.generations[name] = generation
      const existing = s.idleTimers[name]
      if (existing) clearTimeout(existing)
      s.idleTimers[name] = setTimeout(() => {
        const hasOrigin = Object.values(s.appOrigins).some(
          (owner) =>
            owner.server === name &&
            owner.client === client &&
            owner.generation === generation &&
            owner.expiresAt > Date.now(),
        )
        const hasProvisionalOrigin = Object.values(s.provisionalAppOrigins).some(
          (owner) => owner.server === name && owner.client === client && owner.generation === generation,
        )
        if (
          s.generations[name] !== generation ||
          s.leases[name] !== 0 ||
          hasOrigin ||
          hasProvisionalOrigin ||
          s.clients[name] !== client
        )
          return
        delete s.idleTimers[name]
        delete s.clients[name]
        // Keep advertised definitions and MCP App capability metadata. Existing
        // tool/app catalog entries can then re-acquire this one server on use.
        s.status[name] = { status: "configured" }
        void client.close()
      }, idleGraceMs())
    }

    function leaseClient<A>(s: State, name: string, fn: (client: MCPClient) => Promise<A>): Promise<A> {
      const client = s.clients[name]
      if (!client || s.status[name]?.status !== "connected") return Promise.reject(new Error(`MCP client unavailable: ${name}`))

      const timer = s.idleTimers[name]
      if (timer) clearTimeout(timer)
      delete s.idleTimers[name]
      const generation = s.generations[name] ?? 0
      s.leases[name] = (s.leases[name] ?? 0) + 1

      const release = () => {
        const remaining = Math.max(0, (s.leases[name] ?? 1) - 1)
        s.leases[name] = remaining
        if (remaining > 0) return
        const waiters = s.leaseWaiters[name]
        delete s.leaseWaiters[name]
        waiters?.splice(0).forEach((resolve) => resolve())
        scheduleIdleClose(s, name, client, generation)
      }
      try {
        return Promise.resolve(fn(client)).finally(release)
      } catch (error) {
        release()
        return Promise.reject(error)
      }
    }

    const withAppOriginLease = Effect.fnUntraced(function* <A>(
      origin: AppOriginProvenance,
      part: PersistedAppOriginPart,
      fn: (client: MCPClient) => Promise<A>,
    ) {
      // Persisted App output is not sufficient authority to reconnect by name:
      // require the exact in-memory producer and synchronously lease it before
      // any resource/action request can run.
      if (!(yield* InstanceState.has(state))) return yield* Effect.fail(new Error("app origin unavailable"))
      const directory = yield* InstanceState.directory
      const cfg = yield* cfgSvc.get()
      const configured = cfg.mcp?.[origin.serverName]
      const expiresAt = Date.parse(origin.expiresAt)
      const s = yield* InstanceState.get(state)
      const owner = s.appOrigins[appOriginKey(origin.sessionID, origin.callID)]
      if (
        !owner ||
        !owner.persisted ||
        !configured ||
        !isMcpConfigured(configured) ||
        configured.enabled === false ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() ||
        owner.expiresAt !== expiresAt ||
        owner.server !== origin.serverName ||
        owner.sessionID !== origin.sessionID ||
        owner.messageID !== part.messageID ||
        owner.partID !== part.partID ||
        part.sessionID !== origin.sessionID ||
        owner.cwd !== origin.cwd ||
        owner.resourceUri !== origin.resourceUri ||
        directory !== origin.cwd ||
        s.clients[owner.server] !== owner.client ||
        s.status[owner.server]?.status !== "connected" ||
        s.generations[owner.server] !== owner.generation
      )
        return yield* Effect.fail(new Error("app origin unavailable"))

      return yield* Effect.tryPromise({
        try: () =>
          leaseClient(s, owner.server, (client) => {
            if (
              client !== owner.client ||
              s.clients[owner.server] !== owner.client ||
              s.generations[owner.server] !== owner.generation
            )
              return Promise.reject(new Error("app origin unavailable"))
            return fn(client)
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
    })

    const storeClient = Effect.fnUntraced(function* (
      s: State,
      name: string,
      client: MCPClient,
      listed: MCPToolDef[],
      timeout?: number,
    ) {
      yield* closeClient(s, name)
      s.status[name] = { status: "connected" }
      s.clients[name] = client
      s.defs[name] = listed
      s.mcpAppsSupported[name] = mcpAppsMode() !== "off" && supportsMcpApps(client)
      watch(s, name, client, s.bridge, timeout)
      yield* bus.publish(MetadataChanged, { server: name }).pipe(Effect.ignore)
      return s.status[name]
    })

    const status = Effect.fn("MCP.status")(function* () {
      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const s = (yield* InstanceState.has(state)) ? yield* InstanceState.get(state) : undefined
      const result: Record<string, Status> = {}

      for (const [key, mcp] of Object.entries(config)) {
        if (!isMcpConfigured(mcp)) continue
        result[key] = s?.status[key] ?? (mcp.enabled === false ? { status: "disabled" } : { status: "configured" })
      }

      return result
    })

    const clients = Effect.fn("MCP.clients")(function* () {
      if (!(yield* InstanceState.has(state))) return {}
      return (yield* InstanceState.get(state)).clients
    })

    const createAndStoreInState = Effect.fn("MCP.createAndStoreInState")(function* (
      s: State,
      name: string,
      mcp: ConfigMCP.Info,
      replace = false,
    ) {
      const failed = (error: unknown) =>
        Effect.sync(() => {
          const message = error instanceof Error ? error.message : String(error)
          return (s.status[name] = { status: "failed", error: message } satisfies Status)
        })
      if (!replace && s.clients[name] && s.status[name]?.status === "connected") return s.status[name]

      // Creating an MCP client performs multiple asynchronous operations. Put a
      // promise in state before starting them so simultaneous session/tool
      // owners share one transport instead of replacing and closing each other.
      const existing = !replace ? s.acquiring[name] : undefined
      if (existing) {
        return yield* Effect.tryPromise({
          try: () => existing,
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(Effect.catch(failed))
      }

      const pending = s.bridge.promise(
        Effect.gen(function* () {
          const result = yield* create(name, mcp, s.oauthOwner)
          s.status[name] = result.status
          if (!result.mcpClient) {
            yield* closeClient(s, name)
            return result.status
          }
          return yield* storeClient(s, name, result.mcpClient, result.defs!, mcp.timeout)
        }),
      )
      s.acquiring[name] = pending

      return yield* Effect.tryPromise({
        try: () => pending,
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (s.acquiring[name] === pending) delete s.acquiring[name]
          }),
        ),
        Effect.catch(failed),
      )
    })

    const createAndStore = Effect.fn("MCP.createAndStore")(function* (
      name: string,
      mcp: ConfigMCP.Info,
      replace = false,
    ) {
      const s = yield* InstanceState.get(state)
      return yield* createAndStoreInState(s, name, mcp, replace)
    })

    const ensureClient = Effect.fnUntraced(function* (s: State, name: string) {
      const cfg = yield* cfgSvc.get()
      const mcp = cfg.mcp?.[name]
      if (!mcp || !isMcpConfigured(mcp) || mcp.enabled === false) {
        return undefined
      }
      yield* createAndStoreInState(s, name, mcp)
      const client = s.clients[name]
      return client && s.status[name]?.status === "connected" ? client : undefined
    })

    const add = Effect.fn("MCP.add")(function* (name: string, mcp: ConfigMCP.Info) {
      yield* createAndStore(name, mcp, true)
      const s = yield* InstanceState.get(state)
      return { status: s.status }
    })

    const connect = Effect.fn("MCP.connect")(function* (name: string) {
      const mcp = yield* getMcpConfig(name)
      if (!mcp) {
        log.error("MCP config not found or invalid", { name })
        return
      }
      yield* createAndStore(name, { ...mcp, enabled: true })
    })

    const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      yield* closeClient(s, name)
      delete s.clients[name]
      s.status[name] = { status: "disabled" }
    })

    const tools = Effect.fn("MCP.tools")(function* (selection?: ToolSelection) {
      const result: Record<string, Tool> = {}
      const s = yield* InstanceState.get(state)

      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const defaultTimeout = cfg.experimental?.mcp_timeout

      const selected =
        selection === undefined
          ? Object.entries(config)
              .filter(([, entry]) => entry && isMcpConfigured(entry) && entry.enabled !== false)
              .map(([name]) => name)
          : [
              ...selection.servers,
              ...selection.tools.flatMap((key) => {
                const matches = Object.entries(config)
                  .filter(([name, entry]) => entry && isMcpConfigured(entry) && key.startsWith(sanitize(name) + "_"))
                  .map(([name]) => name)
                // A composed key uses the sanitized server name as a prefix.
                // Do not guess when two configured names would be ambiguous.
                return matches.length === 1 ? matches : []
              }),
            ]

      // Individual tool names are only trusted after a server's own schema has
      // named them. A cold explicit tool-only selection must not start every
      // configured server in an attempt to reverse-engineer its owner.
      for (const [name, defs] of Object.entries(s.defs)) {
        if (selection?.tools.some((key) => defs.some((tool) => sanitize(name) + "_" + sanitize(tool.name) === key))) {
          selected.push(name)
        }
      }

      yield* Effect.forEach(
        [...new Set(selected)],
        (name) =>
          Effect.gen(function* () {
            if (s.status[name]?.status === "connected") return
            if (s.status[name]?.status === "disabled") return
            const entry = config[name]
            if (!entry || !isMcpConfigured(entry) || entry.enabled === false) return
            yield* createAndStore(name, entry)
          }),
        { concurrency: 2 },
      )

      for (const name of new Set(selected)) {
        const client = s.clients[name]
        if (client && s.status[name]?.status === "connected" && (s.leases[name] ?? 0) === 0) {
          scheduleIdleClose(s, name, client, s.generations[name] ?? 0)
        }
      }

      const connectedClients = Object.entries(s.clients).filter(
        ([clientName]) =>
          s.status[clientName]?.status === "connected" &&
          (selection === undefined ||
            selection.servers.includes(clientName) ||
            s.defs[clientName]?.some((tool) => selection.tools.includes(sanitize(clientName) + "_" + sanitize(tool.name)))),
      )

      yield* Effect.forEach(
        connectedClients,
        ([clientName, client]) =>
          Effect.gen(function* () {
            const mcpConfig = config[clientName]
            const entry = mcpConfig && isMcpConfigured(mcpConfig) ? mcpConfig : undefined
            const listed = s.defs[clientName]
            if (!listed) {
              log.warn("missing cached tools for connected server", { clientName })
              return
            }

            const timeout = entry?.timeout ?? defaultTimeout
            for (const mcpTool of listed) {
              const descriptor = s.mcpAppsSupported[clientName] ? uiDescriptor(mcpTool) : { kind: "none" as const }
              if (descriptor.kind === "invalid") continue
              if (descriptor.kind === "valid" && !descriptor.visibility.includes("model")) continue
              result[sanitize(clientName) + "_" + sanitize(mcpTool.name)] = convertMcpTool(
                mcpTool,
                client,
                timeout,
                (args, options) =>
                  s.bridge.promise(
                    Effect.gen(function* () {
                      yield* ensureClient(s, clientName)
                      return yield* Effect.tryPromise({
                        try: () =>
                          leaseClient(s, clientName, (current) => {
                            const securityMeta = rhythmSecurityRequestMeta(options, mcpTool.name, args)
                            const context = rhythmSecurityContext(options)
                            const provisional =
                              context &&
                              descriptor.kind === "valid" &&
                              descriptor.visibility.includes("app") &&
                              context.toolCallId === options.toolCallId
                                ? {
                                    server: clientName,
                                    client: current,
                                    generation: s.generations[clientName] ?? 0,
                                    sessionID: context.sdkSessionId,
                                    callID: context.toolCallId,
                                  }
                                : undefined
                            const provisionalKey = provisional && appOriginKey(provisional.sessionID, provisional.callID)
                            if (provisional && provisionalKey) s.provisionalAppOrigins[provisionalKey] = provisional
                            const releaseOnAbort = () => {
                              if (!provisional || !provisionalKey || s.provisionalAppOrigins[provisionalKey] !== provisional) return
                              delete s.provisionalAppOrigins[provisionalKey]
                            }
                            options.abortSignal?.addEventListener("abort", releaseOnAbort, { once: true })
                            return current
                              .callTool(
                              {
                                name: mcpTool.name,
                                arguments: (args || {}) as Record<string, unknown>,
                                ...(securityMeta && { _meta: securityMeta }),
                              },
                              CallToolResultSchema,
                              { resetTimeoutOnProgress: true, timeout },
                            )
                              .then((result) => result)
                              .catch((error) => {
                                releaseOnAbort()
                                throw error
                              })
                              .finally(() => options.abortSignal?.removeEventListener("abort", releaseOnAbort))
                          }),
                        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
                      })
                    }),
                  ),
              )
            }
          }),
        { concurrency: "unbounded" },
      )
      return result
    })

    const catalog = Effect.fn("MCP.catalog")(function* () {
      if (!(yield* InstanceState.has(state))) return []
      const s = yield* InstanceState.get(state)
      return Object.entries(s.defs).flatMap(([clientName, defs]) =>
        defs.map((tool) => sanitize(clientName) + "_" + sanitize(tool.name)),
      )
    })

    const appTools = Effect.fn("MCP.appTools")(function* () {
      const result: Record<string, McpAppTool> = {}
      if (mcpAppsMode() === "off") return result
      const s = yield* InstanceState.get(state)
      for (const [clientName] of Object.entries(s.defs).filter(([name]) => s.mcpAppsSupported[name])) {
        const listed = s.defs[clientName]
        if (!listed) continue
        for (const mcpTool of listed) {
          const descriptor = uiDescriptor(mcpTool)
          if (descriptor.kind !== "valid" || !descriptor.visibility.includes("app")) continue
          result[sanitize(clientName) + "_" + sanitize(mcpTool.name)] = {
            ...mcpTool,
            client: clientName,
            ui: {
              resourceUri: descriptor.resourceUri,
              visibility: descriptor.visibility,
            },
          }
        }
      }
      return result
    })

    const executeAppTool = Effect.fn("MCP.executeAppTool")(function* (
      key: string,
      args: Record<string, unknown>,
      options: ToolExecutionOptions,
    ) {
      if (mcpAppsMode() !== "interactive") return yield* Effect.fail(new Error("app execution unavailable"))
      const registry = yield* appTools()
      const tool = registry[key]
      if (!tool) return yield* Effect.fail(new Error("app execution unavailable"))
      const s = yield* InstanceState.get(state)
      if (!(yield* ensureClient(s, tool.client))) return yield* Effect.fail(new Error("app execution unavailable"))
      const cfg = yield* cfgSvc.get()
      const configured = cfg.mcp?.[tool.client]
      const timeout =
        configured && isMcpConfigured(configured)
          ? (configured.timeout ?? cfg.experimental?.mcp_timeout)
          : cfg.experimental?.mcp_timeout
      return yield* Effect.tryPromise({
        try: () =>
          leaseClient(s, tool.client, (current) => {
            const active = convertMcpTool(tool, current, timeout).execute
            if (!active) return Promise.reject(new Error("app execution unavailable"))
            return active(args, options)
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
    })

    const readAppResource = Effect.fn("MCP.readAppResource")(function* (
      origin: AppOriginProvenance,
      part: PersistedAppOriginPart,
    ) {
      return yield* withAppOriginLease(origin, part, (client) => client.readResource({ uri: origin.resourceUri }))
    })

    const executeAppToolForOrigin = Effect.fn("MCP.executeAppToolForOrigin")(function* (
      origin: AppOriginProvenance,
      part: PersistedAppOriginPart,
      key: string,
      args: Record<string, unknown>,
      options: ToolExecutionOptions,
    ) {
      if (mcpAppsMode() !== "interactive") return yield* Effect.fail(new Error("app execution unavailable"))
      const s = yield* InstanceState.get(state)
      const tool = s.defs[origin.serverName]?.find(
        (candidate) => sanitize(origin.serverName) + "_" + sanitize(candidate.name) === key,
      )
      const descriptor = tool ? uiDescriptor(tool) : undefined
      if (
        !tool ||
        !descriptor ||
        descriptor.kind !== "valid" ||
        !descriptor.visibility.includes("app") ||
        descriptor.resourceUri !== origin.resourceUri
      )
        return yield* Effect.fail(new Error("app execution unavailable"))

      const cfg = yield* cfgSvc.get()
      const configured = cfg.mcp?.[origin.serverName]
      const timeout =
        configured && isMcpConfigured(configured)
          ? (configured.timeout ?? cfg.experimental?.mcp_timeout)
          : cfg.experimental?.mcp_timeout
      return yield* withAppOriginLease(origin, part, (client) => {
        const execute = convertMcpTool(tool, client, timeout).execute
        return execute ? execute(args, options) : Promise.reject(new Error("app execution unavailable"))
      })
    })

    const releaseAppOrigin = Effect.fn("MCP.releaseAppOrigin")(function* (sessionID: string, callID: string) {
      const s = yield* InstanceState.get(state)
      releaseAppOriginOwner(s, appOriginKey(sessionID, callID))
    })

    const releaseProvisionalAppOrigin = Effect.fn("MCP.releaseProvisionalAppOrigin")(function* (
      sessionID: string,
      callID: string,
    ) {
      const s = yield* InstanceState.get(state)
      const key = appOriginKey(sessionID, callID)
      const owner = s.provisionalAppOrigins[key]
      if (!owner) return
      delete s.provisionalAppOrigins[key]
      if ((s.leases[owner.server] ?? 0) === 0) scheduleIdleClose(s, owner.server, owner.client, owner.generation)
    })

    const retainAppOrigin = Effect.fn("MCP.retainAppOrigin")(function* (origin: AppOriginOwner) {
      const s = yield* InstanceState.get(state)
      const expiresAt = Date.parse(origin.expiresAt)
      const key = appOriginKey(origin.sessionID, origin.callID)
      const provisional = s.provisionalAppOrigins[key]
      if (
        !provisional ||
        provisional.server !== origin.serverName ||
        origin.part.sessionID !== origin.sessionID ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now()
      )
        return false
      delete s.provisionalAppOrigins[key]
      if (
        s.clients[origin.serverName] !== provisional.client ||
        s.status[origin.serverName]?.status !== "connected" ||
        s.generations[origin.serverName] !== provisional.generation
      )
        return false
      const prior = s.appOrigins[key]
      if (prior) clearTimeout(prior.timer)
      const timer = setTimeout(() => {
        const current = s.appOrigins[key]
        if (
          !current ||
          current.client !== provisional.client ||
          current.generation !== provisional.generation ||
          current.expiresAt !== expiresAt
        )
          return
        releaseAppOriginOwner(s, key)
      }, Math.max(0, expiresAt - Date.now()))
      s.appOrigins[key] = {
        server: origin.serverName,
        expiresAt,
        client: provisional.client,
        generation: provisional.generation,
        timer,
        sessionID: origin.sessionID,
        messageID: origin.part.messageID,
        partID: origin.part.partID,
        cwd: origin.cwd,
        resourceUri: origin.resourceUri,
        persisted: false,
      }
      return true
    })

    // Rhythm carried patch (mcp-scope): builds composedKey → raw clientName without
    // splitting on "_" so hyphenated server names (e.g. "gmail-work") are preserved.
    const toolClientNames = Effect.fn("MCP.toolClientNames")(function* () {
      const result: Record<string, string> = {}
      const s = yield* InstanceState.get(state)
      for (const [clientName] of Object.entries(s.defs)) {
        const listed = s.defs[clientName]
        if (!listed) continue
        for (const mcpTool of listed) {
          const descriptor = s.mcpAppsSupported[clientName] ? uiDescriptor(mcpTool) : { kind: "none" as const }
          if (descriptor.kind === "invalid") continue
          if (descriptor.kind === "valid" && !descriptor.visibility.includes("model")) continue
          result[sanitize(clientName) + "_" + sanitize(mcpTool.name)] = clientName
        }
      }
      return result
    })

    const toolIdentity = Effect.fn("MCP.toolIdentity")(function* (toolKey: string) {
      const s = yield* InstanceState.get(state)
      return resolvePassiveMcpToolIdentity(s, toolKey)
    })

    const collectFromConnected = Effect.fnUntraced(function* <T extends { name: string }>(
      s: State,
      capability: "prompts" | "resources",
      listFn: (c: Client, timeout: number) => Promise<T[]>,
    ) {
      const cfg = yield* cfgSvc.get()
      const results = yield* Effect.forEach(
        Object.entries(s.clients).filter(
          // A server that did not advertise the capability is never asked: a
          // hand-rolled stdio server that ignores unknown methods would
          // otherwise hang the caller until the timeout.
          ([name, client]) =>
            s.status[name]?.status === "connected" && client.getServerCapabilities()?.[capability] !== undefined,
        ),
        ([clientName]) => {
          const entry = cfg.mcp?.[clientName]
          const configured = entry && isMcpConfigured(entry) ? entry.timeout : undefined
          const timeout = Math.min(configured ?? cfg.experimental?.mcp_timeout ?? LIST_TIMEOUT, LIST_TIMEOUT)
          return Effect.tryPromise({
            try: () =>
              leaseClient(s, clientName, (client) =>
                withTimeout(listFn(client, timeout), timeout, `${capability} list timed out after ${timeout}ms`),
              ),
            catch: (error) => error,
          }).pipe(
            Effect.map((items) => {
              const out: Record<string, T & { client: string }> = {}
              const prefix = sanitize(clientName)
              for (const item of items ?? []) out[prefix + ":" + sanitize(item.name)] = { ...item, client: clientName }
              return out
            }),
            Effect.catch((error) => {
              log.error(`failed to list ${capability}`, {
                clientName,
                error: error instanceof Error ? error.message : String(error),
              })
              return Effect.succeed([])
            }),
          )
        },
        { concurrency: "unbounded" },
      )
      return Object.fromEntries<T & { client: string }>(results.flatMap((record) => Object.entries(record)))
    })

    const prompts = Effect.fn("MCP.prompts")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* collectFromConnected(s, "prompts", (c, timeout) =>
        c.listPrompts(undefined, { timeout }).then((r) => r.prompts),
      )
    })

    const resources = Effect.fn("MCP.resources")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* collectFromConnected(s, "resources", (c, timeout) =>
        c.listResources(undefined, { timeout }).then((r) => r.resources),
      )
    })

    const withClient = Effect.fnUntraced(function* <A>(
      clientName: string,
      fn: (client: MCPClient) => Promise<A>,
      label: string,
      meta?: Record<string, unknown>,
    ) {
      const s = yield* InstanceState.get(state)
      return yield* Effect.tryPromise({
        try: () =>
          s.bridge.promise(
            Effect.gen(function* () {
              yield* ensureClient(s, clientName)
              return yield* Effect.tryPromise({
                try: () => leaseClient(s, clientName, fn),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              })
            }),
          ),
        catch: (e: any) => {
          log.error(`failed to ${label}`, { clientName, ...meta, error: e?.message })
          return e
        },
      }).pipe(Effect.orElseSucceed(() => undefined))
    })

    const getPrompt = Effect.fn("MCP.getPrompt")(function* (
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ) {
      return yield* withClient(clientName, (client) => client.getPrompt({ name, arguments: args }), "getPrompt", {
        promptName: name,
      })
    })

    const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
      return yield* withClient(clientName, (client) => client.readResource({ uri: resourceUri }), "readResource", {
        resourceUri,
      })
    })

    const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
      const cfg = yield* cfgSvc.get()
      const mcpConfig = cfg.mcp?.[mcpName]
      if (!mcpConfig || !isMcpConfigured(mcpConfig)) return undefined
      return mcpConfig
    })

    const startAuth = Effect.fn("MCP.startAuth")(function* (mcpName: string) {
      const directory = yield* InstanceState.directory
      const s = yield* InstanceState.get(state)
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) throw new Error(`MCP server ${mcpName} not found or disabled`)
      if (mcpConfig.type !== "remote") throw new Error(`MCP server ${mcpName} is not a remote server`)
      if (mcpConfig.oauth === false) throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
      const url = remoteURL(mcpName, mcpConfig.url)
      if (!url) throw new Error(`Invalid MCP URL for "${mcpName}"`)

      const existing = pendingOAuthTransports.get(mcpName)
      const fingerprint = oauthConfigFingerprint(mcpConfig)
      if (existing && existing.deadline > Date.now()) {
        if (
          existing.owner === s.oauthOwner &&
          existing.phase === "waiting" &&
          existing.configFingerprint === fingerprint &&
          existing.state &&
          existing.authorizationUrl
        )
          return { authorizationUrl: existing.authorizationUrl, oauthState: existing.state }
        throw new Error(`Authorization already pending for MCP server: ${mcpName}`)
      }

      // OAuth config is optional - if not provided, we'll use auto-discovery
      const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined

      // Start the callback server with custom redirectUri if configured
      yield* Effect.promise(() => McpOAuthCallback.ensureRunning(oauthConfig?.redirectUri))

      const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      let capturedUrl: URL | undefined
      let capturedPending: PendingOAuthTransport | undefined
      const authProvider = new McpOAuthProvider(
        mcpName,
        mcpConfig.url,
        {
          clientId: oauthConfig?.clientId,
          clientSecret: oauthConfig?.clientSecret,
          scope: oauthConfig?.scope,
          redirectUri: oauthConfig?.redirectUri,
        },
        {
          onRedirect: async (url) => {
            capturedUrl = url
          },
          canPersist: () => {
            const pending = capturedPending
            return (
              !!pending &&
              pendingOAuthTransports.get(mcpName) === pending &&
              pending.owner === s.oauthOwner &&
              pending.configFingerprint === fingerprint &&
              (pending.phase === "waiting" || pending.phase === "finishing")
            )
          },
          onState: (state) => {
            const pending = capturedPending
            if (
              pending &&
              pendingOAuthTransports.get(mcpName) === pending &&
              pending.owner === s.oauthOwner &&
              pending.configFingerprint === fingerprint
            )
              pending.state = state
          },
          onCodeVerifier: (codeVerifier) => {
            const pending = capturedPending
            if (
              pending &&
              pendingOAuthTransports.get(mcpName) === pending &&
              pending.owner === s.oauthOwner &&
              pending.configFingerprint === fingerprint
            )
              pending.codeVerifier = codeVerifier
          },
        },
        auth,
      )

      const transport = new StreamableHTTPClientTransport(url, { authProvider })
      capturedPending = registerPendingOAuth(mcpName, transport, directory, {
        owner: s.oauthOwner,
        configFingerprint: fingerprint,
        state: oauthState,
      })
      if (!capturedPending) {
        throw new Error(`Authorization already pending for MCP server: ${mcpName}`)
      }
      yield* auth.updateOAuthState(mcpName, oauthState)

      return yield* Effect.tryPromise({
        try: () => {
          const client = createAppAwareClient()
          return client
            .connect(transport)
            .then(() => ({ authorizationUrl: "", oauthState, client }) satisfies AuthResult)
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) => {
          if (error instanceof UnauthorizedError && capturedUrl) {
            const pending = pendingOAuthTransports.get(mcpName)
            if (pending?.owner !== s.oauthOwner || pending.transport !== transport) {
              return Effect.die(new Error(`Authorization already pending for MCP server: ${mcpName}`))
            }
            pending.authorizationUrl = capturedUrl.toString()
            return Effect.succeed({ authorizationUrl: capturedUrl.toString(), oauthState } satisfies AuthResult)
          }
          const pending = pendingOAuthTransports.get(mcpName)
          if (pending?.owner === s.oauthOwner && pending.transport === transport) {
            pendingOAuthTransports.delete(mcpName)
            if (pending.timer) clearTimeout(pending.timer)
          }
          return Effect.die(error)
        }),
      )
    })

    const authenticate = Effect.fn("MCP.authenticate")(function* (mcpName: string) {
      const result = yield* startAuth(mcpName)
      if (!result.authorizationUrl) {
        const client = "client" in result ? result.client : undefined
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          return { status: "failed", error: "MCP config not found after auth" } as Status
        }

        const listed = client ? yield* defs(mcpName, client, mcpConfig.timeout) : undefined
        if (!client || !listed) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          return { status: "failed", error: "Failed to get tools" } as Status
        }

        const s = yield* InstanceState.get(state)
        const pending = pendingOAuthTransports.get(mcpName)
        if (pending?.owner === s.oauthOwner && pending.phase === "waiting") {
          pendingOAuthTransports.delete(mcpName)
          if (pending.timer) clearTimeout(pending.timer)
        }
        yield* auth.clearOAuthState(mcpName)
        return yield* storeClient(s, mcpName, client, listed, mcpConfig.timeout)
      }

      log.info("opening browser for oauth", { mcpName, url: result.authorizationUrl, state: result.oauthState })

      const callbackPromise = McpOAuthCallback.waitForCallback(result.oauthState, mcpName)

      yield* Effect.tryPromise(() => open(result.authorizationUrl)).pipe(
        Effect.flatMap((subprocess) =>
          Effect.callback<void, Error>((resume) => {
            const timer = setTimeout(() => resume(Effect.void), 500)
            subprocess.on("error", (err) => {
              clearTimeout(timer)
              resume(Effect.fail(err))
            })
            subprocess.on("exit", (code) => {
              if (code !== null && code !== 0) {
                clearTimeout(timer)
                resume(Effect.fail(new Error(`Browser open failed with exit code ${code}`)))
              }
            })
          }),
        ),
        Effect.catch(() => {
          log.warn("failed to open browser, user must open URL manually", { mcpName })
          return bus.publish(BrowserOpenFailed, { mcpName, url: result.authorizationUrl }).pipe(Effect.ignore)
        }),
      )

      const code = yield* Effect.promise(() => callbackPromise)

      const storedState = yield* auth.getOAuthState(mcpName)
      if (storedState !== result.oauthState) {
        yield* auth.clearOAuthState(mcpName)
        throw new Error("OAuth state mismatch - potential CSRF attack")
      }
      yield* auth.clearOAuthState(mcpName)
      return yield* finishAuth(mcpName, code)
    })

    const finishAuth = Effect.fn("MCP.finishAuth")(function* (mcpName: string, authorizationCode: string) {
      const pending = pendingOAuthTransports.get(mcpName)
      const directory = yield* InstanceState.directory
      const s = yield* InstanceState.get(state)
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (
        !pending ||
        pending.owner !== s.oauthOwner ||
        pending.directory !== directory ||
        pending.deadline <= Date.now() ||
        pending.phase !== "waiting" ||
        !mcpConfig ||
        mcpConfig.type !== "remote" ||
        pending.configFingerprint !== oauthConfigFingerprint(mcpConfig)
      )
        throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)
      pending.phase = "finishing"
      const transport = pending.transport
      const discardCapturedPending = Effect.gen(function* () {
        const isCurrent = pendingOAuthTransports.get(mcpName) === pending
        if (isCurrent) pendingOAuthTransports.delete(mcpName)
        if (pending.timer) clearTimeout(pending.timer)
        if (pending.state) McpOAuthCallback.cancelState(pending.state)
        yield* auth.clearOAuthEphemeraIfMatches(mcpName, {
          oauthState: pending.state,
          codeVerifier: pending.codeVerifier,
        })
        yield* Effect.tryPromise(() => transport.close()).pipe(Effect.ignore)
        return isCurrent
      })

      const result = yield* Effect.tryPromise({
        try: () => transport.finishAuth(authorizationCode).then(() => true as const),
        catch: (error) => {
          log.error("failed to finish oauth", { mcpName, error })
          return error
        },
      }).pipe(Effect.option)

      if (Option.isNone(result)) {
        yield* discardCapturedPending
        return { status: "failed", error: "OAuth completion failed" } as Status
      }

      if (pendingOAuthTransports.get(mcpName) !== pending) {
        yield* discardCapturedPending
        return { status: "failed", error: "OAuth flow was replaced" } as Status
      }
      // Keep the map record until the conditional store cleanup finishes. A
      // replacement may register while this awaits, but the auth write is
      // serialized and value-matched so it cannot erase the new verifier.
      yield* auth.clearOAuthEphemeraIfMatches(mcpName, {
        oauthState: pending.state,
        codeVerifier: pending.codeVerifier,
      })
      if (pendingOAuthTransports.get(mcpName) !== pending) {
        yield* discardCapturedPending
        return { status: "failed", error: "OAuth flow was replaced" } as Status
      }
      const currentConfig = yield* getMcpConfig(mcpName)
      if (
        !currentConfig ||
        currentConfig.type !== "remote" ||
        currentConfig.oauth === false ||
        pending.configFingerprint !== oauthConfigFingerprint(currentConfig)
      ) {
        yield* discardCapturedPending
        return { status: "failed", error: "MCP configuration changed during OAuth completion" } as Status
      }
      pendingOAuthTransports.delete(mcpName)
      if (pending.timer) clearTimeout(pending.timer)
      if (pending.state) McpOAuthCallback.cancelState(pending.state)
      yield* Effect.tryPromise(() => transport.close()).pipe(Effect.ignore)

      return yield* createAndStore(mcpName, currentConfig)
    })

    const removeAuth = Effect.fn("MCP.removeAuth")(function* (mcpName: string) {
      const directory = yield* InstanceState.directory
      const pending = pendingOAuthTransports.get(mcpName)
      const s = yield* InstanceState.get(state)
      if (pending && pending.owner !== s.oauthOwner && pending.deadline > Date.now()) {
        throw new Error(`Authorization is pending in another MCP instance: ${mcpName}`)
      }
      yield* auth.remove(mcpName)
      if (pending?.owner === s.oauthOwner && pending.directory === directory) {
        pendingOAuthTransports.delete(mcpName)
        if (pending.timer) clearTimeout(pending.timer)
        if (pending.state) McpOAuthCallback.cancelState(pending.state)
        yield* Effect.tryPromise(() => pending.transport.close()).pipe(Effect.ignore)
      }
      log.info("removed oauth credentials", { mcpName })
    })

    const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) return false
      return mcpConfig.type === "remote" && mcpConfig.oauth !== false
    })

    const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      return !!entry?.tokens
    })

    const getAuthStatus = Effect.fn("MCP.getAuthStatus")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      if (!entry?.tokens) return "not_authenticated" as AuthStatus
      const expired = yield* auth.isTokenExpired(mcpName)
      return (expired ? "expired" : "authenticated") as AuthStatus
    })

    return Service.of({
      status,
      clients,
      tools,
      catalog,
      appTools,
      executeAppTool,
      readAppResource,
      executeAppToolForOrigin,
      retainAppOrigin,
      releaseAppOrigin,
      releaseProvisionalAppOrigin,
      toolClientNames,
      toolIdentity,
      prompts,
      resources,
      add,
      connect,
      disconnect,
      getPrompt,
      readResource,
      startAuth,
      authenticate,
      finishAuth,
      removeAuth,
      supportsOAuth,
      hasStoredTokens,
      getAuthStatus,
    })
  }),
)

export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

// --- Per-service runtime ---

export const defaultLayer = layer.pipe(
  Layer.provide(McpAuth.layer),
  Layer.provide(Bus.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as MCP from "."
