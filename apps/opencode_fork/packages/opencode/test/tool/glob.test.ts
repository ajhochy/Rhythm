import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { GLOB_TIMEOUT_DEFAULT_MS, GlobTool, globTimeoutMs } from "../../src/tool/glob"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Reference } from "@/reference/reference"

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    Reference.defaultLayer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.glob", () => {
  it.instance("matches files from a directory path", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "a.ts"), "export const a = 1\n"))
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "b.txt"), "hello\n"))
      const info = yield* GlobTool
      const glob = yield* info.init()
      const result = yield* glob.execute(
        {
          pattern: "*.ts",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.count).toBe(1)
      expect(result.output).toContain(path.join(test.directory, "a.ts"))
      expect(result.output).not.toContain(path.join(test.directory, "b.txt"))
    }),
  )

  it.instance("rejects exact file paths", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "a.ts")
      yield* Effect.promise(() => Bun.write(file, "export const a = 1\n"))
      const info = yield* GlobTool
      const glob = yield* info.init()
      const exit = yield* glob
        .execute(
          {
            pattern: "*.ts",
            path: file,
          },
          ctx,
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err instanceof Error ? err.message : String(err)).toContain("glob path must be a directory")
      }
    }),
  )
})

describe("tool.glob timeout", () => {
  const original = process.env.RHYTHM_GLOB_TIMEOUT_MS
  afterEach(() => {
    if (original === undefined) delete process.env.RHYTHM_GLOB_TIMEOUT_MS
    else process.env.RHYTHM_GLOB_TIMEOUT_MS = original
  })

  test("reads the budget from the environment at call time", () => {
    delete process.env.RHYTHM_GLOB_TIMEOUT_MS
    expect(globTimeoutMs()).toBe(GLOB_TIMEOUT_DEFAULT_MS)
    process.env.RHYTHM_GLOB_TIMEOUT_MS = "1234"
    expect(globTimeoutMs()).toBe(1234)
    process.env.RHYTHM_GLOB_TIMEOUT_MS = "nope"
    expect(globTimeoutMs()).toBe(GLOB_TIMEOUT_DEFAULT_MS)
    process.env.RHYTHM_GLOB_TIMEOUT_MS = "0"
    expect(globTimeoutMs()).toBe(GLOB_TIMEOUT_DEFAULT_MS)
  })

  // A traversal that outlives the budget errors instead of hanging. Squeezing the budget to 1ms
  // is the deterministic stand-in for the real trigger (`**/x.py` rooted at $HOME), which would
  // otherwise need a genuinely enormous tree to reproduce.
  it.instance("fails with an actionable error when the traversal outlives the budget", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "deep/nested/tree/a.ts"), "export const a = 1\n"))
      process.env.RHYTHM_GLOB_TIMEOUT_MS = "1"
      const info = yield* GlobTool
      const glob = yield* info.init()
      const started = Date.now()
      const exit = yield* glob.execute({ pattern: "**/*.py", path: test.directory }, ctx).pipe(Effect.exit)
      const elapsed = Date.now() - started
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        const message = err instanceof Error ? err.message : String(err)
        expect(message).toContain("glob timed out after 1ms")
        expect(message).toContain(test.directory)
        expect(message).toContain("RHYTHM_GLOB_TIMEOUT_MS")
      }
      // it returns, rather than sitting on the run-level inactivity window
      expect(elapsed).toBeLessThan(10_000)
    }),
  )

  it.instance("leaves a normal glob alone when the budget is generous", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "deep/nested/tree/a.ts"), "export const a = 1\n"))
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "b.txt"), "hello\n"))
      process.env.RHYTHM_GLOB_TIMEOUT_MS = "60000"
      const info = yield* GlobTool
      const glob = yield* info.init()
      const result = yield* glob.execute({ pattern: "**/*.ts", path: test.directory }, ctx)
      expect(result.metadata.count).toBe(1)
      expect(result.metadata.truncated).toBe(false)
      expect(result.output).toContain(path.join(test.directory, "deep/nested/tree/a.ts"))
    }),
  )
})
