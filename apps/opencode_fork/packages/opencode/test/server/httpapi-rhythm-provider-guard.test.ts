import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Server } from "../../src/server/server"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import {
  ENGINE_GENERATION,
  guardInputDigest,
  installGuardFrame,
  newGuardNonce,
  parseGuardExport,
  readGuardRecord,
  runnerGenerations,
  type GuardFrame,
} from "../../src/session/rhythm_provider_guard"
import { Storage } from "@/storage/storage"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const instanceStoreLayer = InstanceStore.defaultLayer.pipe(
  Layer.provide(
    Layer.succeed(InstanceBootstrapService.Service, InstanceBootstrapService.Service.of({ run: Effect.void })),
  ),
)
const it = testEffect(Layer.mergeAll(instanceStoreLayer, Project.defaultLayer, Session.defaultLayer, Storage.defaultLayer))

const pathFor = (path: string, params: Record<string, string>) =>
  Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
const request = (path: string, init?: RequestInit) => Effect.promise(async () => Server.Default().app.request(path, init))
const body = (response: Response) => Effect.promise(() => response.json())

afterEach(async () => {
  delete process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS
  await disposeAllInstances()
  await resetDatabase()
})

const withExports = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = "1"
    }),
    () => effect,
    () =>
      Effect.sync(() => {
        delete process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS
      }),
  )

const frameFor = (sdkSessionId: string, userMessageId: string, nonce = newGuardNonce()) => {
  const abort = new AbortController()
  const frame: GuardFrame = {
    request: {
      schemaVersion: 1,
      sdkSessionId,
      userMessageId,
      requestNonce: nonce,
      engineGeneration: ENGINE_GENERATION,
      runnerGeneration: "run_route_test",
      attempt: 0,
      purpose: "answer",
      inputDigest: guardInputDigest({ synthetic: true }, []),
    },
    agentName: "secretary",
    userKind: "authored",
    initiatingUserMessageId: null,
    inputGroupCount: 1,
    originCoverage: "complete",
    visibleMessageIds: new Set([userMessageId]),
    signal: abort.signal,
  }
  return { frame, abort }
}

describe("Rhythm provider-frame / Dayflow-guard routes", () => {
  it.instance(
    "exports are disabled by default (404) and write nothing",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const svc = yield* Session.Service
        const session = yield* svc.create({ title: "guard routes" })
        const frame = yield* request(
          pathFor(SessionPaths.rhythmProviderFrame, { sessionID: session.id, requestNonce: newGuardNonce() }),
          { headers },
        )
        expect(frame.status).toBe(404)
        const enroll = yield* request(pathFor(SessionPaths.rhythmDayflowGuard, { sessionID: session.id }), {
          headers,
          method: "POST",
          body: JSON.stringify({ schemaVersion: 1, guarded: true }),
        })
        expect(enroll.status).toBe(404)
        expect(yield* readGuardRecord(session.id)).toEqual({ state: "absent" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "enrollment is exact, durable, idempotent and monotonic; invalid bodies are 400",
    () =>
      withExports(
        Effect.gen(function* () {
          const test = yield* TestInstance
          const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
          const svc = yield* Session.Service
          const session = yield* svc.create({ title: "guard enroll" })
          const post = (payload: unknown) =>
            request(pathFor(SessionPaths.rhythmDayflowGuard, { sessionID: session.id }), {
              headers,
              method: "POST",
              body: JSON.stringify(payload),
            })
          for (const bad of [
            { schemaVersion: 1, guarded: false },
            { schemaVersion: 2, guarded: true },
            { schemaVersion: 1, guarded: true, extra: 1 },
            { guarded: true },
            "guarded",
          ]) {
            expect((yield* post(bad)).status).toBe(400)
          }
          expect(yield* readGuardRecord(session.id)).toEqual({ state: "absent" })
          const first = yield* post({ schemaVersion: 1, guarded: true })
          expect(first.status).toBe(200)
          const expected = { schemaVersion: 1, sdkSessionId: session.id, engineGeneration: ENGINE_GENERATION, guarded: true }
          expect(yield* body(first)).toEqual(expected)
          expect(yield* body(yield* post({ schemaVersion: 1, guarded: true }))).toEqual(expected)
          expect(yield* readGuardRecord(session.id)).toEqual({
            state: "record",
            record: { schemaVersion: 1, managedSeen: true, guarded: true },
          })
        }),
      ),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "frame export: pending proof with stored-order facts, then replaced / cancelled / not_pending; bad queries are 400",
    () =>
      withExports(
        Effect.gen(function* () {
          const test = yield* TestInstance
          const headers = { "x-opencode-directory": test.directory }
          const svc = yield* Session.Service
          const session = yield* svc.create({ title: "guard export" })
          const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("test") }
          const user = yield* svc.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: session.id,
            agent: "build",
            model,
            time: { created: Date.now() },
          })
          yield* svc.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: user.id,
            type: "text",
            text: "SYNTHETIC_SOURCE_TEXT",
          })
          const get = (nonce: string, query = "") =>
            request(pathFor(SessionPaths.rhythmProviderFrame, { sessionID: session.id, requestNonce: nonce }) + query, {
              headers,
            })

          runnerGenerations.set(session.id, "run_route_test") // positively current runner
          const { frame, abort } = frameFor(session.id, user.id)
          const release = installGuardFrame(frame)
          const anchors = encodeURIComponent(JSON.stringify([user.id, "msg_missing"]))
          const pending = yield* get(frame.request.requestNonce, `?sourceAnchorIds=${anchors}`)
          expect(pending.status).toBe(200)
          const payload = yield* body(pending)
          expect(parseGuardExport(payload).ok).toBe(true)
          expect(payload).toEqual({
            schemaVersion: 1,
            status: "pending",
            request: frame.request,
            agentName: "secretary",
            userKind: "authored",
            initiatingUserMessageId: null,
            inputGroupCount: 1,
            originCoverage: "complete",
            sourceProofs: [
              { sourceAnchorId: user.id, stored: true, visible: true, relation: "current", derivedSummaryIds: [] },
              { sourceAnchorId: "msg_missing", stored: false, visible: false, relation: "unknown", derivedSummaryIds: [] },
            ],
          })
          // No stored source text anywhere in the export.
          expect(JSON.stringify(payload)).not.toContain("SYNTHETIC_SOURCE_TEXT")

          for (const bad of ["?sourceAnchorIds=nope", `?sourceAnchorIds=${encodeURIComponent('["a","a"]')}`]) {
            expect((yield* get(frame.request.requestNonce, bad)).status).toBe(400)
          }

          const newer = frameFor(session.id, user.id)
          const releaseNewer = installGuardFrame(newer.frame)
          expect(yield* body(yield* get(frame.request.requestNonce))).toEqual({ schemaVersion: 1, status: "replaced" })
          abort.abort()
          newer.abort.abort()
          expect(yield* body(yield* get(newer.frame.request.requestNonce))).toEqual({ schemaVersion: 1, status: "cancelled" })
          release()
          releaseNewer()
          expect(yield* body(yield* get(frame.request.requestNonce))).toEqual({ schemaVersion: 1, status: "not_pending" })
          // a frame whose runner is gone is replaced, never pending
          const orphan = frameFor(session.id, user.id)
          const releaseOrphan = installGuardFrame(orphan.frame)
          runnerGenerations.delete(session.id)
          expect(yield* body(yield* get(orphan.frame.request.requestNonce))).toEqual({ schemaVersion: 1, status: "replaced" })
          releaseOrphan()
        }),
      ),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
