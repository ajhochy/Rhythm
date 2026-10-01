import { afterEach, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { Bus } from "../../src/bus"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session/session"
import { MessageID, PartID } from "../../src/session/schema"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { Storage } from "../../src/storage/storage"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const reads = { fullMessages: 0, diffCalls: 0, hold: false, failNext: false }
let entered: Deferred.Deferred<void> | undefined
let release: Deferred.Deferred<void> | undefined

const monitoredSession = Layer.effect(
  Session.Service,
  Effect.gen(function* () {
    const real = yield* Session.Service
    return Session.Service.of({
      ...real,
      messages: (input) => {
        reads.fullMessages++
        return real.messages(input)
      },
    })
  }),
).pipe(Layer.provide(Session.defaultLayer))

const controlledSnapshot = Layer.succeed(
  Snapshot.Service,
  Snapshot.Service.of({
    diffFull: (_from: string, to: string) =>
      Effect.gen(function* () {
        reads.diffCalls++
        if (reads.hold && entered && release) {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
        }
        if (reads.failNext) {
          reads.failNext = false
          return yield* Effect.fail(new Error("synthetic snapshot failure"))
        }
        return [{ file: "small.txt", patch: `+${to}\n`, additions: 1, deletions: 1, status: "modified" as const }]
      }),
  } as unknown as Snapshot.Interface),
)

const deps = Layer.mergeAll(monitoredSession, controlledSnapshot, Storage.defaultLayer, Bus.layer)
const it = testEffect(SessionSummary.layer.pipe(Layer.provideMerge(deps)))

afterEach(async () => {
  await disposeAllInstances()
  reads.fullMessages = 0
  reads.diffCalls = 0
  reads.hold = false
  reads.failNext = false
  entered = undefined
  release = undefined
})

const seed = Effect.fn("SummaryMemoryTest.seed")(function* () {
  const sessions = yield* Session.Service
  const session = yield* sessions.create({})
  const oldID = MessageID.ascending()
  yield* sessions.updateMessage({
    id: oldID,
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() - 1000 },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
    summary: {
      diffs: [{ file: "old.txt", patch: "x".repeat(256 * 1024), additions: 1, deletions: 0 }],
    },
  } as unknown as MessageV2.Info)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: oldID,
    sessionID: session.id,
    type: "text",
    text: "historical tool-sized body ".repeat(10_000),
  } as MessageV2.Part)

  const userID = MessageID.ascending()
  yield* sessions.updateMessage({
    id: userID,
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as MessageV2.Info)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: userID,
    sessionID: session.id,
    type: "step-start",
    snapshot: "before",
  } as MessageV2.Part)
  const assistantID = MessageID.ascending()
  yield* sessions.updateMessage({
    id: assistantID,
    sessionID: session.id,
    role: "assistant",
    parentID: userID,
    time: { created: Date.now() + 1 },
    agent: "build",
    providerID: "test",
    modelID: "test",
    path: { cwd: session.directory, root: session.directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as MessageV2.Info)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistantID,
    sessionID: session.id,
    type: "step-finish",
    snapshot: "after",
    reason: "stop",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as MessageV2.Part)
  return { sessionID: session.id, userID }
})

const appendLatestTurn = Effect.fn("SummaryMemoryTest.appendLatestTurn")(function* (
  sessionID: MessageV2.WithParts["info"]["sessionID"],
  label = "new",
) {
  const sessions = yield* Session.Service
  const userID = MessageID.ascending()
  yield* sessions.updateMessage({
    id: userID,
    sessionID,
    role: "user",
    time: { created: Date.now() + 10_000 },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as MessageV2.Info)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: userID,
    sessionID,
    type: "step-start",
    snapshot: `${label}-before`,
  } as MessageV2.Part)
  const assistantID = MessageID.ascending()
  yield* sessions.updateMessage({
    id: assistantID,
    sessionID,
    role: "assistant",
    parentID: userID,
    time: { created: Date.now() + 10_001 },
    agent: "build",
    providerID: "test",
    modelID: "test",
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as MessageV2.Info)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistantID,
    sessionID,
    type: "step-finish",
    snapshot: `${label}-after`,
    reason: "stop",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as MessageV2.Part)
  return userID
})

const waitForUserDiff = Effect.fn("SummaryMemoryTest.waitForUserDiff")(function* (
  sessionID: MessageV2.WithParts["info"]["sessionID"],
  messageID: MessageV2.WithParts["info"]["id"],
  expected: string,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const target = yield* MessageV2.get({ sessionID, messageID })
    if (target.info.role === "user" && target.info.summary && typeof target.info.summary === "object") {
      if (target.info.summary.diffs?.[0]?.patch === expected) return
    }
    yield* Effect.sleep("10 millis")
  }
  throw new Error(`latest user summary was not persisted: ${expected}`)
})

it.instance(
  "issue-1603-c1: summary counts and user diff persist without hydrating historical messages",
  Effect.gen(function* () {
    const { sessionID, userID } = yield* seed()
    const summary = yield* SessionSummary.Service
    const sessions = yield* Session.Service
    yield* summary.summarize({ sessionID, messageID: userID })
    expect(reads.fullMessages).toBe(0)
    const current = yield* sessions.get(sessionID)
    expect(current.summary).toEqual({ additions: 1, deletions: 1, files: 1 })
    const target = yield* MessageV2.get({ sessionID, messageID: userID })
    expect(target?.info.role).toBe("user")
    if (!target || target.info.role !== "user" || !target.info.summary || typeof target.info.summary !== "object")
      throw new Error("expected a user message with a persisted summary")
    expect(target?.info.summary?.diffs).toHaveLength(1)
    expect(target?.info.summary?.diffs?.[0]?.patch).toBe("+after\n")
  }),
)

it.instance(
  "issue-1603-c2: overlapping summary requests coalesce and a failed worker allows retry",
  Effect.gen(function* () {
    const { sessionID, userID } = yield* seed()
    const summary = yield* SessionSummary.Service
    reads.hold = true
    entered = yield* Deferred.make<void>()
    release = yield* Deferred.make<void>()
    const scope = yield* Scope.Scope
    const first = yield* summary.summarize({ sessionID, messageID: userID }).pipe(Effect.forkIn(scope))
    yield* Deferred.await(entered)
    const latestUserID = yield* appendLatestTurn(sessionID)
    const followers = yield* Effect.forEach(
      Array.from({ length: 12 }),
      () => summary.summarize({ sessionID, messageID: latestUserID }).pipe(Effect.forkIn(scope)),
    )
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(first)
    yield* Effect.forEach(followers, Fiber.join, { discard: true })
    expect(reads.diffCalls).toBeLessThanOrEqual(4)
    const latest = yield* MessageV2.get({ sessionID, messageID: latestUserID })
    if (!latest || latest.info.role !== "user" || !latest.info.summary || typeof latest.info.summary !== "object")
      throw new Error("expected latest user message with a persisted summary")
    expect(latest?.info.summary?.diffs?.[0]?.patch).toBe("+new-after\n")

    reads.hold = true
    entered = yield* Deferred.make<void>()
    release = yield* Deferred.make<void>()
    reads.failNext = true
    const failedOwner = yield* summary.summarize({ sessionID, messageID: latestUserID }).pipe(Effect.forkIn(scope))
    yield* Deferred.await(entered)
    const afterFailure = yield* appendLatestTurn(sessionID, "failure")
    const failureFollower = yield* summary.summarize({ sessionID, messageID: afterFailure }).pipe(Effect.forkIn(scope))
    reads.hold = false
    yield* Deferred.succeed(release, undefined)
    const failed = yield* Fiber.join(failedOwner).pipe(Effect.exit)
    expect(Exit.isFailure(failed)).toBe(true)
    yield* Fiber.join(failureFollower)
    yield* waitForUserDiff(sessionID, afterFailure, "+failure-after\n")

    reads.hold = true
    entered = yield* Deferred.make<void>()
    release = yield* Deferred.make<void>()
    const cancelled = yield* summary.summarize({ sessionID, messageID: afterFailure }).pipe(Effect.forkIn(scope))
    yield* Deferred.await(entered)
    const afterCancel = yield* appendLatestTurn(sessionID, "cancel")
    const cancelFollower = yield* summary.summarize({ sessionID, messageID: afterCancel }).pipe(Effect.forkIn(scope))
    const interruption = yield* Fiber.interrupt(cancelled).pipe(Effect.forkIn(scope))
    reads.hold = false
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(interruption)
    yield* Fiber.join(cancelFollower)
    yield* waitForUserDiff(sessionID, afterCancel, "+cancel-after\n")
    const current = yield* Session.Service.use((sessions) => sessions.get(sessionID))
    expect(current.summary).toEqual({ additions: 1, deletions: 1, files: 1 })
  }),
)
