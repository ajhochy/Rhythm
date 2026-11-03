import { describe, expect, test } from "bun:test"
import { CodexAuthPlugin } from "../../src/plugin/codex"

const ids = [
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
  "gpt-5.4",
  "gpt-7-luna",
]

const provider = {
  id: "openai",
  models: Object.fromEntries(
    ids.map((id) => [id, {
      id,
      api: { id },
      cost: { input: 1, output: 2, cache: { read: 0.5, write: 0.5 } },
      limit: { context: 100_000, input: 90_000, output: 10_000 },
    }]),
  ),
}

describe("Codex OAuth model catalog", () => {
  test("keeps all three configured GPT-6 Grid routes without admitting unknown integer models", async () => {
    const hooks = await CodexAuthPlugin({ client: {} } as never)
    const models = await hooks.provider!.models!(provider as never, {
      auth: { type: "oauth", access: "synthetic", refresh: "", expires: Date.now() + 60_000 },
    } as never)

    expect(Object.keys(models)).toEqual([
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-6.1-sol",
      "gpt-5.4",
    ])
    expect(models["gpt-6-luna"].cost.output).toBe(0)
  })

  test("leaves the non-OAuth provider catalog unchanged", async () => {
    const hooks = await CodexAuthPlugin({ client: {} } as never)
    const models = await hooks.provider!.models!(provider as never, { auth: undefined } as never)

    expect(models).toBe(provider.models as never)
  })
})
