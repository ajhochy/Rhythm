import { afterEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { GrepTool } from "../../src/tool/grep"
import { provideInstance, TestInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { testEffect } from "../lib/effect"
import { Reference } from "@/reference/reference"
import { Permission } from "../../src/permission"
import type * as Tool from "../../src/tool/tool"

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

const root = path.join(__dirname, "../..")

describe("tool.grep", () => {
  it.live("basic search", () =>
    Effect.gen(function* () {
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* provideInstance(root)(
        grep.execute(
          {
            pattern: "export",
            path: path.join(root, "src/tool"),
            include: "*.ts",
          },
          ctx,
        ),
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
      expect(result.output).toContain("Found")
    }),
  )

  it.instance("no matches returns correct output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "test.txt"), "hello world"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "xyznonexistentpatternxyz123",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(0)
      expect(result.output).toBe("No files found")
    }),
  )

  it.instance("finds matches in tmp instance", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "test.txt"), "line1\nline2\nline3"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "line",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
    }),
  )

  it.instance("supports exact file paths", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "test.txt")
      yield* Effect.promise(() => Bun.write(file, "line1\nline2\nline3"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "line2",
          path: file,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain(file)
      expect(result.output).toContain("Line 2: line2")
    }),
  )

  it.instance("does not ask for external_directory when alias path is allowed", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return

      yield* TestInstance
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-grep-alias-"))),
        (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
      )
      const real = path.join(tmp, "real")
      const alias = path.join(tmp, "alias")
      yield* Effect.promise(() => fs.mkdir(real))
      yield* Effect.promise(() => fs.symlink(real, alias, "dir"))
      yield* Effect.promise(() => Bun.write(path.join(real, "test.txt"), "needle"))

      const ruleset = Permission.fromConfig({
        grep: "allow",
        external_directory: {
          [path.join(alias, "*")]: "allow",
        },
      })
      const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
      const next: Tool.Context = {
        ...ctx,
        ask: (req) =>
          Effect.sync(() => {
            const needsAsk = req.patterns.some(
              (pattern) => Permission.evaluate(req.permission, pattern, ruleset).action !== "allow",
            )
            if (needsAsk) requests.push(req)
          }),
      }

      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "needle",
          path: alias,
          include: "*.txt",
        },
        next,
      )

      expect(result.metadata.matches).toBe(1)
      expect(requests.find((req) => req.permission === "external_directory")).toBeUndefined()
    }),
  )
})

// `grep` shared the glob tool's unbounded exposure: ripgrep walks the whole tree regardless of
// --max-count, so a search rooted at a huge directory could burn the run-level inactivity window
// exactly the way the glob incident did. Both directions are asserted, so the guard cannot be
// silently disabled without a test going red.
describe("tool.grep timeout", () => {
  const original = process.env.RHYTHM_RIPGREP_TIMEOUT_MS
  afterEach(() => {
    if (original === undefined) delete process.env.RHYTHM_RIPGREP_TIMEOUT_MS
    else process.env.RHYTHM_RIPGREP_TIMEOUT_MS = original
  })

  it.instance("fails with an actionable error when the search outlives the budget", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "deep/nested/tree/a.ts"), "const needle = 1\n"))
      process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "1"
      const info = yield* GrepTool
      const grep = yield* info.init()
      const started = Date.now()
      const exit = yield* grep.execute({ pattern: "needle", path: test.directory }, ctx).pipe(Effect.exit)
      const elapsed = Date.now() - started
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        const message = err instanceof Error ? err.message : String(err)
        expect(message).toContain("grep timed out after 1ms")
        expect(message).toContain(test.directory)
        expect(message).toContain("needle")
        expect(message).toContain("RHYTHM_RIPGREP_TIMEOUT_MS")
      }
      expect(elapsed).toBeLessThan(10_000)
    }),
  )

  it.instance("leaves a normal search alone when the budget is generous", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "deep/nested/tree/a.ts"), "const needle = 1\n"))
      process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "60000"
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute({ pattern: "needle", path: test.directory }, ctx)
      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain(path.join(test.directory, "deep/nested/tree/a.ts"))
    }),
  )
})
