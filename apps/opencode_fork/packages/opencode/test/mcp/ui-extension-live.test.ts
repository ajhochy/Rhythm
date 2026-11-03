import { expect } from "bun:test"
import { Effect } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"
import { testEffect } from "../lib/effect"

// Live check, no mocks: RHYTHM_LIVE_MCP_CMD='["/path/python","server.py"]' bun test test/mcp/ui-extension-live.test.ts
// Run this file alone — other test/mcp files mock the SDK module-wide.
const command = process.env.RHYTHM_LIVE_MCP_CMD ? (JSON.parse(process.env.RHYTHM_LIVE_MCP_CMD) as string[]) : undefined
const { MCP } = await import("../../src/mcp/index")
const it = testEffect(MCP.defaultLayer)

if (command)
  it.instance(
    "real server advertising the UI extension connects and lists tools",
    () =>
      MCP.Service.use((mcp: MCPNS.Interface) =>
        Effect.gen(function* () {
          const tools = yield* mcp.tools({ servers: ["live"], tools: [] })
          const status = yield* mcp.status()
          expect(status.live?.status).toBe("connected")
          expect(Object.keys(tools).length).toBeGreaterThan(0)
        }),
      ),
    { config: { mcp: { live: { type: "local", command: command!, timeout: 60_000 } } } },
  )
