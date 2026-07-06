import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import * as ProviderError from "@/provider/error"
import { ProviderID } from "../../src/provider/schema"

function bodylessError(statusCode: number) {
  return new APICallError({
    message: `${statusCode} (no body)`,
    url: "https://example.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  })
}

describe("ProviderError.parseAPICallError - bodyless overflow narrowing", () => {
  test("treats a bodyless 413 as context_overflow regardless of provider", () => {
    const result = ProviderError.parseAPICallError({
      providerID: ProviderID.make("openrouter"),
      error: bodylessError(413),
    })
    expect(result.type).toBe("context_overflow")
  })

  test("treats a bodyless 400 as context_overflow for cerebras", () => {
    const result = ProviderError.parseAPICallError({
      providerID: ProviderID.make("cerebras"),
      error: bodylessError(400),
    })
    expect(result.type).toBe("context_overflow")
  })

  test("treats a bodyless 400 as context_overflow for mistral", () => {
    const result = ProviderError.parseAPICallError({
      providerID: ProviderID.make("mistral"),
      error: bodylessError(400),
    })
    expect(result.type).toBe("context_overflow")
  })

  test("does NOT treat a bodyless 400 as overflow for a provider not on the allowlist", () => {
    // This is the concrete bug from issue #913: a proxy strips the body from a
    // tool_use/tool_result pairing 400, which used to be misclassified as
    // context_overflow and fed the compact -> continue -> compact loop.
    const result = ProviderError.parseAPICallError({
      providerID: ProviderID.make("anthropic"),
      error: bodylessError(400),
    })
    expect(result.type).toBe("api_error")
  })

  test("still matches known overflow message patterns regardless of provider", () => {
    const error = new APICallError({
      message: "prompt is too long: 250000 tokens > 200000 maximum",
      url: "https://example.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 400,
      isRetryable: false,
    })
    const result = ProviderError.parseAPICallError({ providerID: ProviderID.make("anthropic"), error })
    expect(result.type).toBe("context_overflow")
  })
})
