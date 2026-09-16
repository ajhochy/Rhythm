/** Compatibility MCP tools for retired Org Self-Optimizer execution seams. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerTool } from "./_tool.js";

/** Legacy export retained for source compatibility; retired handlers do not use it. */
export const ORG_OPTIMIZER_RUN_TIMEOUT_MS = 900_000;

const RETIRED_MESSAGE =
  "Org Self-Optimizer execution is retired. Use the weekly Org Reviewer and the human proposal queue.";

function retiredToolResult() {
  return {
    content: [{ type: "text" as const, text: RETIRED_MESSAGE }],
    isError: true as const,
  };
}

export function registerOrgOptimizerTools(
  server: McpServer,
  agentUrl: string,
  apiToken: string,
) {
  // Keep the public registration signature stable for existing wiring.
  void agentUrl;
  void apiToken;
  registerTool(
    server,
    "rhythm_run_org_optimizer",
    `Retired compatibility tool. It performs no audit, proposal generation, scope pruning, recipe generation, or automatic application. Use the weekly Org Reviewer and the human proposal queue.`,
    {
      maxProposalsPerRun: z
        .number()
        .optional()
        .describe("Ignored legacy argument; this tool is retired."),
      maxLlmCallsPerRun: z
        .number()
        .optional()
        .describe("Ignored legacy argument; this tool is retired."),
      approval_id: z
        .string()
        .optional()
        .describe("Ignored legacy argument; this tool is retired."),
    },
    async () => retiredToolResult(),
  );

  registerTool(server, 'rhythm_run_external_discovery',
    `Retired compatibility tool. It performs no external discovery, proposal generation, installation, or application. Use the weekly Org Reviewer and the human proposal queue.`,
    {
      approval_id: z
        .string()
        .optional()
        .describe("Ignored legacy argument; this tool is retired."),
    },
    async () => retiredToolResult(),
  );
}
