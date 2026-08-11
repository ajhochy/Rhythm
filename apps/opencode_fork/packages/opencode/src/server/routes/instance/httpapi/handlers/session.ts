import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Command } from "@/command"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MCP } from "@/mcp"
import { readSessionBoundMcpAppResource } from "@/session/mcp-app-resource"
import { createMcpAppExecutionGate } from "@/session/mcp-app-execution"
import { filterMcpToolsByAllowlist } from "@/session/mcp_allowlist"
import { Plugin } from "@/plugin"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Effect, Option, Schema, Scope } from "effect"
import { createHash } from "node:crypto"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import type { ToolExecutionOptions } from "ai"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  CommandPayload,
  DiffQuery,
  ForkPayload,
  InitPayload,
  ListQuery,
  MessagesQuery,
  PermissionResponsePayload,
  PromptPayload,
  RevertPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
} from "../groups/session"
import * as SessionError from "./session-errors"

const mcpAppExecutionGate = createMcpAppExecutionGate()
const mcpAppInputValidator = new AjvJsonSchemaValidator()

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const shareSvc = yield* SessionShare.Service
    const promptSvc = yield* SessionPrompt.Service
    const revertSvc = yield* SessionRevert.Service
    const compactSvc = yield* SessionCompaction.Service
    const runState = yield* SessionRunState.Service
    const agentSvc = yield* Agent.Service
    const permissionSvc = yield* Permission.Service
    const statusSvc = yield* SessionStatus.Service
    const todoSvc = yield* Todo.Service
    const mcp = yield* MCP.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const bus = yield* Bus.Service
    const scope = yield* Scope.Scope

    const mapBusy = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | HttpApiError.BadRequest, R> =>
      effect.pipe(
        Effect.catchCause((cause): Effect.Effect<never, E | HttpApiError.BadRequest> => {
          if (Cause.squash(cause) instanceof Session.BusyError) return Effect.fail(new HttpApiError.BadRequest({}))
          return Effect.failCause(cause)
        }),
      )

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      return yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : ctx.query.directory,
        scope: ctx.query.scope,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      return yield* SessionError.mapStorageNotFound(session.get(sessionID))
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* session.children(ctx.params.sessionID)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      if (ctx.query.before) {
        const before = ctx.query.before
        yield* Effect.try({
          try: () => MessageV2.cursor.decode(before),
          catch: () => new HttpApiError.BadRequest({}),
        })
      }
      yield* requireSession(ctx.params.sessionID)
      if (ctx.query.limit === undefined || ctx.query.limit === 0) {
        return yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      }

      const page = yield* SessionError.mapStorageNotFound(
        MessageV2.page({
          sessionID: ctx.params.sessionID,
          limit: ctx.query.limit,
          before: ctx.query.before,
        }),
      )
      if (!page.cursor) return page.items

      const request = yield* HttpServerRequest.HttpServerRequest
      // toURL() honors the Host + x-forwarded-proto headers, so the Link
      // header echoes the real origin instead of a hard-coded localhost.
      const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.set("before", page.cursor)
      return HttpServerResponse.jsonUnsafe(page.items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": page.cursor,
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      return yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      )
    })

    const mcpAppResource = Effect.fn("SessionHttpApi.mcpAppResource")(function* (ctx: {
      params: { sessionID: SessionID; callID: string }
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      const found = yield* SessionError.mapStorageNotFound(
        session.findMessage(ctx.params.sessionID, (entry) =>
          entry.parts.some((part) => part.type === "tool" && part.callID === ctx.params.callID),
        ),
      )
      const message = Option.getOrUndefined(found)
      const part = message?.parts.find((item) => item.type === "tool" && item.callID === ctx.params.callID)
      if (!part || part.type !== "tool" || part.state.status !== "completed" || !part.state.mcpAppResource) {
        return yield* new HttpApiError.BadRequest({})
      }

      const origin = part.state.mcpAppResource
      const registry = yield* mcp.appTools()
      const stillAdvertised = Object.values(registry).some(
        (tool) => tool.client === origin.serverName && tool.ui.resourceUri === origin.resourceUri,
      )
      if (!stillAdvertised) return yield* new HttpApiError.BadRequest({})

      const mode = process.env.RHYTHM_MCP_APPS_MODE
      return yield* Effect.tryPromise({
        try: () =>
          readSessionBoundMcpAppResource(
            {
              mode,
              sessionID: current.id,
              callID: ctx.params.callID,
              cwd: current.directory,
              now: new Date().toISOString(),
              persistedOrigin: origin,
            },
            {
              readResource: ({ serverName, resourceUri }) =>
                Effect.runPromise(mcp.readResource(serverName, resourceUri)),
            },
          ),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const mcpAppExecutionProof = Effect.fn("SessionHttpApi.mcpAppExecutionProof")(function* (ctx: {
      params: { sessionID: SessionID; callID: string }
    }) {
      if (process.env.RHYTHM_MCP_APPS_MODE !== "interactive") {
        return yield* new HttpApiError.BadRequest({})
      }
      const current = yield* requireSession(ctx.params.sessionID)
      const found = yield* SessionError.mapStorageNotFound(
        session.findMessage(ctx.params.sessionID, (entry) =>
          entry.parts.some((part) => part.type === "tool" && part.callID === ctx.params.callID),
        ),
      )
      const message = Option.getOrUndefined(found)
      const part = message?.parts.find((item) => item.type === "tool" && item.callID === ctx.params.callID)
      if (!part || part.type !== "tool" || part.state.status !== "completed" || !part.state.mcpAppResource) {
        return yield* new HttpApiError.BadRequest({})
      }
      const origin = part.state.mcpAppResource
      const registry = yield* mcp.appTools()
      if (
        !Object.values(registry).some(
          (tool) => tool.client === origin.serverName && tool.ui.resourceUri === origin.resourceUri,
        )
      )
        return yield* new HttpApiError.BadRequest({})

      const resource = yield* Effect.tryPromise({
        try: () =>
          readSessionBoundMcpAppResource(
            {
              mode: "interactive",
              sessionID: current.id,
              callID: ctx.params.callID,
              cwd: current.directory,
              now: new Date().toISOString(),
              persistedOrigin: origin,
            },
            {
              readResource: ({ serverName, resourceUri }) =>
                Effect.runPromise(mcp.readResource(serverName, resourceUri)),
            },
          ),
        catch: () => new HttpApiError.BadRequest({}),
      })
      const expiresAt = Math.min(Date.parse(origin.expiresAt), Date.now() + 60_000)
      const proof = mcpAppExecutionGate.issueProof({
        sessionID: current.id,
        callID: ctx.params.callID,
        serverName: origin.serverName,
        resourceUri: origin.resourceUri,
        cwd: origin.cwd,
        contentHash: `sha256:${createHash("sha256").update(resource.text, "utf8").digest("hex")}`,
        expiresAt,
      })
      return { proof, expiresAt: new Date(expiresAt).toISOString() }
    })

    const mcpAppExecution = Effect.fn("SessionHttpApi.mcpAppExecution")(function* (ctx: {
      params: { sessionID: SessionID; callID: string }
      payload: { proof: string; toolKey: string; input: Record<string, unknown>; requestID: string }
    }) {
      if (process.env.RHYTHM_MCP_APPS_MODE !== "interactive") {
        return yield* new HttpApiError.BadRequest({})
      }
      const current = yield* requireSession(ctx.params.sessionID)
      const found = yield* SessionError.mapStorageNotFound(
        session.findMessage(ctx.params.sessionID, (entry) =>
          entry.parts.some((part) => part.type === "tool" && part.callID === ctx.params.callID),
        ),
      )
      const message = Option.getOrUndefined(found)
      const part = message?.parts.find((item) => item.type === "tool" && item.callID === ctx.params.callID)
      if (
        !message ||
        !part ||
        part.type !== "tool" ||
        part.state.status !== "completed" ||
        !part.state.mcpAppResource
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      const origin = part.state.mcpAppResource
      const agentName = current.agent ?? (yield* agentSvc.defaultAgent())
      const agent = yield* agentSvc.get(agentName)
      const options = MCP.withRhythmSecurityContext(
        { toolCallId: ctx.payload.requestID, messages: [] } as ToolExecutionOptions,
        {
          sdkSessionId: current.id,
          turnId: message.info.id,
          agentName,
          toolCallId: ctx.payload.requestID,
        },
      )
      return yield* Effect.tryPromise({
        try: () =>
          mcpAppExecutionGate.execute(
            {
              proof: ctx.payload.proof,
              sessionID: current.id,
              callID: ctx.params.callID,
              toolKey: ctx.payload.toolKey,
              input: ctx.payload.input,
              origin,
            },
            {
              appTools: async () => {
                const registry = await Effect.runPromise(mcp.appTools())
                return Object.fromEntries(
                  Object.entries(registry).map(([key, tool]) => [
                    key,
                    {
                      ...tool,
                      key,
                      visibility: tool.ui.visibility,
                    },
                  ]),
                )
              },
              isAllowed: async (toolKey) =>
                filterMcpToolsByAllowlist([toolKey], { [toolKey]: origin.serverName }, current.mcpAllowlist).length ===
                1,
              validateInput: async (schema, input) => {
                try {
                  return mcpAppInputValidator.getValidator(schema as never)(input).valid
                } catch {
                  return false
                }
              },
              before: (toolKey, input) =>
                Effect.runPromise(
                  plugin.trigger(
                    "tool.execute.before",
                    { tool: toolKey, sessionID: current.id, callID: ctx.payload.requestID },
                    { args: input },
                  ),
                ).then(() => undefined),
              approve: (toolKey) =>
                Effect.runPromise(
                  permissionSvc.ask({
                    permission: toolKey,
                    metadata: {},
                    patterns: ["*"],
                    always: ["*"],
                    sessionID: current.id,
                    tool: { messageID: message.info.id, callID: ctx.payload.requestID },
                    ruleset: Permission.merge(agent.permission, current.permission ?? []),
                  }),
                ),
              execute: (_tool, input) => {
                if (!mcp.executeAppTool) return Promise.reject(new Error("app execution unavailable"))
                return Effect.runPromise(
                  mcp.executeAppTool(ctx.payload.toolKey, input as Record<string, unknown>, options),
                )
              },
              after: (toolKey, input, result) =>
                Effect.runPromise(
                  plugin.trigger(
                    "tool.execute.after",
                    { tool: toolKey, sessionID: current.id, callID: ctx.payload.requestID, args: input },
                    result as never,
                  ),
                ).then(() => undefined),
            },
          ),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      return yield* shareSvc.create(ctx.payload)
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: () => new HttpApiError.BadRequest({}),
      })
      const payload = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* create({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* SessionError.mapStorageNotFound(session.remove(ctx.params.sessionID))
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (ctx.payload.title !== undefined) {
        yield* session.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
      }
      if (ctx.payload.permission !== undefined) {
        yield* session.setPermission({
          sessionID: ctx.params.sessionID,
          permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
        })
      }
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      // Rhythm carried patch (mcp-scope): update the per-session MCP tool allowlist.
      if (ctx.payload.mcpAllowlist !== undefined) {
        yield* session.setMcpAllowlist({ sessionID: ctx.params.sessionID, mcpAllowlist: ctx.payload.mcpAllowlist })
      }
      // Rhythm carried patch (skill-scope, #775): update the per-session skill allowlist.
      if (ctx.payload.skillAllowlist !== undefined) {
        yield* session.setSkillAllowlist({
          sessionID: ctx.params.sessionID,
          skillAllowlist: ctx.payload.skillAllowlist,
        })
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      return yield* SessionError.mapStorageNotFound(
        session.fork({ sessionID: ctx.params.sessionID, messageID: ctx.payload?.messageID }),
      )
    })

    const forkRaw = Effect.fn("SessionHttpApi.forkRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* fork({ params: ctx.params })

      const json = yield* Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: () => new HttpApiError.BadRequest({}),
      })
      const payload = yield* Schema.decodeUnknownEffect(ForkPayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* fork({ params: ctx.params, payload })
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* promptSvc.cancel(ctx.params.sessionID)
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* promptSvc
        .command({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload.messageID,
          model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
          command: Command.Default.INIT,
          arguments: "",
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    // share/unshare errors aren't all client-induced — storage and network
    // failures from SessionShare are real possibilities. Map to a typed 500
    // (matches the legacy route behavior which routed any failure through
    // ErrorMiddleware → NamedError.Unknown 500) instead of blanket-mapping
    // every failure to a 400 BadRequest.
    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      yield* revertSvc.cleanup(yield* requireSession(ctx.params.sessionID))
      const messages = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      const defaultAgent = yield* agentSvc.defaultAgent()
      const currentAgent = messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent

      yield* compactSvc.create({
        sessionID: ctx.params.sessionID,
        agent: currentAgent,
        model: {
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        },
        auto: ctx.payload.auto ?? false,
      })
      yield* promptSvc.loop({ sessionID: ctx.params.sessionID })
      return true
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const message = yield* promptSvc
        .prompt({
          ...ctx.payload,
          sessionID: ctx.params.sessionID,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* promptSvc.prompt({ ...ctx.payload, sessionID: ctx.params.sessionID }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("prompt_async failed").pipe(
              Effect.annotateLogs({ sessionID: ctx.params.sessionID, cause }),
            )
            yield* bus.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
          }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      )
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc
        .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* mapBusy(promptSvc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID }))
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* mapBusy(revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }))
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* mapBusy(revertSvc.unrevert({ sessionID: ctx.params.sessionID }))
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* permissionSvc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response })
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* mapBusy(runState.assertNotBusy(ctx.params.sessionID))
      yield* session.removeMessage(ctx.params)
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* session.removePart(ctx.params)
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof MessageV2.Part.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const payload = ctx.payload as MessageV2.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* session.updatePart(payload)
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handle("mcpAppResource", mcpAppResource)
      .handle("mcpAppExecutionProof", mcpAppExecutionProof)
      .handle("mcpAppExecution", mcpAppExecution)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handleRaw("fork", forkRaw)
      .handle("abort", abort)
      .handle("init", init)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
  }),
)
