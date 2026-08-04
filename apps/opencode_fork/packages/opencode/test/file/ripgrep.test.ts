import { afterEach, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import * as Stream from "effect/Stream"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Ripgrep } from "../../src/file/ripgrep"
import { testEffect } from "../lib/effect"

const it = testEffect(Ripgrep.defaultLayer)

const tmpdir = (init?: (dir: string) => Effect.Effect<void>) =>
  Effect.acquireRelease(
    Effect.promise(async () => fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-")))),
    (dir) =>
      Effect.promise(() =>
        fs.rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        }),
      ).pipe(Effect.ignore),
  ).pipe(Effect.tap((dir) => init?.(dir) ?? Effect.void))

const write = (file: string, data: string) => Effect.promise(() => Bun.write(file, data))
const mkdir = (dir: string) => Effect.promise(() => fs.mkdir(dir, { recursive: true }))
const collectFiles = (input: Ripgrep.FilesInput) =>
  Ripgrep.Service.use((rg) =>
    rg.files(input).pipe(
      Stream.runCollect,
      Effect.map((c) => [...c]),
    ),
  )

const withRipgrepConfig = <A, E, R>(value: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env["RIPGREP_CONFIG_PATH"]
      process.env["RIPGREP_CONFIG_PATH"] = value
      return prev
    }),
    () => effect,
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env["RIPGREP_CONFIG_PATH"]
        else process.env["RIPGREP_CONFIG_PATH"] = prev
      }),
  )

describe("file.ripgrep", () => {
  it.live("defaults to include hidden", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "visible.txt"), "hello")
          yield* mkdir(path.join(dir, ".opencode"))
          yield* write(path.join(dir, ".opencode", "thing.json"), "{}")
        }),
      )

      const files = yield* collectFiles({ cwd: dir })
      expect(files.includes("visible.txt")).toBe(true)
      expect(files.includes(path.join(".opencode", "thing.json"))).toBe(true)
    }),
  )

  it.live("hidden false excludes hidden", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "visible.txt"), "hello")
          yield* mkdir(path.join(dir, ".opencode"))
          yield* write(path.join(dir, ".opencode", "thing.json"), "{}")
        }),
      )

      const files = yield* collectFiles({ cwd: dir, hidden: false })
      expect(files.includes("visible.txt")).toBe(true)
      expect(files.includes(path.join(".opencode", "thing.json"))).toBe(false)
    }),
  )

  it.live("search returns empty when nothing matches", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) => write(path.join(dir, "match.ts"), "const value = 'other'\n"))

      const result = yield* Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle" }))
      expect(result.partial).toBe(false)
      expect(result.items).toEqual([])
    }),
  )

  it.live("search returns match metadata with normalized path", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* mkdir(path.join(dir, "src"))
          yield* write(path.join(dir, "src", "match.ts"), "const needle = 1\n")
        }),
      )

      const result = yield* Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle" }))
      expect(result.partial).toBe(false)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.path.text).toBe(path.join("src", "match.ts"))
      expect(result.items[0]?.line_number).toBe(1)
      expect(result.items[0]?.lines.text).toContain("needle")
    }),
  )

  it.live("search returns matched rows with glob filter", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "match.ts"), "const value = 'needle'\n")
          yield* write(path.join(dir, "skip.txt"), "const value = 'other'\n")
        }),
      )

      const result = yield* Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle", glob: ["*.ts"] }))
      expect(result.partial).toBe(false)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.path.text).toContain("match.ts")
      expect(result.items[0]?.lines.text).toContain("needle")
    }),
  )

  it.live("search supports explicit file targets", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "match.ts"), "const value = 'needle'\n")
          yield* write(path.join(dir, "skip.ts"), "const value = 'needle'\n")
        }),
      )

      const file = path.join(dir, "match.ts")
      const result = yield* Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle", file: [file] }))
      expect(result.partial).toBe(false)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.path.text).toBe(file)
    }),
  )

  it.live("files returns empty when glob matches no files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* mkdir(path.join(dir, "packages", "console"))
          yield* write(path.join(dir, "packages", "console", "package.json"), "{}")
        }),
      )

      const files = yield* collectFiles({ cwd: dir, glob: ["packages/*"] })
      expect(files).toEqual([])
    }),
  )

  it.live("files returns stream of filenames", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "a.txt"), "hello")
          yield* write(path.join(dir, "b.txt"), "world")
        }),
      )

      const files = yield* collectFiles({ cwd: dir }).pipe(Effect.map((files) => files.sort()))
      expect(files).toEqual(["a.txt", "b.txt"])
    }),
  )

  it.live("files respects glob filter", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* write(path.join(dir, "keep.ts"), "yes")
          yield* write(path.join(dir, "skip.txt"), "no")
        }),
      )

      const files = yield* collectFiles({ cwd: dir, glob: ["*.ts"] })
      expect(files).toEqual(["keep.ts"])
    }),
  )

  it.live("files dies on nonexistent directory", () =>
    Effect.gen(function* () {
      const exit = yield* Ripgrep.Service.use((rg) =>
        rg.files({ cwd: "/tmp/nonexistent-dir-12345" }).pipe(Stream.runCollect),
      ).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.live("ignores RIPGREP_CONFIG_PATH in direct mode", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) => write(path.join(dir, "match.ts"), "const needle = 1\n"))

      const result = yield* withRipgrepConfig(
        path.join(dir, "missing-ripgreprc"),
        Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle" })),
      )
      expect(result.items).toHaveLength(1)
    }),
  )

  it.live("ignores RIPGREP_CONFIG_PATH in worker mode", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) => write(path.join(dir, "match.ts"), "const needle = 1\n"))

      const result = yield* withRipgrepConfig(
        path.join(dir, "missing-ripgreprc"),
        Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle" })),
      )
      expect(result.items).toHaveLength(1)
    }),
  )
})

// The walk budget lives here so `files`, `search`, `tree` and any future caller are bounded in
// one place. Squeezing it to 1ms is the deterministic stand-in for the real trigger — a walk
// rooted at a tree big enough to outlive the budget on its own would need a $HOME-sized fixture.
describe("file.ripgrep timeout", () => {
  const keys = ["RHYTHM_RIPGREP_TIMEOUT_MS", "RHYTHM_GLOB_TIMEOUT_MS"] as const
  const original = keys.map((key) => [key, process.env[key]] as const)
  afterEach(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("reads the budget from the environment at call time", () => {
    for (const key of keys) delete process.env[key]
    expect(Ripgrep.ripgrepTimeoutMs()).toBe(Ripgrep.RIPGREP_TIMEOUT_DEFAULT_MS)
    process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "1234"
    expect(Ripgrep.ripgrepTimeoutMs()).toBe(1234)
    process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "nope"
    expect(Ripgrep.ripgrepTimeoutMs()).toBe(Ripgrep.RIPGREP_TIMEOUT_DEFAULT_MS)
    process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "0"
    expect(Ripgrep.ripgrepTimeoutMs()).toBe(Ripgrep.RIPGREP_TIMEOUT_DEFAULT_MS)
  })

  test("still honors the pre-centralization RHYTHM_GLOB_TIMEOUT_MS", () => {
    for (const key of keys) delete process.env[key]
    process.env.RHYTHM_GLOB_TIMEOUT_MS = "4321"
    expect(Ripgrep.ripgrepTimeoutMs()).toBe(4321)
    // the current name wins when both are set
    process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "1111"
    expect(Ripgrep.ripgrepTimeoutMs()).toBe(1111)
  })

  it.live("tree fails with an actionable error when the walk outlives the budget", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* mkdir(path.join(dir, "deep", "nested"))
          yield* write(path.join(dir, "deep", "nested", "a.ts"), "export const a = 1\n")
        }),
      )
      process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "1"
      const started = Date.now()
      const exit = yield* Ripgrep.Service.use((rg) => rg.tree({ cwd: dir })).pipe(Effect.exit)
      const elapsed = Date.now() - started
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        const message = err instanceof Error ? err.message : String(err)
        expect(message).toContain("repo tree timed out after 1ms")
        expect(message).toContain(dir)
        expect(message).toContain("RHYTHM_RIPGREP_TIMEOUT_MS")
      }
      expect(elapsed).toBeLessThan(10_000)
    }),
  )

  it.live("tree is unaffected when the budget is generous", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) =>
        Effect.gen(function* () {
          yield* mkdir(path.join(dir, "deep", "nested"))
          yield* write(path.join(dir, "deep", "nested", "a.ts"), "export const a = 1\n")
        }),
      )
      process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "60000"
      const tree = yield* Ripgrep.Service.use((rg) => rg.tree({ cwd: dir }))
      expect(tree).toContain("deep")
      expect(tree).toContain(path.join("deep", "nested").replace(path.sep, "/"))
    }),
  )

  it.live("search fails with an actionable error when the walk outlives the budget", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) => write(path.join(dir, "match.ts"), "const needle = 1\n"))
      process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "1"
      const exit = yield* Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle" })).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        const message = err instanceof Error ? err.message : String(err)
        expect(message).toContain("ripgrep search timed out after 1ms")
        expect(message).toContain(dir)
        expect(message).toContain("RHYTHM_RIPGREP_TIMEOUT_MS")
      }
    }),
  )

  it.live("search is unaffected when the budget is generous", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) => write(path.join(dir, "match.ts"), "const needle = 1\n"))
      process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "60000"
      const result = yield* Ripgrep.Service.use((rg) => rg.search({ cwd: dir, pattern: "needle" }))
      expect(result.items).toHaveLength(1)
    }),
  )

  it.live("files is unaffected when the budget is generous", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdir((dir) => write(path.join(dir, "a.txt"), "hello"))
      process.env.RHYTHM_RIPGREP_TIMEOUT_MS = "60000"
      const files = yield* collectFiles({ cwd: dir })
      expect(files).toEqual(["a.txt"])
    }),
  )
})
