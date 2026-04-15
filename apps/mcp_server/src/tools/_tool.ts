/**
 * Thin wrapper around McpServer.tool() that avoids the expensive ShapeOutput<T>
 * type inference introduced in @modelcontextprotocol/sdk ≥ 1.28 (Zod v3/v4
 * dual-compat layer). Without this, tsc OOMs on builds with many Zod schemas.
 * Runtime correctness is unchanged — the SDK still validates args against `shape`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

type ToolShape = Record<string, z.ZodTypeAny>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }>;

export function registerTool(
  server: McpServer,
  name: string,
  description: string,
  shape: ToolShape,
  handler: AnyHandler,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool(name, description, shape, handler);
}
