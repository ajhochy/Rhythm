import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const MAX_PROOF_LIFETIME_MS = 60_000
const MAX_INPUT_BYTES = 64 * 1024
const MAX_RESULT_BYTES = 1024 * 1024

export interface McpAppExecutionOrigin {
  sessionID: string
  callID: string
  serverName: string
  resourceUri: string
  cwd: string
}

export interface McpAppExecutionDependencies {
  appTools: () => Promise<
    Record<
      string,
      {
        key: string
        client: string
        name: string
        visibility: readonly ("model" | "app")[]
        inputSchema: unknown
      }
    >
  >
  isAllowed: (toolKey: string, tool: unknown) => Promise<boolean>
  validateInput: (schema: unknown, input: unknown) => Promise<boolean>
  approve: (toolKey: string, input: unknown) => Promise<void>
  before: (toolKey: string, input: unknown) => Promise<void>
  execute: (tool: unknown, input: unknown) => Promise<unknown>
  after: (toolKey: string, input: unknown, result: unknown) => Promise<void>
}

interface ProofPayload extends McpAppExecutionOrigin {
  contentHash: string
  expiresAt: number
  nonce: string
}

export class McpAppExecutionDenied extends Error {
  constructor() {
    super("app_execution_denied")
  }
}

function deny(): never {
  throw new McpAppExecutionDenied()
}

function validOrigin(origin: McpAppExecutionOrigin) {
  if (!origin.sessionID || !origin.callID || !origin.serverName || !origin.resourceUri || !origin.cwd) return false
  try {
    return new URL(origin.resourceUri).protocol === "ui:"
  } catch {
    return false
  }
}

/** Engine-owned, one-use HMAC authorization for an originating app call. */
export function createMcpAppExecutionGate(
  options: {
    secret?: string
    now?: () => number
    nonce?: () => string
  } = {},
) {
  const secret = options.secret ?? randomBytes(32).toString("base64url")
  const now = options.now ?? Date.now
  const nonce = options.nonce ?? (() => randomBytes(24).toString("base64url"))
  const consumed = new Set<string>()

  function sign(encoded: string) {
    return createHmac("sha256", secret).update(encoded).digest("base64url")
  }

  function issueProof(input: McpAppExecutionOrigin & { contentHash: string; expiresAt: number }) {
    const current = now()
    if (
      !validOrigin(input) ||
      !/^sha256:[a-f0-9]{64}$/.test(input.contentHash) ||
      !Number.isFinite(input.expiresAt) ||
      input.expiresAt <= current ||
      input.expiresAt - current > MAX_PROOF_LIFETIME_MS
    )
      deny()
    const payload: ProofPayload = { ...input, nonce: nonce() }
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
    return `${encoded}.${sign(encoded)}`
  }

  function verify(proof: string): ProofPayload {
    if (typeof proof !== "string" || proof.length > 8192) deny()
    const [encoded, signature, extra] = proof.split(".")
    if (!encoded || !signature || extra) deny()
    const expected = Buffer.from(sign(encoded))
    const actual = Buffer.from(signature)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) deny()
    let payload: ProofPayload
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    } catch {
      return deny()
    }
    if (!validOrigin(payload) || now() >= payload.expiresAt || consumed.has(payload.nonce)) deny()
    return payload
  }

  async function execute(
    request: {
      proof: string
      sessionID: string
      callID: string
      toolKey: string
      input: unknown
      origin?: McpAppExecutionOrigin
    },
    deps: McpAppExecutionDependencies,
  ) {
    const payload = verify(request.proof)
    if (
      request.sessionID !== payload.sessionID ||
      request.callID !== payload.callID ||
      (request.origin !== undefined &&
        (request.origin.sessionID !== payload.sessionID ||
          request.origin.callID !== payload.callID ||
          request.origin.serverName !== payload.serverName ||
          request.origin.resourceUri !== payload.resourceUri ||
          request.origin.cwd !== payload.cwd)) ||
      !request.toolKey ||
      !request.input ||
      typeof request.input !== "object" ||
      Array.isArray(request.input)
    )
      deny()
    try {
      if (Buffer.byteLength(JSON.stringify(request.input), "utf8") > MAX_INPUT_BYTES) deny()
    } catch {
      deny()
    }

    const registry = await deps.appTools()
    const tool = registry[request.toolKey]
    if (
      !tool ||
      tool.key !== request.toolKey ||
      tool.client !== payload.serverName ||
      !tool.visibility.includes("app") ||
      !(await deps.isAllowed(request.toolKey, tool)) ||
      !(await deps.validateInput(tool.inputSchema, request.input))
    )
      deny()

    // Consume before the first user interaction or external effect so concurrent
    // replay cannot create two permission prompts or two MCP calls.
    consumed.add(payload.nonce)
    await deps.before(request.toolKey, request.input)
    await deps.approve(request.toolKey, request.input)
    const raw = await deps.execute(tool, request.input)
    await deps.after(request.toolKey, request.input, raw)
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) deny()
    const result = raw as Record<string, unknown>
    const filtered = {
      ...(Array.isArray(result.content) ? { content: result.content } : {}),
      ...(Object.hasOwn(result, "structuredContent") ? { structuredContent: result.structuredContent } : {}),
      ...(typeof result.isError === "boolean" ? { isError: result.isError } : {}),
    }
    try {
      if (Buffer.byteLength(JSON.stringify(filtered), "utf8") > MAX_RESULT_BYTES) deny()
    } catch {
      deny()
    }
    return filtered
  }

  return { issueProof, execute }
}
