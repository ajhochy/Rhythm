import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { MessageV2 } from "../../src/session/message-v2"
import * as Processor from "../../src/session/processor"
import * as SessionHandler from "../../src/server/routes/instance/httpapi/handlers/session"

const base = {
  id: "prt_01J5Y5H0AH4Q4NXJ6P4C3P5V2N",
  sessionID: "ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K",
  messageID: "msg_01J5Y5H0AH4Q4NXJ6P4C3P5V2M",
  type: "step-finish" as const,
  reason: "stop",
  cost: 0,
  tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
}

describe("#1576 trusted served provenance", () => {
  test("issue-1576-c1: StepFinishPart round-trips the exact optional bounded served contract", () => {
    const decode = Schema.decodeUnknownSync(MessageV2.StepFinishPart)
    const served = { modelID: "meta-llama/model:free", responseID: "gen-safe", requestModelID: "openrouter/free" }
    expect(decode({ ...base, served }).served).toEqual(served)
    expect(decode(base).served).toBeUndefined()
    expect(() => decode({ ...base, served: { modelID: "x".repeat(257) } })).toThrow()
    expect(() => decode({ ...base, served: { modelID: "ok", responseID: "x".repeat(257) } })).toThrow()
    expect(() => decode({ ...base, served: { modelID: "ok", requestModelID: "x".repeat(257) } })).toThrow()
  })

  test("issue-1576-c2: finish-step uses provider identity, omits SDK ids, and falls back to the wire model", () => {
    const stamp = (Processor as unknown as Record<string, Function>).servedIdentityFromFinishStep
    expect(typeof stamp).toBe("function")
    expect(stamp({ response: { modelId: "concrete/model", id: "gen-provider" } }, "wire/model", "openrouter/free")).toEqual({
      modelID: "concrete/model",
      responseID: "gen-provider",
      requestModelID: "openrouter/free",
    })
    expect(stamp({ response: { modelId: "", id: "aitxt-local" } }, "wire/model", "openrouter/free")).toEqual({
      modelID: "wire/model",
      requestModelID: "openrouter/free",
    })
    expect(stamp({ response: { modelId: "x".repeat(257), id: "x".repeat(257) } }, "wire/model", "openrouter/free")).toEqual({
      modelID: "wire/model",
      requestModelID: "openrouter/free",
    })
  })

  test("issue-1576-c3: client part updates preserve stored served and cannot create or remove it", () => {
    const merge = (SessionHandler as unknown as Record<string, Function>).preserveTrustedServed
    expect(typeof merge).toBe("function")
    const trusted = { ...base, served: { modelID: "concrete/model", responseID: "gen-provider", requestModelID: "openrouter/free" } }
    expect(merge(trusted, { ...base, served: { modelID: "forged" } }).served).toEqual(trusted.served)
    expect(merge(trusted, base).served).toEqual(trusted.served)
    expect(merge(base, { ...base, served: { modelID: "forged" } })).not.toHaveProperty("served")
  })
})
