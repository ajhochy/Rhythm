import { describe, expect, test } from "bun:test"
import { isSpuriousStreamPartError } from "../../src/session/processor"

describe("isSpuriousStreamPartError", () => {
  test("true for a reasoning part not-found string", () => {
    expect(isSpuriousStreamPartError("reasoning part rs_abc:0 not found")).toBe(true)
  })

  test("true for a text part not-found string", () => {
    expect(isSpuriousStreamPartError("text part txt_1 not found")).toBe(true)
  })

  test("true for a reasoning part not-found Error", () => {
    expect(isSpuriousStreamPartError(new Error("reasoning part rs_abc:0 not found"))).toBe(true)
  })

  test("true for a text part not-found Error", () => {
    expect(isSpuriousStreamPartError(new Error("text part txt_1 not found"))).toBe(true)
  })

  test("false for an unrelated string", () => {
    expect(isSpuriousStreamPartError("rate limit")).toBe(false)
  })

  test("false for an empty string", () => {
    expect(isSpuriousStreamPartError("")).toBe(false)
  })

  test("false for an API error object", () => {
    expect(isSpuriousStreamPartError({ name: "APIError", message: "no_kv_space" })).toBe(false)
  })

  test("false for an unrelated Error", () => {
    expect(isSpuriousStreamPartError(new Error("rate limit"))).toBe(false)
  })
})
