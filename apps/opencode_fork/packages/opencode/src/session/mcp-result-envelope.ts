const MAX_MCP_RESULT_ENVELOPE_BYTES = 1024 * 1024

export interface McpResultEnvelope {
  structuredContent?: unknown
  _meta?: Record<string, unknown>
  isError?: boolean
}

/**
 * Retain only the standard MCP result fields that clients can consume safely.
 * The readable text result remains the primary fallback when the envelope is
 * absent, malformed, not JSON-serializable, or too large to persist.
 */
export function mcpResultEnvelope(result: unknown): McpResultEnvelope | undefined {
  if (typeof result !== "object" || result === null) return undefined
  const value = result as Record<string, unknown>
  const envelope: McpResultEnvelope = {}

  if (Object.prototype.hasOwnProperty.call(value, "structuredContent")) {
    envelope.structuredContent = value.structuredContent
  }
  if (typeof value._meta === "object" && value._meta !== null && !Array.isArray(value._meta)) {
    envelope._meta = value._meta as Record<string, unknown>
  }
  if (typeof value.isError === "boolean") envelope.isError = value.isError
  if (Object.keys(envelope).length === 0) return undefined

  try {
    const encoded = JSON.stringify(envelope)
    if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > MAX_MCP_RESULT_ENVELOPE_BYTES) {
      return undefined
    }
    return JSON.parse(encoded) as McpResultEnvelope
  } catch {
    return undefined
  }
}
