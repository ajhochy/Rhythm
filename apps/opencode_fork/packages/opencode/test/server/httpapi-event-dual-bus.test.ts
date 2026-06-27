// Contract test for #764 (issue-764-c1).
//
// Regression caught: SyncEvent publishes (`message.updated` /
// `message.part.updated`) route through the **module-level namespace `Bus`**
// runtime (`sync/index.ts:333` → `ProjectBus.publish`), while a live `/event`
// connection subscribes through the **per-request DI `Bus.Service`**. Those are
// two different `{wildcard, typed}` PubSub states for the same directory, so a
// namespace publish lands on a wildcard the `/event` subscriber never reads —
// message.updated/part.updated never reach the SSE stream (the carriers of
// token/cost and the canonical part text → Rhythm duplicate messages + empty
// context gauge).
//
// The assertion that fails before the fix: with a real HTTP `/event` subscriber
// open for a directory, a namespace `Bus.publish(MessageV2.Event.Updated, …)`
// and `Bus.publish(MessageV2.Event.PartUpdated, …)` for that SAME directory must
// arrive on the SSE stream. On the unmodified dual-bus codebase the publish goes
// to bus B and the subscriber reads bus A, so neither event arrives and this
// test times out. Once the namespace Bus and the DI Bus.Service share one
// per-directory PubSub, both arrive.
//
// This is the cross-request reproduction the namespace-only bus test
// (httpapi-event-sync-message.test.ts) structurally cannot catch: that test
// subscribes AND publishes through the namespace path, so both sides hit the
// same bus B and it passes despite the split.
import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/event"
import { Bus } from "../../src/bus"
import { MessageV2 } from "../../src/session/message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideTestInstance, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const savedPassword = {
  flag: Flag.OPENCODE_SERVER_PASSWORD,
  env: process.env.OPENCODE_SERVER_PASSWORD,
}

async function startUnsecuredListener() {
  Flag.OPENCODE_SERVER_PASSWORD = undefined
  delete process.env.OPENCODE_SERVER_PASSWORD
  return Server.listen({ hostname: "127.0.0.1", port: 0 })
}

afterEach(async () => {
  Flag.OPENCODE_SERVER_PASSWORD = savedPassword.flag
  if (savedPassword.env === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
  else process.env.OPENCODE_SERVER_PASSWORD = savedPassword.env
  await disposeAllInstances()
  await resetDatabase()
})

// Pull SSE frames off the response body, collecting the `type` of every event
// seen until either both target types arrive or the deadline elapses.
async function collectUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  wanted: Set<string>,
  deadlineMs: number,
): Promise<Set<string>> {
  const decoder = new TextDecoder()
  const seen = new Set<string>()
  let buffer = ""
  const deadline = Date.now() + deadlineMs

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    const next = await Promise.race([
      reader.read().then((r) => ({ kind: "read" as const, r })),
      new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), remaining)),
    ])
    if (next.kind === "timeout") break
    if (next.r.done) break
    buffer += decoder.decode(next.r.value, { stream: true })

    const frames = buffer.split("\n\n")
    buffer = frames.pop() ?? ""
    for (const frame of frames) {
      const dataLine = frame
        .split("\n")
        .find((l) => l.startsWith("data: "))
      if (!dataLine) continue
      try {
        const evt = JSON.parse(dataLine.slice("data: ".length)) as { type?: string }
        if (evt.type) seen.add(evt.type)
      } catch {
        // partial / non-JSON keepalive — ignore
      }
    }
    if ([...wanted].every((t) => seen.has(t))) break
  }
  return seen
}

describe("SyncEvent publishes reach a live /event subscriber across the bus boundary (#764)", () => {
  test(
    "issue-764-c1: namespace Bus.publish of message.updated and message.part.updated arrives on /event",
    async () => {
      await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
      const listener = await startUnsecuredListener()
      try {
        // 1. Open a real HTTP /event connection for the directory. This builds
        //    and (post-fix) registers the per-request DI Bus.Service state.
        const url = new URL(`${EventPaths.event}?directory=${encodeURIComponent(tmp.path)}`, listener.url)
        const response = await fetch(url, { headers: { accept: "text/event-stream" } })
        expect(response.status).toBe(200)
        const reader = response.body!.getReader()

        try {
          const sessionID = "ses_dualbus764"
          const messageID = "msg_dualbus764"
          const partID = "prt_dualbus764"
          const wanted = new Set(["message.updated", "message.part.updated"])

          // 2. Start collecting events (must see server.connected first, then
          //    the two SyncEvents we publish below).
          const collected = collectUntil(reader, wanted, 8_000)

          // 3. Publish the two message SyncEvents through the SAME namespace
          //    path SyncEvent.process() uses (Bus.publish → module runtime),
          //    under the same directory's instance context. Keep the instance
          //    alive until the subscriber has received them (or the deadline),
          //    so disposal can't shut the shared PubSub down mid-flight.
          await provideTestInstance({
            directory: tmp.path,
            fn: async () => {
              await Bus.publish(MessageV2.Event.Updated as never, {
                sessionID,
                info: {
                  id: messageID,
                  sessionID,
                  role: "assistant",
                  cost: 0.0123,
                  tokens: { input: 4096, output: 128, reasoning: 0, cache: { read: 0, write: 0 } },
                },
              } as never)
              await Bus.publish(MessageV2.Event.PartUpdated as never, {
                sessionID,
                time: Date.now(),
                part: { id: partID, sessionID, messageID, type: "text", text: "hello from a part" },
              } as never)
              await collected
            },
          })

          const seen = await collected
          expect(
            seen.has("message.updated"),
            "message.updated never reached the live /event subscriber — namespace Bus published to a different bus state than /event reads (#764)",
          ).toBe(true)
          expect(
            seen.has("message.part.updated"),
            "message.part.updated never reached the live /event subscriber (#764)",
          ).toBe(true)
        } finally {
          await reader.cancel().catch(() => undefined)
        }
      } finally {
        await listener.stop(true).catch(() => undefined)
      }
    },
    20_000,
  )
})
