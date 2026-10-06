import { InstanceState } from "@/effect/instance-state"
import { Runner } from "@/effect/runner"
import { Effect, Latch, Layer, Scope, Context } from "effect"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { MessageID, PartID, SessionID } from "./schema"
import { SessionStatus } from "./status"
import { MCP_DISPATCH_TOOL_ID } from "./mcp_deferred_tools"
import { runnerGenerations } from "./rhythm_provider_guard"
import { clearRunnerCertificates } from "./rhythm_provider_projection"
import { randomBytes } from "node:crypto"

// Bounded wait (~2s) for the processor to persist the native call as running.
const DEFERRED_IDENTITY_POLL_MS = 10
const DEFERRED_IDENTITY_MAX_ATTEMPTS = 200

export interface DeferredMcpToolBindings {
  bind: (input: {
    outerToolCallID: string
    outerToolKey: string
    deferredToolKey: string
  }) => (() => void) | undefined
  resolve: (outerToolCallID: string, outerToolKey: string) => string | undefined
  clear: () => void
}

/**
 * A deferred call has no synthetic native tool part. While it executes, this
 * maps the real running `mcp_dispatch` part to its selected MCP key so the
 * managed authority endpoint can prove the same assistant/call/user binding.
 */
export function createDeferredMcpToolBindings(): DeferredMcpToolBindings {
  const bindings = new Map<string, { deferredToolKey: string }>()
  return {
    bind(input) {
      if (
        input.outerToolKey !== MCP_DISPATCH_TOOL_ID ||
        input.outerToolCallID.length === 0 ||
        input.deferredToolKey.length === 0 ||
        bindings.has(input.outerToolCallID)
      ) return
      const binding = { deferredToolKey: input.deferredToolKey }
      bindings.set(input.outerToolCallID, binding)
      return () => {
        if (bindings.get(input.outerToolCallID) === binding) bindings.delete(input.outerToolCallID)
      }
    },
    resolve(outerToolCallID, outerToolKey) {
      if (outerToolKey !== MCP_DISPATCH_TOOL_ID) return
      return bindings.get(outerToolCallID)?.deferredToolKey
    },
    clear() {
      bindings.clear()
    },
  }
}

export interface ActiveProcessorProjection {
  readonly assistantID: MessageID
  readonly userMessageID: MessageID
  readonly agentName: string
  readonly toolCallIdentity: (toolCallID: string) => Effect.Effect<
    | {
        sessionID: SessionID
        messageID: MessageID
        partID: PartID
        toolKey: string
      }
    | undefined
  >
}

export interface ActiveToolCall {
  assistantID: MessageID
  userMessageID: MessageID
  partID: PartID
  toolCallID: string
  toolKey: string
  agentName: string
}

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly ensureRunning: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
    ready?: Latch.Latch,
  ) => Effect.Effect<MessageV2.WithParts>
  readonly withActiveProcessor: <A, E, R>(
    sessionID: SessionID,
    projection: ActiveProcessorProjection,
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly activeToolCall: (
    sessionID: SessionID,
    assistantID: MessageID,
    toolCallID: string,
  ) => Effect.Effect<ActiveToolCall | undefined>
  readonly withDeferredMcpToolCall: <A, E, R>(
    sessionID: SessionID,
    assistantID: MessageID,
    outerToolCallID: string,
    deferredToolKey: string,
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunState") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<
          SessionID,
          {
            runner: Runner.Runner<MessageV2.WithParts>
            activeProcessor?: ActiveProcessorProjection
            deferredMcpTools: DeferredMcpToolBindings
          }
        >()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            for (const [id, record] of runners) {
              record.activeProcessor = undefined
              record.deferredMcpTools.clear()
              runnerGenerations.delete(id)
              clearRunnerCertificates(id)
            }
            yield* Effect.forEach(runners.values(), (record) => record.runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
          }),
        )
        return { runners, scope }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing) return existing.runner
      // Opaque identity of this runner for the Dayflow provider frame (rhythm_provider_guard):
      // a frame installed under an older runner reads as replaced.
      const generation = `run_${randomBytes(12).toString("base64url")}`
      runnerGenerations.set(sessionID, generation)
      clearRunnerCertificates(sessionID)
      const next = Runner.make<MessageV2.WithParts>(data.scope, {
        onIdle: Effect.gen(function* () {
          const current = data.runners.get(sessionID)
          if (current?.runner === next) {
            current.activeProcessor = undefined
            current.deferredMcpTools.clear()
            data.runners.delete(sessionID)
            if (runnerGenerations.get(sessionID) === generation) runnerGenerations.delete(sessionID)
            clearRunnerCertificates(sessionID)
          }
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt,
        busy: () => {
          throw new Session.BusyError(sessionID)
        },
      })
      data.runners.set(sessionID, { runner: next, deferredMcpTools: createDeferredMcpToolBindings() })
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing?.runner.busy) throw new Session.BusyError(sessionID)
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (!existing || !existing.runner.busy) {
        yield* status.set(sessionID, { type: "idle" })
        return
      }
      existing.activeProcessor = undefined
      existing.deferredMcpTools.clear()
      yield* existing.runner.cancel
    })

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt)).ensureRunning(work)
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
      ready?: Latch.Latch,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt)).startShell(work, ready)
    })

    const withActiveProcessor = Effect.fn("SessionRunState.withActiveProcessor")(function* <A, E, R>(
      sessionID: SessionID,
      projection: ActiveProcessorProjection,
      work: Effect.Effect<A, E, R>,
    ) {
      const data = yield* InstanceState.get(state)
      const record = data.runners.get(sessionID)
      if (!record?.runner.busy || record.activeProcessor) throw new Session.BusyError(sessionID)
      record.activeProcessor = projection
      return yield* work.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (data.runners.get(sessionID) === record && record.activeProcessor === projection) {
              record.activeProcessor = undefined
              record.deferredMcpTools.clear()
            }
          }),
      ),
      )
    })

    const withDeferredMcpToolCall = Effect.fn("SessionRunState.withDeferredMcpToolCall")(function* <A, E, R>(
      sessionID: SessionID,
      assistantID: MessageID,
      outerToolCallID: string,
      deferredToolKey: string,
      work: Effect.Effect<A, E, R>,
    ) {
      const data = yield* InstanceState.get(state)
      const record = data.runners.get(sessionID)
      const projection = record?.activeProcessor
      if (!record?.runner.busy || !projection || projection.assistantID !== assistantID) {
        throw new Error("Deferred MCP call is not active")
      }
      // The AI SDK starts execute() on the tool-call chunk concurrently with the
      // processor persisting that call as `running`, so the real native part can
      // still be pending here. Wait (bounded) for that legitimate registration,
      // re-checking the same runner/projection/busy after every await so a
      // cancelled or replaced run never authorizes the call. Pending is never
      // treated as authorized: only a running part with matching IDs passes.
      let identity: Effect.Success<ReturnType<ActiveProcessorProjection["toolCallIdentity"]>>
      for (let attempt = 0; ; attempt++) {
        identity = yield* projection.toolCallIdentity(outerToolCallID)
        const current = (yield* InstanceState.get(state)).runners.get(sessionID)
        if (current !== record || current.activeProcessor !== projection || !current.runner.busy) {
          throw new Error("Deferred MCP call is not active")
        }
        if (identity) break
        if (attempt >= DEFERRED_IDENTITY_MAX_ATTEMPTS) throw new Error("Deferred MCP call is not active")
        yield* Effect.sleep(DEFERRED_IDENTITY_POLL_MS)
      }
      if (identity.sessionID !== sessionID || identity.messageID !== assistantID) {
        throw new Error("Deferred MCP call is not active")
      }
      const release = record.deferredMcpTools.bind({
        outerToolCallID,
        outerToolKey: identity.toolKey,
        deferredToolKey,
      })
      if (!release) throw new Error("Deferred MCP call identity is invalid")
      return yield* work.pipe(Effect.ensuring(Effect.sync(release)))
    })

    const activeToolCall = Effect.fn("SessionRunState.activeToolCall")(function* (
      sessionID: SessionID,
      assistantID: MessageID,
      toolCallID: string,
    ) {
      const data = yield* InstanceState.get(state)
      const record = data.runners.get(sessionID)
      const projection = record?.activeProcessor
      if (!record?.runner.busy || !projection || projection.assistantID !== assistantID) return
      const identity = yield* projection.toolCallIdentity(toolCallID)
      const current = (yield* InstanceState.get(state)).runners.get(sessionID)
      if (current !== record || current.activeProcessor !== projection || !current.runner.busy) return
      if (!identity || identity.sessionID !== sessionID || identity.messageID !== assistantID) return
      const deferredToolKey = record.deferredMcpTools.resolve(toolCallID, identity.toolKey)
      return {
        assistantID,
        userMessageID: projection.userMessageID,
        partID: identity.partID,
        toolCallID,
        toolKey: deferredToolKey ?? identity.toolKey,
        agentName: projection.agentName,
      }
    })

    return Service.of({
      assertNotBusy,
      cancel,
      ensureRunning,
      startShell,
      withActiveProcessor,
      activeToolCall,
      withDeferredMcpToolCall,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStatus.defaultLayer))

export * as SessionRunState from "./run-state"
