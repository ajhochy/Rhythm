/**
 * MCP tools for Deep Research pipeline (Feature D).
 *
 * rhythm_start_research       — Queue a multi-step research job
 * rhythm_get_research_job     — Get the current status and result of a research job
 * rhythm_update_research_job  — Update a research job's status (called BY the agent during the pipeline)
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  apiGet,
  apiPost,
  apiPatch,
  toolResult,
  toolError,
} from "../api_client.js";
import { registerTool } from "./_tool.js";
import {
  authorizeOutboundAction,
  scanContextContentAndRecordExternalContentTaint,
} from "../security/external_content_boundary.js";
import { trustedSecurityContext } from "../security/security_context.js";

export function registerAgentResearchTools(
  server: McpServer,
  apiUrl: string,
  apiToken: string,
  agentUrl = process.env.RHYTHM_AGENT_URL ?? "http://127.0.0.1:4001",
) {
  registerTool(
    server,
    "rhythm_start_research",
    `Start a multi-step deep research job. The agent will:
1. Plan 3-5 authoritative sources for the query
2. Fetch and read each source
3. Synthesize a comprehensive markdown report with citations

The job runs asynchronously. Use rhythm_get_research_job to poll status.
Status flow: pending → gathering → reading → synthesizing → done (or error)`,
    {
      query: z
        .string()
        .describe("The research question or topic to investigate."),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      { query, approval_id }: { query: string; approval_id?: string },
      extra,
    ) => {
      const payload = { query };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "research.start",
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [
            { type: "text" as const, text: gate.refusalMessage as string },
          ],
          isError: true as const,
        };
      }
      try {
        const job = await apiPost(apiUrl, apiToken, "/agent-research", payload);
        return toolResult(JSON.stringify(job, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_get_research_job",
    'Get the current status and result of a research job. When status is "done", the report field contains the full markdown report.',
    { id: z.string().describe("The research job UUID.") },
    async ({ id }: { id: string }, extra) => {
      try {
        const job = await apiGet(apiUrl, apiToken, `/agent-research/${id}`);
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl,
          context: trustedSecurityContext(extra),
          source: "research.job",
          label: "external research job result",
          rawContent: JSON.stringify(job, null, 2),
        });
        return ingress.blocked
          ? {
              content: [{ type: "text" as const, text: ingress.text }],
              isError: true as const,
            }
          : toolResult(ingress.text);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_update_research_job",
    `Update a research job's status as you progress through the pipeline. Call this at each stage:

  After planning sources: { status: "gathering", sources: ["url1", "url2", ...] }
  After fetching/reading: { status: "reading" }
  After synthesis:        { status: "done", report: "<markdown report>" }
  On any error:           { status: "error", error: "<error message>" }`,
    {
      id: z.string().describe("The research job UUID."),
      status: z.enum(["gathering", "reading", "synthesizing", "done", "error"]),
      sources: z
        .array(z.string())
        .optional()
        .describe("Source URLs discovered during planning."),
      report: z
        .string()
        .optional()
        .describe("Final markdown report (required when status=done)."),
      error: z
        .string()
        .optional()
        .describe("Error message (required when status=error)."),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      args: {
        id: string;
        status: string;
        sources?: string[];
        report?: string;
        error?: string;
        approval_id?: string;
      },
      extra,
    ) => {
      const { id, approval_id, ...body } = args;
      const payload = { id, ...body };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "research.update",
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [
            { type: "text" as const, text: gate.refusalMessage as string },
          ],
          isError: true as const,
        };
      }
      try {
        const job = await apiPatch(
          apiUrl,
          apiToken,
          `/agent-research/${id}/status`,
          body,
        );
        return toolResult(JSON.stringify(job, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
