import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Bus } from "@/bus"
import { testEffect } from "../../test/lib/effect"
import { createDeferredMcpToolBindings, SessionRunState, type ActiveProcessorProjection } from "./run-state"
import type { MessageV2 } from "./message-v2"
import { MessageID, PartID, SessionID } from "./schema"
import { SessionStatus } from "./status"

// Actual scoped SessionRunState lifecycle (Runner + InstanceState), not the map alone.
const it = testEffect(
  SessionRunState.layer.pipe(Layer.provideMerge(SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer)))),
)

const interrupted = Effect.succeed({} as MessageV2.WithParts)

function projectionFor(assistantID: MessageID, identity: (callID: string) => ReturnType<ActiveProcessorProjection["toolCallIdentity"]>) {
  return { assistantID, userMessageID: MessageID.ascending(), agentName: "build", toolCallIdentity: identity } satisfies ActiveProcessorProjection
}

/** Start a busy runner whose active processor is `projection`; resolves once it is active. */
const startActive = Effect.fn("test.startActive")(function* (sessionID: SessionID, projection: ActiveProcessorProjection) {
  const state = yield* SessionRunState.Service
  const active = yield* Deferred.make<void>()
  const finish = yield* Deferred.make<void>()
  const fiber = yield* state
    .ensureRunning(
      sessionID,
      interrupted,
      state
        .withActiveProcessor(
          sessionID,
          projection,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as({} as MessageV2.WithParts),
          ),
        ),
    )
    .pipe(Effect.forkChild)
  yield* Deferred.await(active)
  return { fiber, finish }
})

describe("deferred MCP call lifecycle (actual SessionRunState)", () => {
  const nativeIdentity = (sessionID: SessionID, assistantID: MessageID) =>
    Effect.succeed({ sessionID, messageID: assistantID, partID: PartID.ascending(), toolKey: "mcp_dispatch" })

  it.instance("cancel while the identity lookup is suspended: no underlying effect, binding never appears", () =>
    Effect.gen(function* () {
      const state = yield* SessionRunState.Service
      const sessionID = SessionID.descending()
      const assistantID = MessageID.ascending()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let effects = 0
      const projection = projectionFor(assistantID, () =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(nativeIdentity(sessionID, assistantID)),
        ),
      )
      yield* startActive(sessionID, projection)

      const call = yield* state
        .withDeferredMcpToolCall(sessionID, assistantID, "call-1", "rhythm_ping", Effect.sync(() => ++effects))
        .pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.await(entered)
      yield* state.cancel(sessionID)
      yield* Deferred.succeed(release, undefined)

      expect(Exit.isFailure(yield* Fiber.join(call))).toBe(true)
      expect(effects).toBe(0)
      expect(yield* state.activeToolCall(sessionID, assistantID, "call-1")).toBeUndefined()
    }),
  )

  it.instance("replacement runner/projection after the old identity suspends: stale call has no effect", () =>
    Effect.gen(function* () {
      const state = yield* SessionRunState.Service
      const sessionID = SessionID.descending()
      const oldAssistant = MessageID.ascending()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let effects = 0
      const oldProjection = projectionFor(oldAssistant, () =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(nativeIdentity(sessionID, oldAssistant)),
        ),
      )
      const old = yield* startActive(sessionID, oldProjection)
      const call = yield* state
        .withDeferredMcpToolCall(sessionID, oldAssistant, "call-1", "rhythm_ping", Effect.sync(() => ++effects))
        .pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.await(entered)

      // Old run finishes; a new run with a different projection takes the session.
      yield* Deferred.succeed(old.finish, undefined)
      yield* Fiber.await(old.fiber)
      const newAssistant = MessageID.ascending()
      const replacement = yield* startActive(
        sessionID,
        projectionFor(newAssistant, () => nativeIdentity(sessionID, newAssistant)),
      )
      yield* Deferred.succeed(release, undefined)

      expect(Exit.isFailure(yield* Fiber.join(call))).toBe(true)
      expect(effects).toBe(0)
      expect(yield* state.activeToolCall(sessionID, oldAssistant, "call-1")).toBeUndefined()
      yield* Deferred.succeed(replacement.finish, undefined)
    }),
  )

  it.instance("valid parallel calls run once each with isolated bindings, cleaned on success and failure", () =>
    Effect.gen(function* () {
      const state = yield* SessionRunState.Service
      const sessionID = SessionID.descending()
      const assistantID = MessageID.ascending()
      yield* startActive(sessionID, projectionFor(assistantID, () => nativeIdentity(sessionID, assistantID)))
      const seen = (callID: string) =>
        state.activeToolCall(sessionID, assistantID, callID).pipe(Effect.map((call) => call?.toolKey))

      const [a, b] = yield* Effect.all(
        [
          state.withDeferredMcpToolCall(sessionID, assistantID, "call-a", "rhythm_ping", seen("call-a")),
          state.withDeferredMcpToolCall(sessionID, assistantID, "call-b", "rhythm_list_tasks", seen("call-b")),
        ],
        { concurrency: "unbounded" },
      )
      expect(a).toBe("rhythm_ping")
      expect(b).toBe("rhythm_list_tasks")
      expect(yield* seen("call-a")).toBe("mcp_dispatch")

      const failed = yield* state
        .withDeferredMcpToolCall(sessionID, assistantID, "call-c", "rhythm_ping", Effect.fail("boom"))
        .pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      expect(yield* seen("call-c")).toBe("mcp_dispatch")
    }),
  )
})

describe("deferred MCP active-call bindings", () => {
  test("binds the selected tool to its real native mcp_dispatch call, never a synthetic call", () => {
    const bindings = createDeferredMcpToolBindings()
    const release = bindings.bind({
      outerToolCallID: "native-call-1",
      outerToolKey: "mcp_dispatch",
      deferredToolKey: "rhythm_rhythm_search_memory",
    })

    expect(bindings.resolve("native-call-1", "mcp_dispatch")).toBe("rhythm_rhythm_search_memory")
    expect(bindings.resolve("forged-call", "mcp_dispatch")).toBeUndefined()
    expect(bindings.resolve("native-call-1", "rhythm_rhythm_search_memory")).toBeUndefined()
    if (!release) throw new Error("expected a valid deferred binding")
    release()
    expect(bindings.resolve("native-call-1", "mcp_dispatch")).toBeUndefined()
  })

  test("rejects invalid outer identities and keeps parallel deferred calls isolated", () => {
    const bindings = createDeferredMcpToolBindings()
    const rejected = bindings.bind({
      outerToolCallID: "native-call-1",
      outerToolKey: "rhythm_rhythm_search_memory",
      deferredToolKey: "rhythm_rhythm_search_memory",
    })
    const releaseA = bindings.bind({
      outerToolCallID: "native-call-a",
      outerToolKey: "mcp_dispatch",
      deferredToolKey: "rhythm_rhythm_search_memory",
    })
    const releaseB = bindings.bind({
      outerToolCallID: "native-call-b",
      outerToolKey: "mcp_dispatch",
      deferredToolKey: "rhythm_rhythm_search_dayflow_activity",
    })

    expect(rejected).toBeUndefined()
    expect(bindings.resolve("native-call-a", "mcp_dispatch")).toBe("rhythm_rhythm_search_memory")
    expect(bindings.resolve("native-call-b", "mcp_dispatch")).toBe("rhythm_rhythm_search_dayflow_activity")
    releaseA?.()
    expect(bindings.resolve("native-call-a", "mcp_dispatch")).toBeUndefined()
    expect(bindings.resolve("native-call-b", "mcp_dispatch")).toBe("rhythm_rhythm_search_dayflow_activity")
    releaseB?.()
  })

  test("cancellation or runner cleanup makes a stale binding unresolvable", () => {
    const bindings = createDeferredMcpToolBindings()
    bindings.bind({
      outerToolCallID: "native-call-cancelled",
      outerToolKey: "mcp_dispatch",
      deferredToolKey: "rhythm_rhythm_search_memory",
    })

    bindings.clear()
    expect(bindings.resolve("native-call-cancelled", "mcp_dispatch")).toBeUndefined()
  })
})
