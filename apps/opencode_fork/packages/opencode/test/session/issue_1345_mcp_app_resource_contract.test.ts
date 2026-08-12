import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { MessageV2 } from "../../src/session/message-v2"

const MIME = "text/html;profile=mcp-app"
const NOW = "2026-08-11T08:00:00.000Z"

type ResourcePolicy = (
  input: Record<string, unknown>,
  dependencies: {
    readResource: (input: { serverName: string; resourceUri: string; cwd: string }) => Promise<unknown>
  },
) => Promise<unknown>

async function policy(): Promise<ResourcePolicy | undefined> {
  try {
    const loaded = (await import("../../src/session/mcp-app-resource")) as {
      readSessionBoundMcpAppResource?: ResourcePolicy
    }
    return loaded.readSessionBoundMcpAppResource
  } catch {
    return undefined
  }
}

function origin(overrides: Record<string, unknown> = {}) {
  return {
    sessionID: "session-origin",
    callID: "call-origin",
    serverName: "calendar-server",
    cwd: "/workspace/origin",
    resourceUri: "ui://calendar/dashboard",
    advertisedAt: "2026-08-11T07:55:00.000Z",
    expiresAt: "2026-08-11T08:05:00.000Z",
    ...overrides,
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    mode: "readonly",
    sessionID: "session-origin",
    callID: "call-origin",
    cwd: "/workspace/origin",
    now: NOW,
    persistedOrigin: origin(),
    ...overrides,
  }
}

async function rejectable(value: Promise<unknown>): Promise<unknown> {
  try {
    return await value
  } catch {
    return undefined
  }
}

describe("issue #1345 session-bound MCP App resource policy", () => {
  test("issue-1345-c1: reads derive server and URI from persisted call metadata", async () => {
    // Regression caught: a URI supplied by the desktop becomes the authority.
    // The exact read arguments fail unless server, URI, and cwd come from the
    // persisted originating call while the request carries only session/call.
    const read = await policy()
    expect(read, "missing session-bound MCP App resource policy").toBeFunction()
    if (!read) return

    const reads: unknown[] = []
    const result = await read(request(), {
      readResource: async (input) => {
        reads.push(input)
        return { contents: [{ uri: input.resourceUri, mimeType: MIME, text: "<main>safe</main>" }] }
      },
    })

    expect(reads).toEqual([
      {
        serverName: "calendar-server",
        resourceUri: "ui://calendar/dashboard",
        cwd: "/workspace/origin",
      },
    ])
    expect(result).toEqual({ mimeType: MIME, text: "<main>safe</main>" })
  })

  test("issue-1345-c2: missing, expired, mismatched, cross-session, and cross-server requests fail closed", async () => {
    // Regression caught: one invalid binding still reaches MCP. Every hostile
    // case must return no renderable content and the read counter must stay 0.
    const read = await policy()
    expect(read, "missing session-bound MCP App resource policy").toBeFunction()
    if (!read) return

    const cases: Array<[string, Record<string, unknown>]> = [
      ["missing origin", { persistedOrigin: undefined }],
      ["missing server", { persistedOrigin: origin({ serverName: undefined }) }],
      ["missing advertised URI", { persistedOrigin: origin({ resourceUri: undefined }) }],
      ["missing originating session", { persistedOrigin: origin({ sessionID: undefined }) }],
      ["missing originating call", { persistedOrigin: origin({ callID: undefined }) }],
      ["missing originating cwd", { persistedOrigin: origin({ cwd: undefined }) }],
      ["missing advertised timestamp", { persistedOrigin: origin({ advertisedAt: undefined }) }],
      ["missing expiry", { persistedOrigin: origin({ expiresAt: undefined }) }],
      ["expired", { now: "2026-08-11T08:05:00.001Z" }],
      ["expired at boundary", { now: "2026-08-11T08:05:00.000Z" }],
      ["call mismatch", { callID: "call-other" }],
      ["cross session", { sessionID: "session-other" }],
      ["cwd mismatch", { cwd: "/workspace/other" }],
      ["caller URI", { resourceUri: "ui://attacker/forged" }],
      ["caller server", { serverName: "attacker-server" }],
      ["mode off", { mode: "off" }],
      ["unknown mode", { mode: "enabled" }],
    ]

    for (const [label, overrides] of cases) {
      let reads = 0
      const result = await rejectable(
        read(request(overrides), {
          readResource: async () => {
            reads++
            return { contents: [{ uri: "ui://forbidden", mimeType: MIME, text: "forbidden" }] }
          },
        }),
      )
      expect(result, label).toBeUndefined()
      expect(reads, `${label} performed an MCP read`).toBe(0)
    }
  })

  test("issue-1345-c3: only bounded text/html;profile=mcp-app content is returned", async () => {
    // Regression caught: blob, wrong MIME, or oversized HTML crosses into the
    // renderer. These assertions fail unless the post-read boundary is strict.
    const read = await policy()
    expect(read, "missing session-bound MCP App resource policy").toBeFunction()
    if (!read) return

    const run = (payload: unknown) => rejectable(read(request(), { readResource: async () => payload }))

    await expect(
      run({ contents: [{ uri: "ui://calendar/dashboard", mimeType: "text/html", text: "wrong profile" }] }),
    ).resolves.toBeUndefined()
    await expect(
      run({ contents: [{ uri: "ui://calendar/dashboard", mimeType: MIME, blob: "PGgxPm5vPC9oMT4=" }] }),
    ).resolves.toBeUndefined()
    await expect(
      run({
        contents: [
          {
            uri: "ui://calendar/dashboard",
            mimeType: MIME,
            text: "x".repeat(1024 * 1024 + 1),
          },
        ],
      }),
    ).resolves.toBeUndefined()
    await expect(
      run({ contents: [{ uri: "ui://calendar/other", mimeType: MIME, text: "wrong URI" }] }),
    ).resolves.toBeUndefined()
    await expect(
      run({ contents: [{ uri: "ui://calendar/dashboard", mimeType: MIME, text: "<main>allowed</main>" }] }),
    ).resolves.toEqual({ mimeType: MIME, text: "<main>allowed</main>" })
  })

  test("issue-1345-c5: existing text output remains unchanged", () => {
    // Regression caught: adding resource provenance replaces the legacy text
    // output or the schema strips the persisted binding needed for later reads.
    const decoded = Schema.decodeUnknownSync(MessageV2.ToolStateCompleted)({
      status: "completed",
      input: {},
      output: "Readable fallback text",
      title: "",
      metadata: {},
      mcpAppResource: origin(),
      time: { start: 1, end: 2 },
    }) as Record<string, unknown>

    expect(decoded.output).toBe("Readable fallback text")
    expect(decoded.mcpAppResource).toEqual(origin())
  })
})
