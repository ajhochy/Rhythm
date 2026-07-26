import { describe, expect, it } from "bun:test"
import {
  RHYTHM_SECURITY_CONTEXT_META_KEY,
  rhythmSecurityRequestMeta,
  withRhythmSecurityContext,
} from "./index"
import { rhythmMcpPublicKey } from "@/security/rhythm-mcp-proof"
import { createPublicKey, verify } from "node:crypto"

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
    const args = { id: "openmontage", nested: { z: 1, a: true } }
    const meta = rhythmSecurityRequestMeta(
      trustedOptions,
      "rhythm_install_creative_capability",
      args,
    )
    const signed = meta?.[RHYTHM_SECURITY_CONTEXT_META_KEY] as
      | (typeof context & {
          proof: {
            keyId: string
            issuedAt: number
            nonce: string
            toolName: string
            argumentsHash: string
            signature: string
          }
        })
      | undefined
    expect(signed).toMatchObject({
      ...context,
      proof: {
        keyId: rhythmMcpPublicKey().keyId,
        toolName: "rhythm_install_creative_capability",
      },
    })
    const payload = JSON.stringify([
      "rhythm.mcp.tool-call.v1",
      signed!.proof.keyId,
      signed!.proof.issuedAt,
      signed!.proof.nonce,
      signed!.proof.toolName,
      signed!.proof.argumentsHash,
      context.sdkSessionId,
      context.turnId,
      context.agentName,
      context.toolCallId,
    ])
    expect(
      verify(
        null,
        Buffer.from(payload),
        createPublicKey({
          key: Buffer.from(rhythmMcpPublicKey().publicKey, "base64url"),
          format: "der",
          type: "spki",
        }),
        Buffer.from(signed!.proof.signature, "base64url"),
      ),
    ).toBe(true)
    expect(
      rhythmSecurityRequestMeta(
        options,
        "rhythm_install_creative_capability",
        args,
      ),
    ).toBeUndefined()
    expect(options).not.toHaveProperty(RHYTHM_SECURITY_CONTEXT_META_KEY)
  })
})
