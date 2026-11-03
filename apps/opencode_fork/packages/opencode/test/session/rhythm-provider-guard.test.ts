import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { Effect } from "effect"
import { Storage } from "@/storage/storage"
import {
  buildGuardExport,
  canonicalJson,
  ENGINE_GENERATION,
  enrollGuard,
  GUARD_BOUNDS,
  guardFrameIsCurrent,
  guardInputDigest,
  installGuardFrame,
  markGuardManagedSeen,
  newGuardNonce,
  parseEnrollmentRequest,
  parseGuardExport,
  parseGuardRequest,
  parseGuardResponse,
  parseGuardResponseText,
  parseSourceAnchorQuery,
  readGuardRecord,
  resolveSourceProofs,
  runnerGenerations,
  sha256Hex,
  type GuardFrame,
  type GuardRequest,
  type ProofMessage,
} from "../../src/session/rhythm_provider_guard"
import { testEffect } from "../lib/effect"

// The frozen C0 fixture lives in the task4 artifact directory (shared with the API writer).
const FIXTURE = "/Users/ajhochhalter/Documents/Codex/2026-10-05/task-4/core-dayflow-native-api-contract-fixtures.json"
const FIXTURE_SHA256 = "2c273791cb9c51e3fefa7cd267f5d9d1d4c3d68959e43208ca0f1dc480ddcfc6"
const fixtureTest = existsSync(FIXTURE) ? test : test.skip
const fixture = () => {
  const text = readFileSync(FIXTURE, "utf8")
  return { text, json: JSON.parse(text) as Record<string, any> }
}

describe("C0 fixture conformance", () => {
  fixtureTest("fixture is the frozen, hash-pinned C0 artifact", () => {
    expect(createHash("sha256").update(fixture().text).digest("hex")).toBe(FIXTURE_SHA256)
  })

  fixtureTest("canonical digests of every fixture input reproduce the frozen requests", () => {
    const { json } = fixture()
    for (const name of ["answer", "toolLoop", "transportRetry", "compaction", "summary", "ordinary"]) {
      const material = json.examples.inputMaterials[name]
      expect(guardInputDigest(material.preparedInput, material.originGroups)).toBe(
        json.examples.requests[name].inputDigest,
      )
    }
  })

  fixtureTest("all fixture requests, exports and responses parse; responses echo their request", () => {
    const { json } = fixture()
    for (const request of Object.values(json.examples.requests)) {
      expect(parseGuardRequest(request).ok).toBe(true)
    }
    for (const exported of Object.values(json.examples.exports)) {
      expect(parseGuardExport(exported).ok).toBe(true)
    }
    for (const response of Object.values<any>(json.examples.responses)) {
      const parsed = parseGuardResponse(response, response.request)
      expect(parsed.ok).toBe(true)
    }
    expect(parseEnrollmentRequest(json.examples.enrollmentRequest).ok).toBe(true)
    expect(json.examples.enrollmentResponse).toEqual({
      schemaVersion: 1,
      sdkSessionId: "ses_fixture_managed",
      engineGeneration: "engine_fixture_1",
      guarded: true,
    })
  })

  fixtureTest("fixture bounds match the implemented constants", () => {
    const { bounds } = fixture().json
    expect(bounds.requestUtf8Bytes).toBe(GUARD_BOUNDS.requestBytes)
    expect(bounds.responseUtf8Bytes).toBe(GUARD_BOUNDS.responseBytes)
    expect(bounds.exportUtf8Bytes).toBe(GUARD_BOUNDS.exportBytes)
    expect(bounds.overlayUtf8Bytes).toBe(GUARD_BOUNDS.overlayBytes)
    expect(bounds.sourceAnchors).toBe(GUARD_BOUNDS.sourceAnchors)
    expect(bounds.derivedSummaryIdsTotal).toBe(GUARD_BOUNDS.derivedSummaryIds)
    expect(bounds.exchangeDeadlineMs).toBe(GUARD_BOUNDS.exchangeDeadlineMs)
  })
})

const request: GuardRequest = {
  schemaVersion: 1,
  sdkSessionId: "ses_a",
  userMessageId: "msg_user",
  requestNonce: "AAAAAAAAAAAAAAAAAAAAAAAA",
  engineGeneration: "eng_1",
  runnerGeneration: "run_1",
  attempt: 0,
  purpose: "answer",
  inputDigest: "a".repeat(64),
}
const overlayText = "[Dayflow qualified context]\nSYNTHETIC\n[/Dayflow qualified context]"
const response = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  request,
  decision: "allow",
  rawHistoryReusable: true,
  guardRegistrationVersion: 1,
  basisDigest: "b".repeat(64),
  overlay: { text: overlayText, sha256: sha256Hex(overlayText) },
  projection: null,
  reason: "none",
  ...over,
})

describe("strict admission parsing", () => {
  test("generated nonces satisfy the contract and digests are canonical", () => {
    expect(parseGuardRequest({ ...request, requestNonce: newGuardNonce() }).ok).toBe(true)
    expect(canonicalJson({ b: [2, { z: 1, a: "é🙂" }], a: null })).toBe('{"a":null,"b":[2,{"a":"é🙂","z":1}]}')
    expect(guardInputDigest({ x: 1 }, [])).toBe(sha256Hex('{"originGroups":[],"preparedInput":{"x":1}}'))
  })

  test("requests reject extra keys, bad versions, nonce, attempt, purpose and digest", () => {
    expect(parseGuardRequest({ ...request, extra: 1 }).ok).toBe(false)
    expect(parseGuardRequest({ ...request, schemaVersion: 2 }).ok).toBe(false)
    expect(parseGuardRequest({ ...request, requestNonce: "short" }).ok).toBe(false)
    expect(parseGuardRequest({ ...request, requestNonce: "A".repeat(23) + "!" }).ok).toBe(false)
    expect(parseGuardRequest({ ...request, attempt: 101 }).ok).toBe(false)
    expect(parseGuardRequest({ ...request, attempt: 1.5 }).ok).toBe(false)
    expect(parseGuardRequest({ ...request, purpose: "title" }).ok).toBe(false)
    expect(parseGuardRequest({ ...request, inputDigest: "A".repeat(64) }).ok).toBe(false)
    expect(parseGuardRequest({ ...request, sdkSessionId: "x".repeat(201) }).ok).toBe(false)
  })

  test("responses must echo the exact request and follow the cross-field rules", () => {
    expect(parseGuardResponse(response(), request).ok).toBe(true)
    expect(parseGuardResponse(response({ request: { ...request, requestNonce: "B".repeat(24) } }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ request: { ...request, attempt: 1 } }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ extra: true }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ schemaVersion: 2 }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ guardRegistrationVersion: 2 }), request).ok).toBe(false)
    // ordinary: nothing to inject
    const ordinary = { decision: "ordinary", overlay: null }
    expect(parseGuardResponse(response(ordinary), request).ok).toBe(true)
    expect(parseGuardResponse(response({ ...ordinary, rawHistoryReusable: false }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ decision: "ordinary" }), request).ok).toBe(false)
    // allow: no projection, history reusable
    expect(parseGuardResponse(response({ rawHistoryReusable: false }), request).ok).toBe(false)
    // project: needs a projection that includes its from-anchor; raw reuse forbidden
    const projection = { fromUserMessageId: "msg_a", sourceAnchorIds: ["msg_a", "msg_b"] }
    const project = { decision: "project", rawHistoryReusable: false, projection, reason: "source_changed" }
    expect(parseGuardResponse(response(project), request).ok).toBe(true)
    expect(parseGuardResponse(response({ ...project, projection: null }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ ...project, rawHistoryReusable: true }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ ...project, projection: { ...projection, fromUserMessageId: "msg_z" } }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ ...project, projection: { ...projection, sourceAnchorIds: ["msg_a", "msg_a"] } }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ ...project, projection: { ...projection, sourceAnchorIds: [] } }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ ...project, reason: "none" }), request).ok).toBe(false)
    // hold: nothing released
    const hold = { decision: "hold", rawHistoryReusable: false, overlay: null, reason: "proof_unavailable" }
    expect(parseGuardResponse(response(hold), request).ok).toBe(true)
    expect(parseGuardResponse(response({ ...hold, overlay: response().overlay }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ ...hold, reason: "none" }), request).ok).toBe(false)
  })

  test("overlay bound, digest and response size are enforced; malformed text is rejected", () => {
    const big = "é".repeat(2000)
    expect(parseGuardResponse(response({ overlay: { text: big, sha256: sha256Hex(big) } }), request).ok).toBe(false)
    expect(parseGuardResponse(response({ overlay: { text: overlayText, sha256: "c".repeat(64) } }), request).ok).toBe(false)
    expect(parseGuardResponseText(JSON.stringify(response()), request).ok).toBe(true)
    expect(parseGuardResponseText("not json", request).ok).toBe(false)
    expect(parseGuardResponseText(" ".repeat(GUARD_BOUNDS.responseBytes + 1) + JSON.stringify(response()), request).ok).toBe(false)
  })

  test("export and query parsers are strict", () => {
    expect(parseSourceAnchorQuery(undefined)).toEqual({ ok: true, value: [] })
    expect(parseSourceAnchorQuery('["msg_a","msg_b"]')).toEqual({ ok: true, value: ["msg_a", "msg_b"] })
    expect(parseSourceAnchorQuery('["msg_a","msg_a"]').ok).toBe(false)
    expect(parseSourceAnchorQuery("nope").ok).toBe(false)
    expect(parseSourceAnchorQuery(JSON.stringify(Array.from({ length: 65 }, (_, i) => `m${i}`))).ok).toBe(false)
    expect(parseSourceAnchorQuery('[""]').ok).toBe(false)
    expect(parseGuardExport({ schemaVersion: 1, status: "cancelled", extra: 1 }).ok).toBe(false)
    expect(parseGuardExport({ schemaVersion: 1, status: "other" }).ok).toBe(false)
    expect(parseEnrollmentRequest({ schemaVersion: 1, guarded: false }).ok).toBe(false)
    expect(parseEnrollmentRequest({ schemaVersion: 1, guarded: true, extra: 1 }).ok).toBe(false)
  })
})

const frameFor = (over: Partial<GuardFrame> & { nonce?: string; runner?: string } = {}): GuardFrame & { abort: AbortController } => {
  const abort = new AbortController()
  return {
    request: {
      ...request,
      requestNonce: over.nonce ?? newGuardNonce(),
      runnerGeneration: over.runner ?? "run_1",
    },
    agentName: "secretary",
    userKind: "authored",
    initiatingUserMessageId: null,
    inputGroupCount: 3,
    originCoverage: "complete",
    visibleMessageIds: new Set(["msg_old", "msg_user"]),
    signal: abort.signal,
    ...over,
    abort,
  } as GuardFrame & { abort: AbortController }
}

describe("transient pending frames", () => {
  // A frame is pending only under the SDK's positively current runner generation.
  beforeEach(() => runnerGenerations.set("ses_a", "run_1"))
  afterEach(() => runnerGenerations.delete("ses_a"))

  test("pending until released; then not_pending; export keys are exact", () => {
    const frame = frameFor()
    const release = installGuardFrame(frame)
    const pending = buildGuardExport("ses_a", frame.request.requestNonce, [], () => [])
    expect(pending).toMatchObject({ status: "pending", agentName: "secretary", inputGroupCount: 3, originCoverage: "complete" })
    expect(parseGuardExport(pending).ok).toBe(true)
    expect(guardFrameIsCurrent(frame)).toBe(true)
    release()
    expect(buildGuardExport("ses_a", frame.request.requestNonce, [], () => [])).toEqual({ schemaVersion: 1, status: "not_pending" })
    expect(guardFrameIsCurrent(frame)).toBe(false)
    expect(buildGuardExport("ses_other", frame.request.requestNonce, [], () => [])).toEqual({ schemaVersion: 1, status: "not_pending" })
  })

  test("abort reads as cancelled; a newer frame makes the older one replaced; runner change replaces", () => {
    const first = frameFor()
    const releaseFirst = installGuardFrame(first)
    first.abort.abort()
    expect(buildGuardExport("ses_a", first.request.requestNonce, [], () => [])).toEqual({ schemaVersion: 1, status: "cancelled" })
    expect(guardFrameIsCurrent(first)).toBe(false)
    releaseFirst()

    const older = frameFor()
    const releaseOlder = installGuardFrame(older)
    const newer = frameFor()
    const releaseNewer = installGuardFrame(newer)
    expect(buildGuardExport("ses_a", older.request.requestNonce, [], () => [])).toEqual({ schemaVersion: 1, status: "replaced" })
    expect(guardFrameIsCurrent(newer)).toBe(true)
    releaseOlder()
    releaseNewer()

    const stale = frameFor({ runner: "run_old" })
    const releaseStale = installGuardFrame(stale)
    runnerGenerations.set("ses_a", "run_new")
    expect(buildGuardExport("ses_a", stale.request.requestNonce, [], () => [])).toEqual({ schemaVersion: 1, status: "replaced" })
    runnerGenerations.delete("ses_a")
    releaseStale()
  })
})

describe("source proofs from native storage order", () => {
  const message = (id: string, role: string, extra: Partial<ProofMessage["info"]> = {}, parts: ProofMessage["parts"] = []): ProofMessage => ({
    info: { id, role, ...extra },
    parts,
  })
  const history: ProofMessage[] = [
    message("msg_old", "user"),
    message("msg_old_answer", "assistant"),
    message("msg_tail", "user"),
    message("msg_control", "user", {}, [{ type: "compaction", tail_start_id: "msg_tail" }]),
    message("msg_summary", "assistant", { parentID: "msg_control", summary: true }),
    message("msg_user", "user"),
  ]
  test("stored/visible/relation and derived summaries; unknown anchors stay unknown", () => {
    const frame = frameFor()
    const proofs = resolveSourceProofs(history, frame, ["msg_old", "msg_tail", "msg_user", "msg_missing"])
    expect(proofs).toEqual([
      { sourceAnchorId: "msg_old", stored: true, visible: true, relation: "before_current", derivedSummaryIds: ["msg_summary"] },
      { sourceAnchorId: "msg_tail", stored: true, visible: false, relation: "before_current", derivedSummaryIds: [] },
      { sourceAnchorId: "msg_user", stored: true, visible: true, relation: "current", derivedSummaryIds: [] },
      { sourceAnchorId: "msg_missing", stored: false, visible: false, relation: "unknown", derivedSummaryIds: [] },
    ])
  })
  test("a current message that is not stored makes every relation unknown", () => {
    const frame = frameFor()
    const proofs = resolveSourceProofs(history.slice(0, 2), { ...frame, request: { ...frame.request, userMessageId: "msg_gone" } }, ["msg_old"])
    expect(proofs[0].relation).toBe("unknown")
  })
})

const it = testEffect(Storage.defaultLayer)

describe("monotonic managed/enrolled SDK record", () => {
  it.instance("absent -> managed-seen -> enrolled; never clears; idempotent; engine generation echoed", () =>
    Effect.gen(function* () {
      const id = `ses_guard_${newGuardNonce()}`
      expect(yield* readGuardRecord(id)).toEqual({ state: "absent" })
      yield* markGuardManagedSeen(id)
      expect(yield* readGuardRecord(id)).toEqual({ state: "record", record: { schemaVersion: 1, managedSeen: true, guarded: false } })
      const enrolled = yield* enrollGuard(id)
      expect(enrolled).toEqual({ schemaVersion: 1, sdkSessionId: id, engineGeneration: ENGINE_GENERATION, guarded: true })
      yield* markGuardManagedSeen(id)
      yield* enrollGuard(id)
      expect(yield* readGuardRecord(id)).toEqual({ state: "record", record: { schemaVersion: 1, managedSeen: true, guarded: true } })
    }),
  )

  it.instance("enrollment alone also classifies managed; concurrent writers cannot lose guarded", () =>
    Effect.gen(function* () {
      const id = `ses_guard_${newGuardNonce()}`
      yield* Effect.all([enrollGuard(id), markGuardManagedSeen(id), markGuardManagedSeen(id), enrollGuard(id)], { concurrency: "unbounded" })
      expect(yield* readGuardRecord(id)).toEqual({ state: "record", record: { schemaVersion: 1, managedSeen: true, guarded: true } })
    }),
  )

  it.instance("unsafe ids are refused (error state, no write); a corrupt record is error, not absent", () =>
    Effect.gen(function* () {
      expect(yield* readGuardRecord("../escape")).toEqual({ state: "error" })
      const exit = yield* Effect.exit(enrollGuard("../escape"))
      expect(exit._tag).toBe("Failure")
      const storage = yield* Storage.Service
      const id = `ses_guard_${newGuardNonce()}`
      yield* storage.write(["rhythm", "dayflow-guard", id], { schemaVersion: 1, managedSeen: "yes" })
      expect(yield* readGuardRecord(id)).toEqual({ state: "error" })
      // enrolling over unknown prior state writes the protective superset
      yield* enrollGuard(id)
      expect(yield* readGuardRecord(id)).toEqual({ state: "record", record: { schemaVersion: 1, managedSeen: true, guarded: true } })
    }),
  )
})
