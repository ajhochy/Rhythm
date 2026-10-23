/**
 * #112 lower-layer isolation: real guard middleware/frame lifecycle, with only
 * the existing admission transport seam replaced by deferred ordinary DTOs.
 * No sockets, API server, model service, source credentials or guard bypass.
 * These controls preserve supersession; orchestration must avoid the overlap.
 */
import { afterEach, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { Effect, Fiber, Scope } from "effect"
import { SessionRunState } from "../../src/session/run-state"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { buildGuardExport, lookupGuardFrame, guardFrameStatus, runnerGenerations,
  parseGuardRequest, type GuardRequest, type GuardPurpose } from "../../src/session/rhythm_provider_guard"
import { guardTransport, providerGuardMiddleware, resetGuardCaches,
  RhythmProviderGuardHold, type GuardAttemptContext } from "../../src/session/rhythm_provider_projection"

const originalFetch = guardTransport.fetch
const owned = new Set<string>()
afterEach(() => {
  guardTransport.fetch = originalFetch
  for (const sdk of owned) runnerGenerations.delete(sdk)
  owned.clear()
  resetGuardCaches()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function setup() {
  const sdk = `ses_title_${randomUUID().replaceAll("-", "")}`
  let generation = `run_${randomUUID().replaceAll("-", "")}`
  runnerGenerations.set(sdk, generation)
  owned.add(sdk)
  const calls: Array<{ request: GuardRequest; release: () => void }> = []
  const arrived = [deferred<void>(), deferred<void>()]
  guardTransport.fetch = async (_url, init) => {
    const parsed = parseGuardRequest(JSON.parse(String(init.body)))
    if (!parsed.ok) throw new Error("test admission received malformed production request")
    const request = parsed.value
    expect(request.sdkSessionId).toBe(sdk)
    expect(request.runnerGeneration).toBe(generation)
    const response = deferred<Response>()
    const index = calls.length
    calls.push({ request, release: () => response.resolve(new Response(JSON.stringify({
      schemaVersion: 1, request, decision: "ordinary", rawHistoryReusable: true,
      guardRegistrationVersion: 1, basisDigest: "b".repeat(64), overlay: null,
      projection: null, reason: "none",
    }), { status: 200 })) })
    arrived[index]?.resolve()
    return response.promise
  }
  const outcome = (purpose: GuardPurpose, signal = new AbortController().signal, userMessageId = "msg_title_first") => {
    const context: GuardAttemptContext = { sdkSessionId: sdk, userMessageId,
      agentName: purpose === "summary" ? "title" : "build", purpose, userKind: "authored",
      initiatingUserMessageId: null, origins: undefined, userSystem: undefined,
      record: { schemaVersion: 1, managedSeen: true, guarded: false },
      integration: { url: "http://127.0.0.1:1", token: "synthetic-never-transmitted" },
      signal, isWorkflow: false }
    return providerGuardMiddleware(context).transformParams!({ type: "stream",
      params: { prompt: [{ role: "user", content: [{ type: "text", text: "synthetic first turn" }] }] },
      model: {} as never,
    }).then(() => ({ status: "admitted" as const }), error => {
      expect(error).toBeInstanceOf(RhythmProviderGuardHold)
      return { status: "held" as const, reason: (error as RhythmProviderGuardHold).reason }
    })
  }
  const state = (index: number) => {
    const frame = lookupGuardFrame(sdk, calls[index].request.requestNonce)
    expect(frame).toBeDefined()
    return { generationPresent: runnerGenerations.get(sdk) === generation,
      frameStatus: guardFrameStatus(frame!), exportStatus: buildGuardExport(sdk, frame!.request.requestNonce, [], () => []).status }
  }
  return { sdk, get generation() { return generation }, calls, arrived, outcome, state,
    adoptActualRunner() { generation = runnerGenerations.get(sdk)!; expect(generation).toBeString() } }
}

test("#112 control: sequential summary and answer both pass real ordinary admission", async () => {
  const h = setup()
  const title = h.outcome("summary")
  await h.arrived[0].promise
  expect(h.state(0)).toEqual({ generationPresent: true, frameStatus: "pending", exportStatus: "pending" })
  h.calls[0].release()
  expect(await title).toEqual({ status: "admitted" })
  const answer = h.outcome("answer")
  await h.arrived[1].promise
  expect(h.state(1).frameStatus).toBe("pending")
  h.calls[1].release()
  expect(await answer).toEqual({ status: "admitted" })
})

for (const older of ["summary", "answer"] as const) test(`#112 isolation: ${older} is replaced by overlapping ${older === "summary" ? "answer" : "summary"} despite current generation and valid API response`, async () => {
  const h = setup()
  const first = h.outcome(older)
  await h.arrived[0].promise
  const second = h.outcome(older === "summary" ? "answer" : "summary")
  await h.arrived[1].promise
  expect(h.state(0)).toEqual({ generationPresent: true, frameStatus: "replaced", exportStatus: "replaced" })
  expect(h.state(1)).toEqual({ generationPresent: true, frameStatus: "pending", exportStatus: "pending" })
  h.calls[0].release()
  expect(await first).toEqual({ status: "held", reason: "proof_unavailable" })
  expect(runnerGenerations.get(h.sdk)).toBe(h.generation)
  h.calls[1].release()
  expect(await second).toEqual({ status: "admitted" })
})

test("#112 security control: newer answer supersedes an older answer", async () => {
  const h = setup()
  const first = h.outcome("answer")
  await h.arrived[0].promise
  const second = h.outcome("answer")
  await h.arrived[1].promise
  expect(h.state(0).frameStatus).toBe("replaced")
  h.calls[0].release()
  expect(await first).toEqual({ status: "held", reason: "proof_unavailable" })
  h.calls[1].release()
  expect(await second).toEqual({ status: "admitted" })
})

for (const cause of ["aborted", "missing-runner", "replaced-runner"] as const) test(`#112 security control: ${cause} cannot expose provider input`, async () => {
  const h = setup()
  const abort = new AbortController()
  const attempt = h.outcome("answer", abort.signal)
  await h.arrived[0].promise
  if (cause === "aborted") abort.abort()
  else if (cause === "missing-runner") runnerGenerations.delete(h.sdk)
  else runnerGenerations.set(h.sdk, "run_replaced")
  expect(h.state(0).exportStatus).toBe(cause === "aborted" ? "cancelled" : "replaced")
  h.calls[0].release()
  expect(await attempt).toEqual({ status: "held", reason: "proof_unavailable" })
})

test("#112 Effect control: forkIn title defect does not itself close the parent scope or remove the runner", async () => {
  const h = setup()
  await Effect.runPromise(Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const title = yield* Effect.tryPromise(() => h.outcome("summary").then(result => {
      if (result.status === "held") throw new RhythmProviderGuardHold(result.reason)
    })).pipe(Effect.orDie, Effect.ignore, Effect.forkIn(scope))
    yield* Effect.promise(() => h.arrived[0].promise)
    const answer = h.outcome("answer")
    yield* Effect.promise(() => h.arrived[1].promise)
    h.calls[0].release()
    const titleExit = yield* Fiber.await(title)
    expect(titleExit._tag).toBe("Failure")
    expect(h.state(1)).toEqual({ generationPresent: true, frameStatus: "pending", exportStatus: "pending" })
    h.calls[1].release()
    expect(yield* Effect.promise(() => answer)).toEqual({ status: "admitted" })
  }).pipe(Effect.scoped))
})


test("#112 security control: a newer user invalidates an older summary in the same runner", async () => {
  const h = setup()
  const first = h.outcome("summary")
  await h.arrived[0].promise
  const second = h.outcome("answer", new AbortController().signal, "msg_title_next_user")
  await h.arrived[1].promise
  expect(h.calls[0].request.userMessageId).not.toBe(h.calls[1].request.userMessageId)
  expect(h.state(0).frameStatus).toBe("replaced")
  h.calls[0].release()
  expect(await first).toEqual({ status: "held", reason: "proof_unavailable" })
  h.calls[1].release()
  expect(await second).toEqual({ status: "admitted" })
})

const runnerTest = testEffect(SessionRunState.defaultLayer)
runnerTest.instance("#112 cascade: title replaces answer; actual runner idle then invalidates title, yielding zero admissions", () => Effect.gen(function* () {
  const h = setup()
  const runs = yield* SessionRunState.Service
  const scope = yield* Scope.Scope
  const run = yield* runs.ensureRunning(SessionID.make(h.sdk), Effect.die("unexpected interruption"),
    Effect.promise(async () => {
      h.adoptActualRunner()
      const result = await h.outcome("answer")
      if (result.status === "held") throw new RhythmProviderGuardHold(result.reason)
      return { info: {}, parts: [] } as never
    }),
  ).pipe(Effect.exit, Effect.forkIn(scope))
  yield* Effect.promise(() => h.arrived[0].promise)
  const title = h.outcome("summary")
  yield* Effect.promise(() => h.arrived[1].promise)
  expect(h.state(0)).toEqual({ generationPresent: true, frameStatus: "replaced", exportStatus: "replaced" })
  expect(h.state(1)).toEqual({ generationPresent: true, frameStatus: "pending", exportStatus: "pending" })
  h.calls[0].release()
  const exit = yield* Fiber.join(run)
  expect(exit._tag).toBe("Failure")
  // No test code deletes this generation: production SessionRunState.onIdle does it.
  expect(runnerGenerations.has(h.sdk)).toBe(false)
  expect(h.state(1)).toEqual({ generationPresent: false, frameStatus: "replaced", exportStatus: "replaced" })
  h.calls[1].release()
  expect(yield* Effect.promise(() => title)).toEqual({ status: "held", reason: "proof_unavailable" })
}))
