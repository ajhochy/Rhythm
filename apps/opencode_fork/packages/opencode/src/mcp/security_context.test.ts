import { describe, expect, it } from "bun:test"
import {
  RHYTHM_SECURITY_CONTEXT_META_KEY,
  rhythmSecurityRequestMeta,
  withRhythmSecurityContext,
} from "./index"

describe("#1134 MCP security context", () => {
  it("moves engine-owned session turn agent and call identity into request metadata", () => {
    const options = {
      toolCallId: "call-one",
      messages: [],
      abortSignal: new AbortController().signal,
    }
    const context = {
      sdkSessionId: "sdk-one",
      turnId: "turn-one",
      agentName: "email-assistant",
      toolCallId: "call-one",
    }

    const trustedOptions = withRhythmSecurityContext(options, context)
    expect(rhythmSecurityRequestMeta(trustedOptions)).toEqual({
      [RHYTHM_SECURITY_CONTEXT_META_KEY]: context,
    })
    expect(rhythmSecurityRequestMeta(options)).toBeUndefined()
    expect(options).not.toHaveProperty(RHYTHM_SECURITY_CONTEXT_META_KEY)
  })
})
