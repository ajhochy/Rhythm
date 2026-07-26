type JsonObject = Record<string, unknown>

function compareText(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function isRefOnly(value: unknown): value is { $ref: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length === 1 && entries[0]?.[0] === "$ref" && typeof entries[0][1] === "string"
}

function canonicalizeValue(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeValue(item))
    if ((key === "anyOf" || key === "oneOf") && items.every(isRefOnly)) {
      return items.sort((left, right) => compareText(left.$ref, right.$ref))
    }
    return items
  }
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as JsonObject).map(([childKey, childValue]) => [
      childKey,
      canonicalizeValue(childValue, childKey),
    ]),
  )
}

/**
 * OpenAPI component maps and ref-only unions are semantically unordered, but
 * Effect can emit them in platform-dependent module traversal order. Normalize
 * only those structures so macOS and Linux generate the same committed SDK.
 */
export function canonicalizeOpenApi<T>(input: T): T {
  const result = canonicalizeValue(input) as JsonObject
  const components = result.components
  if (!components || typeof components !== "object" || Array.isArray(components)) return result as T
  const schemas = (components as JsonObject).schemas
  if (!schemas || typeof schemas !== "object" || Array.isArray(schemas)) return result as T
  ;(components as JsonObject).schemas = Object.fromEntries(
    Object.entries(schemas as JsonObject).sort(([left], [right]) => compareText(left, right)),
  )
  return result as T
}
