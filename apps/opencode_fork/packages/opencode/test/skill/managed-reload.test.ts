import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import { Skill } from "../../src/skill"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("managed skill reload", () => {
  it.live("a library edit and deletion become visible in both already-open directories", () =>
    Effect.gen(function* () {
      const library = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const first = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true, config: { skills: { paths: [library.path] } } })),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const second = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true, config: { skills: { paths: [library.path] } } })),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const file = path.join(library.path, "shared-smoke", "SKILL.md")
      const content = (body: string) => `---\nname: shared-smoke\ndescription: Private shared library regression\n---\n\n${body}\n`
      const read = (directory: string) => Effect.gen(function* () {
        const skill = yield* Skill.Service
        return (yield* skill.all()).find((row) => row.name === "shared-smoke")?.content ?? null
      }).pipe(provideInstance(directory))
      const reload = Effect.gen(function* () {
        const skill = yield* Skill.Service
        yield* skill.reload()
      }).pipe(provideInstance(first.path))

      yield* Effect.promise(() => Bun.write(file, content("Original private body")))
      expect(yield* read(first.path)).toContain("Original private body")
      expect(yield* read(second.path)).toContain("Original private body")
      yield* Effect.promise(() => Bun.write(file, content("Edited private body")))
      yield* reload
      expect(yield* read(first.path)).toContain("Edited private body")
      expect(yield* read(second.path)).toContain("Edited private body")
      yield* Effect.promise(() => Bun.file(file).delete())
      yield* reload
      expect(yield* read(first.path)).toBeNull()
      expect(yield* read(second.path)).toBeNull()
    }),
  )
})
