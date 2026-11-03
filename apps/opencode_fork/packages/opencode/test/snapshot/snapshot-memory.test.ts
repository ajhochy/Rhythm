import { afterEach, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer } from "effect"
import { Snapshot } from "../../src/snapshot"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Snapshot.defaultLayer, AppFileSystem.defaultLayer))

afterEach(async () => {
  await disposeAllInstances()
})

const write = (file: string, content: string) =>
  AppFileSystem.Service.use((fs) => fs.writeWithDirs(file, content))

it.instance(
  "issue-1603-c3: diffFull preserves small exact patches and counts while explicitly omitting oversized content",
  Effect.gen(function* () {
    const { directory } = yield* TestInstance
    const snapshot = yield* Snapshot.Service
    yield* write(`${directory}/small.txt`, "before\n")
    const before = yield* snapshot.track()
    expect(before).toBeTruthy()

    yield* write(`${directory}/small.txt`, "after\n")
    yield* write(`${directory}/oversized.txt`, "x".repeat(300 * 1024))
    // Sixteen distinct 200 KiB objects exceed a 1 MiB aggregate patch budget
    // without using incident-sized files or touching a real worktree.
    for (let index = 0; index < 16; index++) {
      const content = Array.from({ length: 3200 }, (_, line) =>
        `${index.toString().padStart(2, "0")}-${line.toString().padStart(4, "0")}-${"v".repeat(48)}\n`,
      ).join("")
      yield* write(`${directory}/many-${index.toString().padStart(2, "0")}.txt`, content)
    }
    const after = yield* snapshot.track()
    expect(after).toBeTruthy()

    const diffs = yield* snapshot.diffFull(before!, after!)
    expect(diffs).toHaveLength(18)
    const small = diffs.find((diff) => diff.file === "small.txt")
    expect(small?.patch).toContain("+after")
    expect(small?.patch).toContain("-before")
    expect(small?.status).toBe("modified")

    const oversized = diffs.find((diff) => diff.file === "oversized.txt")
    expect(oversized?.status).toBe("added")
    expect(oversized?.additions).toBeGreaterThan(0)
    expect(oversized?.patch).toBe("")
    expect(oversized?.patchOmitted).toBe("file_too_large")

    const omitted = diffs.filter((diff) => diff.patchOmitted)
    expect(omitted.length).toBeGreaterThan(1)
    expect(diffs.reduce((bytes, diff) => bytes + Buffer.byteLength(diff.patch ?? "", "utf8"), 0)).toBeLessThanOrEqual(
      1024 * 1024,
    )
    expect(diffs.every((diff) => diff.status && Number.isFinite(diff.additions) && Number.isFinite(diff.deletions))).toBe(
      true,
    )
  }),
  { git: true },
  { timeout: 30000 },
)

it.instance(
  "issue-1603-c4: safe scale multi-file diff remains within the aggregate patch budget",
  Effect.gen(function* () {
    const { directory } = yield* TestInstance
    const snapshot = yield* Snapshot.Service
    const before = yield* snapshot.track()
    expect(before).toBeTruthy()
    for (let index = 0; index < 8; index++) {
      const content = Array.from({ length: 3000 }, (_, line) =>
        `${index}-${line.toString().padStart(4, "0")}-${"q".repeat(50)}\n`,
      ).join("")
      yield* write(`${directory}/stress-${index}.txt`, content)
    }
    const after = yield* snapshot.track()
    expect(after).toBeTruthy()
    const diffs = yield* snapshot.diffFull(before!, after!)
    expect(diffs).toHaveLength(8)
    expect(diffs.reduce((bytes, diff) => bytes + Buffer.byteLength(diff.patch ?? "", "utf8"), 0)).toBeLessThanOrEqual(
      1024 * 1024,
    )
    expect(diffs.filter((diff) => diff.patchOmitted).length).toBeGreaterThan(0)
  }),
  { git: true },
  { timeout: 30000 },
)

it.instance(
  "issue-1603-c3: many small files have a bounded number of patch computations",
  Effect.gen(function* () {
    const { directory } = yield* TestInstance
    const snapshot = yield* Snapshot.Service
    const before = yield* snapshot.track()
    expect(before).toBeTruthy()
    for (let index = 0; index < 272; index++) {
      yield* write(`${directory}/tiny-${index.toString().padStart(2, "0")}.txt`, `file ${index}\n`)
    }
    const after = yield* snapshot.track()
    expect(after).toBeTruthy()
    const diffs = yield* snapshot.diffFull(before!, after!)
    expect(diffs).toHaveLength(272)
    expect(diffs.filter((diff) => diff.patch && !diff.patchOmitted)).toHaveLength(256)
    expect(diffs.filter((diff) => diff.patchOmitted === "work_budget_exceeded")).toHaveLength(16)
    expect(diffs.every((diff) => diff.status === "added" && diff.additions === 1)).toBe(true)
  }),
  { git: true },
  { timeout: 30000 },
)
