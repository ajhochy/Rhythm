import { InstanceState } from "@/effect/instance-state"
import { Runner } from "@/effect/runner"
import { Effect, Latch, Layer, Scope, Context } from "effect"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { MessageID, PartID, SessionID } from "./schema"
import { SessionStatus } from "./status"

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
          { runner: Runner.Runner<MessageV2.WithParts>; activeProcessor?: ActiveProcessorProjection }
        >()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            for (const record of runners.values()) record.activeProcessor = undefined
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
      const next = Runner.make<MessageV2.WithParts>(data.scope, {
        onIdle: Effect.gen(function* () {
          const current = data.runners.get(sessionID)
          if (current?.runner === next) {
            current.activeProcessor = undefined
            data.runners.delete(sessionID)
          }
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt,
        busy: () => {
          throw new Session.BusyError(sessionID)
        },
      })
      data.runners.set(sessionID, { runner: next })
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
            }
          }),
        ),
      )
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
      return {
        assistantID,
        userMessageID: projection.userMessageID,
        partID: identity.partID,
        toolCallID,
        toolKey: identity.toolKey,
        agentName: projection.agentName,
      }
    })

    return Service.of({ assertNotBusy, cancel, ensureRunning, startShell, withActiveProcessor, activeToolCall })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStatus.defaultLayer))

export * as SessionRunState from "./run-state"
