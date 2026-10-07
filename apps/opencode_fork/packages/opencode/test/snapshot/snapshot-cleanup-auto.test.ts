import { afterEach, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Snapshot } from "../../src/snapshot"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Snapshot.defaultLayer, AppFileSystem.defaultLayer))

afterEach(async () => {
  await disposeAllInstances()
})

const run = (args: string[], cwd?: string) =>
  Effect.promise(async () => {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${await new Response(proc.stderr).text()}`)
    return stdout
  })

/** The snapshot store holds one bare repo per project/worktree pair. */
const findSnapshotGitdir = Effect.fn("findSnapshotGitdir")(function* () {
  const root = path.join(Global.Path.data, "snapshot")
  const found = yield* Effect.promise(async () => {
    const out: string[] = []
    const walk = async (dir: string, depth: number) => {
      if (depth > 3) return
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const full = path.join(dir, entry.name)
        if (entry.name === "objects") out.push(dir)
        else await walk(full, depth + 1)
      }
    }
    await walk(root, 0)
    return out
  })
  expect(found.length).toBeGreaterThan(0)
  return found[0]
})

const looseObjectCount = (gitdir: string) =>
  Effect.gen(function* () {
    const out = yield* run(["--git-dir", gitdir, "count-objects", "-v"])
    const line = out.split("\n").find((item) => item.startsWith("count:"))
    return Number(line?.slice("count:".length).trim() ?? "-1")
  })

it.instance(
  "cleanup leaves a below-threshold repo untouched instead of repacking it",
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const snapshot = yield* Snapshot.Service
    yield* AppFileSystem.Service.use((f) =>
      f.writeWithDirs(`${tmp.directory}/a.txt`, `A${Math.random().toString(36).slice(2)}`),
    )
    yield* run(["add", "."], tmp.directory)
    yield* run(["commit", "-m", "init"], tmp.directory)
    // Creates the snapshot repo and an initial commit for this worktree.
    expect(yield* snapshot.track()).toBeTruthy()

    const gitdir = yield* findSnapshotGitdir()

    // Pack everything, then add a handful of loose objects. Three is far below
    // git's gc.auto threshold (6700), so `gc --auto` must decline to run. A
    // plain `gc` would pack them away regardless — that is the regression this
    // guards: a full repack of an already-packed 1.73 GiB store measured 6.9
    // minutes on 2026-10-06 and blocked the engine well past the mobile
    // gateway's 30s abort.
    yield* run(["--git-dir", gitdir, "gc"])
    expect(yield* looseObjectCount(gitdir)).toBe(0)
    for (const content of ["loose-one", "loose-two", "loose-three"]) {
      yield* Effect.promise(async () => {
        const proc = Bun.spawn(["git", "--git-dir", gitdir, "hash-object", "-w", "--stdin"], {
          stdin: new TextEncoder().encode(content),
          stdout: "ignore",
          stderr: "ignore",
        })
        await proc.exited
      })
    }
    const before = yield* looseObjectCount(gitdir)
    expect(before).toBe(3)

    yield* snapshot.cleanup()

    // `--auto` present: nothing crossed a threshold, so the objects survive.
    // `--auto` removed: the unconditional gc packs them and this reads 0.
    expect(yield* looseObjectCount(gitdir)).toBe(before)
  }),
  { git: true },
)
