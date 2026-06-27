// Regression (#762): the bundled fork engine delivered `message.part.delta`
// (a BusEvent) over `/event` but NOT `message.updated` / `message.part.updated`
// (SyncEvents). `session.updated` (also a SyncEvent) arrived only because its
// `convertEvent` (server/projectors.ts) reconstructed a plain, serializable
// payload from the DB row; the two message SyncEvents fell through to
// `return data`, passing the raw Effect `Schema.Class` instance straight to the
// SSE JSON serializer (`event.ts` does `JSON.stringify(properties)`), which did
// not survive to the wildcard stream.
//
// Downstream impact: the Rhythm api_server `/event` subscriber never received
// `message.updated` (the carrier of `info.tokens`/`cost` → context-usage gauge)
// or `message.part.updated` (the canonical full-text part), so token/cost never
// rendered and the live assistant bubble had to be synthesized client-side.
//
// This test subscribes to the bus (where `convertEvent`'s output becomes the
// event `properties`), drives both events through the real publish → projector
// → convertEvent path, and asserts the properties survive a full JSON round
// trip with their payload intact — exactly the SSE serialization boundary.
import { describe, expect } from "bun:test"
import { Deferred, Effect } from "effect"
import { Bus } from "../../src/bus"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "@/session/session"
import { MessageID, PartID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const it = testEffect(Session.defaultLayer)

describe("message SyncEvents survive serialization to the /event stream (#762)", () => {
  it.instance(
    "message.updated and message.part.updated reach the bus as plain, JSON-serializable payloads",
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
      const test = yield* TestInstance
      const session = yield* Session.Service
      const created = yield* session.create({ title: "syncevent" })

      const messageID = MessageID.ascending()
      const partID = PartID.ascending()

      // Capture the raw bus payloads. The SSE handler serializes exactly this
      // `properties` object via JSON.stringify, so round-tripping it here
      // reproduces the serialization boundary that #762 failed at.
      const captured: Array<{ type: string; properties: Record<string, unknown> }> = []
      const bothSeen = yield* Deferred.make<void>()
      // Namespace-level subscribe (same path production/`/event` uses) — resolves
      // the per-instance bus from the ambient instance context.
      const unsub = Bus.subscribeAll((evt: { type: string; properties: Record<string, unknown> }) => {
        if (evt.type === "message.updated" || evt.type === "message.part.updated") {
          captured.push({ type: evt.type, properties: evt.properties })
          if (
            captured.some((e) => e.type === "message.updated") &&
            captured.some((e) => e.type === "message.part.updated")
          ) {
            Deferred.doneUnsafe(bothSeen, Effect.void)
          }
        }
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => unsub()))

      yield* session.updateMessage({
        id: messageID,
        role: "assistant",
        sessionID: created.id,
        parentID: MessageID.ascending(),
        modelID: ModelID.make("test-model"),
        providerID: ProviderID.make("test-provider"),
        mode: "build",
        agent: "build",
        path: { cwd: test.directory, root: test.directory },
        cost: 0.0123,
        tokens: { input: 4096, output: 128, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
      } as never)

      yield* session.updatePart({
        id: partID,
        sessionID: created.id,
        messageID,
        type: "text",
        text: "hello from a part",
      } as never)

      yield* Deferred.await(bothSeen).pipe(Effect.timeout("5 seconds"))

      // ── message.updated ──────────────────────────────────────────────────
      const updated = captured.find((e) => e.type === "message.updated")
      expect(updated, "message.updated never reached the bus (#762)").toBeDefined()
      // Round-trip through the SSE serialization boundary.
      const updatedRT = JSON.parse(JSON.stringify(updated!.properties)) as Record<string, unknown>
      expect(updatedRT.sessionID).toBe(created.id)
      const info = updatedRT.info as Record<string, unknown> | undefined
      expect(info, "message.updated lost its info payload through serialization (#762)").toBeDefined()
      expect(info!.id).toBe(messageID)
      expect(info!.role).toBe("assistant")
      // tokens/cost are what feed the Flutter context-usage gauge (symptom #3).
      const tokens = info!.tokens as Record<string, unknown> | undefined
      expect(tokens, "message.updated.info.tokens missing — context gauge would stay empty").toBeDefined()
      expect(tokens!.input).toBe(4096)
      expect(info!.cost).toBe(0.0123)

      // ── message.part.updated ─────────────────────────────────────────────
      const partUpdated = captured.find((e) => e.type === "message.part.updated")
      expect(partUpdated, "message.part.updated never reached the bus (#762)").toBeDefined()
      const partRT = JSON.parse(JSON.stringify(partUpdated!.properties)) as Record<string, unknown>
      expect(partRT.sessionID).toBe(created.id)
      expect(typeof partRT.time).toBe("number")
      const part = partRT.part as Record<string, unknown> | undefined
      expect(part, "message.part.updated lost its part payload through serialization (#762)").toBeDefined()
      expect(part!.id).toBe(partID)
      expect(part!.messageID).toBe(messageID)
      expect(part!.type).toBe("text")
      expect(part!.text).toBe("hello from a part")
    }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
