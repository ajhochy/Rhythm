import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"

export interface RhythmMcpCallIdentity {
  sdkSessionId: string
  turnId: string
  agentName: string
  toolCallId: string
}

export interface RhythmMcpCallProof {
  version: 1
  algorithm: "Ed25519"
  keyId: string
  issuedAt: number
  nonce: string
  toolName: string
  argumentsHash: string
  signature: string
}

export interface SignedRhythmMcpCall extends RhythmMcpCallIdentity {
  proof: RhythmMcpCallProof
}

const keys = generateKeyPairSync("ed25519")
const publicKeyDer = keys.publicKey.export({ format: "der", type: "spki" })
const keyId = createHash("sha256").update(publicKeyDer).digest("base64url")

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("MCP proof arguments must contain only finite JSON numbers")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((name) => `${JSON.stringify(name)}:${canonicalJson(record[name])}`)
      .join(",")}}`
  }
  throw new Error(`MCP proof arguments contain unsupported ${typeof value} value`)
}

function argumentsHash(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args)).digest("base64url")
}

function signingPayload(input: {
  context: RhythmMcpCallIdentity
  proof: Omit<RhythmMcpCallProof, "signature">
}): string {
  return JSON.stringify([
    "rhythm.mcp.tool-call.v1",
    input.proof.keyId,
    input.proof.issuedAt,
    input.proof.nonce,
    input.proof.toolName,
    input.proof.argumentsHash,
    input.context.sdkSessionId,
    input.context.turnId,
    input.context.agentName,
    input.context.toolCallId,
  ])
}

export function rhythmMcpPublicKey() {
  return {
    version: 1 as const,
    algorithm: "Ed25519" as const,
    keyId,
    publicKey: Buffer.from(publicKeyDer).toString("base64url"),
  }
}

export function signRhythmMcpCall(
  context: RhythmMcpCallIdentity,
  toolName: string,
  args: unknown,
): SignedRhythmMcpCall {
  const unsigned: Omit<RhythmMcpCallProof, "signature"> = {
    version: 1,
    algorithm: "Ed25519",
    keyId,
    issuedAt: Date.now(),
    nonce: randomBytes(18).toString("base64url"),
    toolName,
    argumentsHash: argumentsHash(args),
  }
  const signature = sign(null, Buffer.from(signingPayload({ context, proof: unsigned })), keys.privateKey).toString(
    "base64url",
  )
  return {
    ...context,
    proof: {
      ...unsigned,
      signature,
    },
  }
}
