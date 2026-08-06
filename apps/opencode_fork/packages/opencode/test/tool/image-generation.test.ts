import { describe, expect, test } from "bun:test"
import { readFile, rm } from "node:fs/promises"
import { Permission } from "../../src/permission"
import * as ImageGeneration from "../../src/tool/image-generation"
import type { Provider } from "../../src/provider/provider"

const OPENAI = { providerID: "openai", api: { npm: "@ai-sdk/openai" } } as Pick<
  Provider.Model,
  "providerID" | "api"
>
const ANTHROPIC = { providerID: "anthropic", api: { npm: "@ai-sdk/anthropic" } } as Pick<
  Provider.Model,
  "providerID" | "api"
>

/** The catch-all rule nearly every agent inherits from the built-in defaults. */
const ALLOW_ALL = Permission.fromConfig({ "*": "allow" })

describe("image_generation permission gate", () => {
  test("offered when the profile grants it explicitly", () => {
    const ruleset = Permission.merge(ALLOW_ALL, Permission.fromConfig({ image_generation: "allow" }))
    expect(ImageGeneration.enabledFor(OPENAI, ruleset)).toBe("allow")
  })

  test("not offered when the profile never names it", () => {
    // The default "*": "allow" must not turn this on by itself — that would
    // hand native image generation to every profile, not the ones toggled on.
    expect(ImageGeneration.enabledFor(OPENAI, ALLOW_ALL)).toBeUndefined()
    expect(ImageGeneration.enabledFor(OPENAI, [])).toBeUndefined()
  })

  test("not offered when explicitly denied", () => {
    const ruleset = Permission.merge(ALLOW_ALL, Permission.fromConfig({ image_generation: "deny" }))
    expect(ImageGeneration.enabledFor(OPENAI, ruleset)).toBeUndefined()
  })

  test("reports ask so the caller can run the approval flow", () => {
    const ruleset = Permission.fromConfig({ image_generation: "ask" })
    expect(ImageGeneration.enabledFor(OPENAI, ruleset)).toBe("ask")
  })

  test("last matching rule wins", () => {
    const ruleset = Permission.merge(
      Permission.fromConfig({ image_generation: "allow" }),
      Permission.fromConfig({ image_generation: "deny" }),
    )
    expect(ImageGeneration.enabledFor(OPENAI, ruleset)).toBeUndefined()
  })

  test("degrades quietly on a non-OpenAI model even when granted", () => {
    const ruleset = Permission.fromConfig({ image_generation: "allow" })
    expect(ImageGeneration.enabledFor(ANTHROPIC, ruleset)).toBeUndefined()
  })
})

describe("image_generation provider tool", () => {
  test("is a provider tool, not a locally executed one", () => {
    const tool = ImageGeneration.tool() as any
    expect(tool.type).toBe("provider")
    expect(tool.id).toBe("openai.image_generation")
    // A local execute would need a platform API key, which this machine has no
    // way to obtain — the whole point is riding the chat turn's connection.
    expect(tool.execute).toBeUndefined()
  })

  test("recognizes the provider result payload", () => {
    expect(ImageGeneration.isProviderResult({ result: "abc" })).toBe(true)
    expect(ImageGeneration.isProviderResult({ output: "abc" })).toBe(false)
    expect(ImageGeneration.isProviderResult(undefined)).toBe(false)
  })

  test("persists the image and returns its path as the tool output", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex")
    const result = await ImageGeneration.persist(png.toString("base64"))
    try {
      expect(result.metadata.path).toEndWith(".png")
      expect(result.output).toContain(result.metadata.path)
      // The bytes must not ride along in the output — they would be re-sent to
      // the model on every subsequent turn.
      expect(result.output).not.toContain(png.toString("base64"))
      expect(await readFile(result.metadata.path)).toEqual(png)
    } finally {
      await rm(result.metadata.path, { force: true })
    }
  })
})
