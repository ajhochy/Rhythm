import { describe, expect, test } from "bun:test"
import {
  buildDeferredToolCatalog,
  DEFERRED_MCP_BOOTSTRAP_MAX_BYTES,
  formatDeferredToolCatalog,
  isMcpToolDeferred,
  MCP_DEFERRED_BOOTSTRAP_TOOL_IDS,
  measureSerializedMcpToolSurface,
  parseDeferredMcpDispatchRequest,
  searchDeferredToolCatalog,
  validateDeferredMcpArguments,
} from "./mcp_deferred_tools"

describe("task-lazy-default acceptance", () => {
  test("task-lazy-default-c1: legacy and new session fields default to deferred tools", () => {
    const mapping = { rhythm_rhythm_ping: "rhythm" }
    expect(isMcpToolDeferred("rhythm_rhythm_ping", mapping, undefined)).toBe(true)
    expect(isMcpToolDeferred("rhythm_rhythm_ping", mapping, {})).toBe(true)
  })
  test("task-lazy-default-c2: bootstrap catalog stays bounded for a large actual inventory", () => {
    const keys = Array.from({ length: 500 }, (_, i) => `fixture_tool_${i}`)
    const servers = Object.fromEntries(keys.map(k => [k, "fixture"]))
    const descriptions = Object.fromEntries(keys.map(k => [k, "Long schema discovery fixture description. ".repeat(30)]))
    const text = formatDeferredToolCatalog(buildDeferredToolCatalog(keys, servers, descriptions))
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(6000)
  })

  test("task-lazy-default-c3/c8: bounded bootstrap discovers a tail tool through the only eager control tool", () => {
    const keys = Array.from({ length: 500 }, (_, i) => `fixture_tool_${i}`)
    const servers = Object.fromEntries(keys.map((key) => [key, "fixture"]))
    const descriptions = Object.fromEntries(
      keys.map((key) => [key, `Searchable detail for ${key}. `.repeat(30)]),
    )
    const catalog = buildDeferredToolCatalog(keys, servers, descriptions)
    const bootstrap = formatDeferredToolCatalog(catalog)

    expect(Buffer.byteLength(bootstrap, "utf8")).toBeLessThanOrEqual(DEFERRED_MCP_BOOTSTRAP_MAX_BYTES)
    expect(MCP_DEFERRED_BOOTSTRAP_TOOL_IDS).toEqual(["mcp_dispatch"])
    expect(searchDeferredToolCatalog(catalog, "fixture_tool_499")).toEqual([
      expect.objectContaining({ name: "fixture_tool_499", server: "fixture" }),
    ])
    expect(parseDeferredMcpDispatchRequest({ name: "fixture_tool_499", arguments: { required: true } })).toEqual({
      action: "execute",
      name: "fixture_tool_499",
      arguments: { required: true },
    })
    expect(parseDeferredMcpDispatchRequest({ action: "describe", name: "fixture_tool_499" })).toEqual({
      action: "describe",
      name: "fixture_tool_499",
    })
  })

  test("task-lazy-default-c4/c7: dispatcher input rejects malformed arguments and measures serialized definitions separately", () => {
    const definitions = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [
        `fixture_tool_${i}`,
        {
          description: `Long schema discovery fixture description ${i}. `.repeat(30),
          inputSchema: {
            type: "object",
            properties: {
              payload: { type: "string", description: "Required fixture payload. ".repeat(20) },
            },
            required: ["payload"],
            additionalProperties: false,
          },
        },
      ]),
    )
    const bootstrap = formatDeferredToolCatalog(
      buildDeferredToolCatalog(
        Object.keys(definitions),
        Object.fromEntries(Object.keys(definitions).map((key) => [key, "fixture"])),
        Object.fromEntries(
          Object.entries(definitions).map(([key, value]) => [key, value.description]),
        ),
      ),
    )
    const measured = measureSerializedMcpToolSurface({
      eagerDefinitions: definitions,
      lazyBootstrap: {
        name: "mcp_dispatch",
        description: bootstrap,
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["search", "describe", "execute"] },
            name: { type: "string" },
            arguments: { type: "object" },
          },
        },
      },
    })

    expect(measured.eagerDefinitionBytes).toBeGreaterThan(6000)
    expect(measured.lazyBootstrapBytes).toBeLessThanOrEqual(DEFERRED_MCP_BOOTSTRAP_MAX_BYTES)
    expect(measured.eagerBytesDiv4Estimate).toBe(Math.ceil(measured.eagerDefinitionBytes / 4))
    expect(measured.lazyBytesDiv4Estimate).toBe(Math.ceil(measured.lazyBootstrapBytes / 4))
    expect(() => parseDeferredMcpDispatchRequest({ name: "fixture_tool_1", arguments: [] })).toThrow(
      "arguments must be a JSON object",
    )
  })

  test("F3: byte counters are exact UTF-8 bytes, not JS characters, for non-ASCII definitions", () => {
    const definition = { description: "naïve café 日本語 🚀" }
    const serialized = JSON.stringify(definition)
    const measured = measureSerializedMcpToolSurface({ eagerDefinitions: definition, lazyBootstrap: definition })

    expect(measured.eagerDefinitionBytes).toBe(Buffer.byteLength(serialized, "utf8"))
    expect(measured.eagerDefinitionBytes).toBeGreaterThan(serialized.length)
    expect(measured.eagerBytesDiv4Estimate).toBe(Math.ceil(Buffer.byteLength(serialized, "utf8") / 4))
    expect(measured.eagerBytesDiv4Estimate).toBeGreaterThan(Math.ceil(serialized.length / 4))
  })

  test("F1: selected arguments are validated against the advertised JSON schema; unusable schemas fail closed", () => {
    const schema = {
      type: "object",
      properties: {
        payload: { type: "string" },
        nested: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
      },
      required: ["payload"],
      additionalProperties: false,
    }
    expect(validateDeferredMcpArguments(schema, { payload: "ok" })).toBeUndefined()
    expect(validateDeferredMcpArguments(schema, { payload: "ok", nested: { n: 1 } })).toBeUndefined()
    expect(validateDeferredMcpArguments(schema, {})).toBeString()
    expect(validateDeferredMcpArguments(schema, { payload: 1 })).toBeString()
    expect(validateDeferredMcpArguments(schema, { payload: "ok", extra: true })).toBeString()
    expect(validateDeferredMcpArguments(schema, { payload: "ok", nested: { n: "x" } })).toBeString()
    expect(validateDeferredMcpArguments(undefined, {})).toBeString()
  })

  test("builtin family: explicit namespace parses, unknown family fails, catalog lists builtin names compactly", () => {
    expect(parseDeferredMcpDispatchRequest({ action: "describe", name: "read", family: "builtin" })).toEqual({
      action: "describe",
      name: "read",
      family: "builtin",
    })
    expect(() => parseDeferredMcpDispatchRequest({ name: "read", family: "other" })).toThrow("family must be")
    const entries = [
      { name: "read", server: "builtin", description: "Read a file", family: "builtin" as const },
      { name: "rhythm_ping", server: "rhythm", description: "ping" },
    ]
    const text = formatDeferredToolCatalog(entries)
    expect(text).toContain('<builtin_tools family="builtin">read</builtin_tools>')
    expect(text).toContain("<name>rhythm_ping</name>")
    expect(text).not.toContain("<name>read</name>")
    expect(searchDeferredToolCatalog(entries, "read", undefined, "mcp")).toEqual([])
    expect(searchDeferredToolCatalog(entries, "read", undefined, "builtin")).toHaveLength(1)
  })

  test("F1: 2020-12-only keywords are refused, not silently ignored; $id is never reused across schemas", () => {
    const prefix = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { value: { type: "array", prefixItems: [{ type: "integer" }] } },
    }
    expect(validateDeferredMcpArguments(prefix, { value: ["wrong"] })).toContain("prefixItems")
    expect(validateDeferredMcpArguments(prefix, { value: [1] })).toContain("prefixItems")
    // A property merely NAMED like a keyword is data, not a keyword.
    const named = { type: "object", properties: { prefixItems: { type: "string" } }, required: ["prefixItems"] }
    expect(validateDeferredMcpArguments(named, { prefixItems: "x" })).toBeUndefined()
    // Declared 2020-12 with only enforceable keywords still validates.
    const plain = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", required: ["a"] }
    expect(validateDeferredMcpArguments(plain, {})).toBeString()
    expect(validateDeferredMcpArguments(plain, { a: 1 })).toBeUndefined()
    // Same $id, changed schema (and a second tool) each validate against their own definition.
    const v1 = { $id: "https://example.test/s.json", type: "object", required: ["payload"] }
    const v2 = { $id: "https://example.test/s.json", type: "object", required: ["must"] }
    expect(validateDeferredMcpArguments(v1, { payload: "ok" })).toBeUndefined()
    expect(validateDeferredMcpArguments(v2, { payload: "ok" })).toBeString()
    expect(validateDeferredMcpArguments(v2, { must: 1 })).toBeUndefined()
  })
})
