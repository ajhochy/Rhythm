import { afterEach, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { InstanceState } from "../../src/effect/instance-state"
import { Snapshot } from "../../src/snapshot"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Snapshot.defaultLayer, AppFileSystem.defaultLayer))

afterEach(async () => {
  await disposeAllInstances()
})

const git = (args: string[], cwd: string) =>
  Effect.promise(async () => {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(proc.stderr).text()}`)
    return out
  })

const write = (file: string, content: string) =>
  AppFileSystem.Service.use((f) => f.writeWithDirs(file, content))

/** Files under the 2 MB per-file guard, so only the aggregate budget can stop them. */
const SUB_LIMIT_BYTES = 1024 * 1024
const BUDGET_BYTES = 64 * 1024 * 1024

/** The snapshot repo is a separate gitdir under the opencode data dir; the
 * worktree's own .git is NOT where track() stages. Derived the same way the
 * product does, rather than guessed from the filesystem. */
const snapshotGitdir = Effect.fn("snapshotGitdir")(function* () {
  const ctx = yield* InstanceState.context
  return path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree))
})

const readExclude = (gitdir: string) =>
  Effect.promise(() =>
    fs.readFile(path.join(gitdir, "info", "exclude"), "utf8").catch(() => ""),
  )

/** Snapshot-repo index contents (what track() actually hashed). */
const snapshotStaged = (gitdir: string, worktree: string) =>
  git(["--git-dir", gitdir, "--work-tree", worktree, "ls-files", "--cached"], worktree)

it.instance(
  "a media-sized untracked set is excluded instead of hashed, but tracked edits still stage",
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const snapshot = yield* Snapshot.Service

    // One real source file, committed — this stands in for the code an agent
    // actually edits. Revert must keep working for it.
    yield* write(`${tmp.directory}/src.txt`, "original")
    yield* git(["add", "."], tmp.directory)
    yield* git(["commit", "-m", "init"], tmp.directory)

    // 100 x 1 MB untracked files: every one is under the per-file guard, so
    // without an aggregate budget all 100 MB would be staged and hashed. This
    // is the shape measured on a real session cwd (5,590 files / 2.05 GB).
    const blob = "x".repeat(SUB_LIMIT_BYTES)
    for (let index = 0; index < 100; index += 1) {
      yield* write(`${tmp.directory}/media/img-${index}.bin`, blob)
    }
    // The edit an agent made, after the bulk — must survive regardless.
    yield* write(`${tmp.directory}/src.txt`, "edited by the agent")

    expect(yield* snapshot.track()).toBeTruthy()

    const gitdir = yield* snapshotGitdir()
    const staged = yield* snapshotStaged(gitdir, tmp.directory)
    const stagedMedia = staged.split("\n").filter((line) => line.startsWith("media/")).length

    // Budget is 64 MB against 100 MB of untracked bulk, so some must be cut.
    expect(stagedMedia).toBeLessThan(100)
    // And the cut ones are excluded, not silently dropped.
    const exclude = yield* readExclude(gitdir)
    expect(exclude).toContain("media/")

    // The non-negotiable: the tracked file the agent edited is still captured,
    // so undo/revert of ordinary code edits is unaffected.
    const show = yield* git(["--git-dir", gitdir, "--work-tree", tmp.directory, "show", ":src.txt"], tmp.directory)
    expect(show).toContain("edited by the agent")
  }),
  { git: true },
)

it.instance(
  "a normal code worktree is left completely alone",
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const snapshot = yield* Snapshot.Service
    yield* write(`${tmp.directory}/a.ts`, "export const a = 1")
    yield* git(["add", "."], tmp.directory)
    yield* git(["commit", "-m", "init"], tmp.directory)

    // A few small untracked files — far under the aggregate budget.
    for (const name of ["b.ts", "c.ts", "d.ts"]) {
      yield* write(`${tmp.directory}/${name}`, "export const x = 1")
    }
    expect(yield* snapshot.track()).toBeTruthy()

    const gitdir = yield* snapshotGitdir()
    const staged = yield* snapshotStaged(gitdir, tmp.directory)
    for (const name of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
      expect(staged).toContain(name)
    }
    const exclude = yield* readExclude(gitdir)
    expect(exclude).not.toContain("b.ts")
  }),
  { git: true },
)

it.instance(
  "the budget is aggregate, not per-file",
  Effect.gen(function* () {
    // Guards the exact defect: every file passes the per-file limit, and the
    // set is only stopped by the total.
    const tmp = yield* TestInstance
    const snapshot = yield* Snapshot.Service
    yield* write(`${tmp.directory}/seed.txt`, "seed")
    yield* git(["add", "."], tmp.directory)
    yield* git(["commit", "-m", "init"], tmp.directory)

    const blob = "y".repeat(SUB_LIMIT_BYTES)
    for (let index = 0; index < 80; index += 1) {
      yield* write(`${tmp.directory}/bulk/f-${index}.bin`, blob)
    }
    expect(yield* snapshot.track()).toBeTruthy()

    const gitdir = yield* snapshotGitdir()
    const staged = yield* snapshotStaged(gitdir, tmp.directory)
    const bulkStaged = staged.split("\n").filter((line) => line.startsWith("bulk/"))
    // Every bulk file is exactly SUB_LIMIT_BYTES, so the staged total is exact.
    expect(bulkStaged.length * SUB_LIMIT_BYTES).toBeLessThanOrEqual(BUDGET_BYTES)
    expect(bulkStaged.length).toBeLessThan(80)
  }),
  { git: true },
)
