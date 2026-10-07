import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Storage } from "@/storage/storage"
import { testEffect } from "../lib/effect"
import {
  ENGINE_GENERATION, buildGuardExport, guardFrameIsCurrent, installGuardFrame,
  markGuardManagedSeen, newGuardNonce, readGuardRecord, runnerGenerations,
  type GuardFrame,
} from "../../src/session/rhythm_provider_guard"

const it = testEffect(Storage.defaultLayer)
it.instance("Sol C1 negative: corrupt protected record cannot become unguarded after managed-seen", () =>
  Effect.gen(function* () {
    const id = `ses_sol_${newGuardNonce()}`
    const storage = yield* Storage.Service
    yield* storage.write(["rhythm", "dayflow-guard", id], {
      schemaVersion: 1, managedSeen: "corrupt", guarded: true,
    })
    expect(yield* readGuardRecord(id)).toEqual({ state: "error" })
    yield* markGuardManagedSeen(id)
    const after = yield* readGuardRecord(id)
    expect(after.state === "error" || (after.state === "record" && after.record.guarded === true)).toBe(true)
  }),
)

test("Sol C1 negative: deleting the actual current runner cannot leave its frame pending", () => {
  const sdk = `ses_sol_${newGuardNonce()}`
  const generation = "run_sol_actual"
  const frame: GuardFrame = {
    request: {
      schemaVersion: 1, sdkSessionId: sdk, userMessageId: "msg_sol_current",
      requestNonce: newGuardNonce(), engineGeneration: ENGINE_GENERATION,
      runnerGeneration: generation, attempt: 0, purpose: "answer", inputDigest: "a".repeat(64),
    },
    agentName: "secretary", userKind: "authored", initiatingUserMessageId: null,
    inputGroupCount: 1, originCoverage: "complete",
    visibleMessageIds: new Set(["msg_sol_current"]), signal: new AbortController().signal,
  }
  runnerGenerations.set(sdk, generation)
  const release = installGuardFrame(frame)
  try {
    expect(guardFrameIsCurrent(frame)).toBe(true)
    expect(buildGuardExport(sdk, frame.request.requestNonce, [], () => []).status).toBe("pending")
    runnerGenerations.delete(sdk)
    expect({
      current: guardFrameIsCurrent(frame),
      exportStatus: buildGuardExport(sdk, frame.request.requestNonce, [], () => []).status,
    }).toEqual({ current: false, exportStatus: "replaced" })
  } finally {
    release()
    runnerGenerations.delete(sdk)
  }
})
