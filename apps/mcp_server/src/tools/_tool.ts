/**
 * Thin wrapper around McpServer.tool() that avoids the expensive ShapeOutput<T>
 * type inference introduced in @modelcontextprotocol/sdk ≥ 1.28 (Zod v3/v4
 * dual-compat layer). Without this, tsc OOMs on builds with many Zod schemas.
 * Runtime correctness is unchanged — the SDK still validates args against `shape`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { runWithTrustedSecurityCall } from '../security/security_context.js';

type ToolShape = Record<string, z.ZodTypeAny>;

export interface ToolRequestExtra {
  _meta?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (
  args: any,
  extra: ToolRequestExtra,
) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }>;

type AppHandler = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  extra: ToolRequestExtra,
) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: true;
}>;

interface AppToolMetadata {
  ui: {
    resourceUri: string;
    visibility: Array<'model' | 'app'>;
  };
}

export function registerTool(
  server: McpServer,
  name: string,
  description: string,
  shape: ToolShape,
  handler: AnyHandler,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool(
    name,
    description,
    shape,
    (args: Record<string, unknown>, extra: ToolRequestExtra) =>
      runWithTrustedSecurityCall(extra, args, () => handler(args, extra)),
  );
}

/** Register an MCP App tool while preserving the signed trusted-call scope. */
export function registerAppTool(
  server: McpServer,
  name: string,
  description: string,
  shape: ToolShape,
  metadata: AppToolMetadata,
  handler: AppHandler,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool(
    name,
    { description, inputSchema: shape, _meta: metadata },
    (args: Record<string, unknown>, extra: ToolRequestExtra) =>
      runWithTrustedSecurityCall(extra, args, () => handler(args, extra)),
  );
}
