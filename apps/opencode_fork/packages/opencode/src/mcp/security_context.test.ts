import { describe, expect, it } from "bun:test"
import {
  RHYTHM_SECURITY_CONTEXT_META_KEY,
  rhythmSecurityRequestMeta,
  withRhythmSecurityContext,
} from "./index"
import { rhythmMcpPublicKey } from "@/security/rhythm-mcp-proof"
import { createHash, createPublicKey, verify } from "node:crypto"

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

  it("keeps a deferred MCP request bound to the real outer native call and rejects tampering", () => {
    const context = {
      sdkSessionId: "sdk-deferred",
      turnId: "assistant-native",
      agentName: "secretary",
      toolCallId: "native-dispatch-call",
    }
    const options = withRhythmSecurityContext(
      { toolCallId: context.toolCallId, messages: [], abortSignal: new AbortController().signal },
      context,
    )
    const args = { query: "current plan" }
    const signed = rhythmSecurityRequestMeta(options, "rhythm_search_memory", args)?.[
      RHYTHM_SECURITY_CONTEXT_META_KEY
    ] as (typeof context & {
      proof: {
        keyId: string
        issuedAt: number
        nonce: string
        toolName: string
        argumentsHash: string
        signature: string
      }
    })
    const publicKey = createPublicKey({
      key: Buffer.from(rhythmMcpPublicKey().publicKey, "base64url"),
      format: "der",
      type: "spki",
    })
    const payload = (input: {
      sdkSessionId: string
      turnId: string
      agentName: string
      toolCallId: string
      toolName: string
      argumentsHash: string
    }) =>
      JSON.stringify([
        "rhythm.mcp.tool-call.v1",
        signed.proof.keyId,
        signed.proof.issuedAt,
        signed.proof.nonce,
        input.toolName,
        input.argumentsHash,
        input.sdkSessionId,
        input.turnId,
        input.agentName,
        input.toolCallId,
      ])

    expect(signed.toolCallId).toBe("native-dispatch-call")
    expect(
      verify(
        null,
        Buffer.from(payload({ ...context, toolName: "rhythm_search_memory", argumentsHash: signed.proof.argumentsHash })),
        publicKey,
        Buffer.from(signed.proof.signature, "base64url"),
      ),
    ).toBe(true)
    expect(
      verify(
        null,
        Buffer.from(payload({ ...context, toolCallId: "forged-call", toolName: "rhythm_search_memory", argumentsHash: signed.proof.argumentsHash })),
        publicKey,
        Buffer.from(signed.proof.signature, "base64url"),
      ),
    ).toBe(false)
    expect(
      verify(
        null,
        Buffer.from(payload({ ...context, toolName: "rhythm_search_dayflow_activity", argumentsHash: signed.proof.argumentsHash })),
        publicKey,
        Buffer.from(signed.proof.signature, "base64url"),
      ),
    ).toBe(false)
    expect(
      verify(
        null,
        Buffer.from(payload({
          ...context,
          toolName: "rhythm_search_memory",
          argumentsHash: createHash("sha256").update(JSON.stringify({ query: "forged" })).digest("base64url"),
        })),
        publicKey,
        Buffer.from(signed.proof.signature, "base64url"),
      ),
    ).toBe(false)
  })
})
