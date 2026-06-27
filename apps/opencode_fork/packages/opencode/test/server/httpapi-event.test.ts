import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/event"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

const savedPassword = {
  flag: Flag.OPENCODE_SERVER_PASSWORD,
  env: process.env.OPENCODE_SERVER_PASSWORD,
}

// Boot a real listening server with auth disabled. The in-process `app().request()`
// path is not sufficient to exercise #759: the bug lives in how the HTTP response
// *body* fiber resolves Instance context, which only manifests when the SSE stream
// is pumped through `Server.listen` like a real client connection.
async function startUnsecuredListener() {
  Flag.OPENCODE_SERVER_PASSWORD = undefined
  delete process.env.OPENCODE_SERVER_PASSWORD
  return Server.listen({ hostname: "127.0.0.1", port: 0 })
}

async function readFirstChunk(response: Response) {
  if (!response.body) throw new Error("missing response body")
  const reader = response.body.getReader()
  const result = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for event")), 5_000)),
  ])
  await reader.cancel()
  return new TextDecoder().decode(result.value)
}

async function readFirstEvent(response: Response) {
  return JSON.parse((await readFirstChunk(response)).replace(/^data: /, "")) as {
    id?: string
    type: string
    properties: Record<string, unknown>
  }
}

afterEach(async () => {
  Flag.OPENCODE_SERVER_PASSWORD = savedPassword.flag
  if (savedPassword.env === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
  else process.env.OPENCODE_SERVER_PASSWORD = savedPassword.env
  await disposeAllInstances()
  await resetDatabase()
})

describe("event HttpApi", () => {
  test("serves event stream", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform")
    expect(response.headers.get("x-accel-buffering")).toBe("no")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await readFirstEvent(response)).toMatchObject({ type: "server.connected", properties: {} })
  })

  test("serves the initial server connected event", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    const response = await app().request(EventPaths.event, { headers })

    expect(await readFirstEvent(response)).toMatchObject({ type: "server.connected", properties: {} })
  })

  // Regression for #759: the fork's /event SSE stream emitted `server.connected`
  // and then collapsed immediately, delivering no session/message events (agent
  // sessions stuck on "Starting"). Root cause: `bus.subscribeAll()` deferred
  // `InstanceState.get` until the stream was consumed, but the HTTP response body
  // is pumped on a server fiber that never inherits the request's InstanceRef, so
  // the lazy resolve failed and the stream ended right after the connected event.
  // The fix resolves the wildcard PubSub eagerly in the handler. This test boots a
  // real listener and asserts the stream stays open past `server.connected`
  // (before the fix, the next read returns EOF within milliseconds).
  test("keeps the event stream open after server.connected (regression #759)", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const listener = await startUnsecuredListener()
    try {
      const url = new URL(`${EventPaths.event}?directory=${encodeURIComponent(tmp.path)}`, listener.url)
      const response = await fetch(url, { headers: { accept: "text/event-stream" } })
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/event-stream")

      const reader = response.body!.getReader()
      try {
        const first = new TextDecoder().decode((await reader.read()).value)
        expect(first).toContain("server.connected")

        // Next read must NOT resolve to EOF before our window. A quiet instance
        // emits no events and no heartbeat for 10s, so the live stream simply
        // blocks here; the collapsed (buggy) stream resolves done:true at once.
        const outcome = await Promise.race([
          reader.read().then((r) => (r.done ? "eof" : "data")),
          new Promise<"open">((resolve) => setTimeout(() => resolve("open"), 2_000)),
        ])
        expect(outcome).not.toBe("eof")
      } finally {
        await reader.cancel().catch(() => undefined)
      }
    } finally {
      await listener.stop(true).catch(() => undefined)
    }
  }, 20_000)
})
