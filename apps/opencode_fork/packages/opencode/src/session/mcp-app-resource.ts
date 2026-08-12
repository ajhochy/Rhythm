const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"
const MAX_RESOURCE_BYTES = 1024 * 1024
const MAX_PROVENANCE_LIFETIME_MS = 10 * 60 * 1000
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface McpAppResourceProvenance {
  sessionID: string
  callID: string
  serverName: string
  cwd: string
  resourceUri: string
  advertisedAt: string
  expiresAt: string
}

interface ResourceReadDependencies {
  readResource: (input: {
    serverName: string
    resourceUri: string
    cwd: string
  }) => Promise<unknown>
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function timestamp(value: unknown): number | undefined {
  if (!nonEmptyString(value) || !ISO_Z.test(value)) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function isValidMcpAppResourceProvenance(value: unknown): value is McpAppResourceProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const origin = value as Record<string, unknown>
  if (
    !nonEmptyString(origin.sessionID) ||
    !nonEmptyString(origin.callID) ||
    !nonEmptyString(origin.serverName) ||
    !nonEmptyString(origin.cwd) ||
    !nonEmptyString(origin.resourceUri)
  ) {
    return false
  }
  try {
    if (new URL(origin.resourceUri).protocol !== "ui:") return false
  } catch {
    return false
  }
  const advertisedAt = timestamp(origin.advertisedAt)
  const expiresAt = timestamp(origin.expiresAt)
  return (
    advertisedAt !== undefined &&
    expiresAt !== undefined &&
    expiresAt > advertisedAt &&
    expiresAt - advertisedAt <= MAX_PROVENANCE_LIFETIME_MS
  )
}

export async function readSessionBoundMcpAppResource(
  input: Record<string, unknown>,
  dependencies: ResourceReadDependencies,
): Promise<{ mimeType: typeof MCP_APP_MIME_TYPE; text: string }> {
  if (input.mode !== "readonly" && input.mode !== "interactive") throw new Error("resource unavailable")
  if (Object.hasOwn(input, "resourceUri") || Object.hasOwn(input, "serverName")) throw new Error("resource unavailable")
  if (!isValidMcpAppResourceProvenance(input.persistedOrigin)) throw new Error("resource unavailable")

  const origin = input.persistedOrigin
  const now = timestamp(input.now)
  const advertisedAt = timestamp(origin.advertisedAt)
  const expiresAt = timestamp(origin.expiresAt)
  if (
    now === undefined ||
    advertisedAt === undefined ||
    expiresAt === undefined ||
    now < advertisedAt ||
    now >= expiresAt ||
    input.sessionID !== origin.sessionID ||
    input.callID !== origin.callID ||
    input.cwd !== origin.cwd
  ) {
    throw new Error("resource unavailable")
  }

  const response = await dependencies.readResource({
    serverName: origin.serverName,
    resourceUri: origin.resourceUri,
    cwd: origin.cwd,
  })
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("resource unavailable")
  const contents = (response as Record<string, unknown>).contents
  if (!Array.isArray(contents) || contents.length !== 1) throw new Error("resource unavailable")
  const content = contents[0]
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("resource unavailable")
  const item = content as Record<string, unknown>
  if (
    item.uri !== origin.resourceUri ||
    item.mimeType !== MCP_APP_MIME_TYPE ||
    typeof item.text !== "string" ||
    Object.hasOwn(item, "blob") ||
    new TextEncoder().encode(item.text).byteLength > MAX_RESOURCE_BYTES
  ) {
    throw new Error("resource unavailable")
  }
  return { mimeType: MCP_APP_MIME_TYPE, text: item.text }
}
