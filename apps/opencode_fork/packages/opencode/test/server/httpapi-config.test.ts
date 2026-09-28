import { afterEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { Deferred, Effect, Fiber } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import { waitGlobalBusEvent } from "./global-bus"
import { Global } from "@opencode-ai/core/global"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

function waitDisposed(directory: string, subscribed?: Deferred.Deferred<void>) {
  return waitGlobalBusEvent({
    message: "timed out waiting for instance disposal",
    predicate: (event) => event.payload.type === "server.instance.disposed" && event.directory === directory,
    subscribed,
  })
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("config HttpApi", () => {
  it.live(
    "global config provider updates invalidate a warm provider instance without restarting the process",
    Effect.gen(function* () {
      const project = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const global = yield* tmpdirEffect({})
      const previousGlobalConfig = Global.Path.config
      ;(Global.Path as { config: string }).config = global.path
      yield* Effect.addFinalizer(() => Effect.sync(() => ((Global.Path as { config: string }).config = previousGlobalConfig)))

      const headers = { "x-opencode-directory": project.path }
      const before = yield* Effect.promise(() => Promise.resolve(app().request("/config/providers", { headers })))
      expect(before.status).toBe(200)
      expect((yield* Effect.promise(() => before.json())).providers).not.toContainEqual(
        expect.objectContaining({ id: "synthetic-global-provider" }),
      )

      const subscribed = yield* Deferred.make<void>()
      const disposed = yield* waitDisposed(project.path, subscribed).pipe(Effect.forkScoped)
      yield* Deferred.await(subscribed)
      const update = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/global/config", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              provider: {
                "synthetic-global-provider": {
                  npm: "@ai-sdk/openai-compatible",
                  name: "Synthetic Global Provider",
                  options: { baseURL: "http://127.0.0.1:9/v1" },
                  models: { "synthetic-global-model": { name: "Synthetic Global Model" } },
                },
              },
            }),
          }),
        ),
      )
      expect(update.status).toBe(200)
      yield* Fiber.join(disposed)

      const after = yield* Effect.promise(() => Promise.resolve(app().request("/config/providers", { headers })))
      expect(after.status).toBe(200)
      expect((yield* Effect.promise(() => after.json())).providers).toContainEqual(
        expect.objectContaining({
          id: "synthetic-global-provider",
          models: expect.objectContaining({
            "synthetic-global-model": expect.objectContaining({ name: "Synthetic Global Model" }),
          }),
        }),
      )
    }),
  )

  it.live(
    "1424:fix-command-reload invalidates the command instance after config reload",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const headers = { "x-opencode-directory": tmp.path }

      const before = yield* Effect.promise(() => Promise.resolve(app().request("/command", { headers })))
      expect(before.status).toBe(200)
      expect((yield* Effect.promise(() => before.json()))).not.toContainEqual(
        expect.objectContaining({ name: "live-reload" }),
      )

      const commands = path.join(tmp.path, ".opencode", "commands")
      yield* Effect.promise(() => fs.mkdir(commands, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(commands, "live-reload.md"),
          "---\ndescription: Added after command state was initialized\n---\nReturn LIVE_RELOAD_OK.\n",
        ),
      )

      const reload = yield* Effect.promise(() =>
        Promise.resolve(app().request("/config/reload", { method: "POST", headers })),
      )
      expect(reload.status).toBe(200)
      expect(yield* Effect.promise(() => reload.json())).toBe(true)

      const after = yield* Effect.promise(() => Promise.resolve(app().request("/command", { headers })))
      expect(after.status).toBe(200)
      expect(yield* Effect.promise(() => after.json())).toContainEqual(
        expect.objectContaining({ name: "live-reload", description: "Added after command state was initialized" }),
      )
    }),
  )

  it.live(
    "serves config update through the default server app",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped)

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({ username: "patched-user", formatter: false, lsp: false }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
    }),
  )

  it.live(
    "serves config with active provider model status",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            omniroute: {
              models: {
                "gpt-4o": {
                  status: "active",
                },
              },
            },
          },
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        provider: {
          omniroute: {
            models: {
              "gpt-4o": {
                status: "active",
              },
            },
          },
        },
      })
    }),
  )
})
