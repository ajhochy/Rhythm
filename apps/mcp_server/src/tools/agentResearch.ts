/**
 * MCP tools for Deep Research pipeline (Feature D).
 *
 * rhythm_start_research       — Queue a multi-step research job
 * rhythm_get_research_job     — Get the current status and result of a research job
 * rhythm_update_research_job  — Update a research job's status (called BY the agent during the pipeline)
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerAgentResearchTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_start_research',
    `Start a multi-step deep research job. The agent will:
1. Plan 3-5 authoritative sources for the query
2. Fetch and read each source
3. Synthesize a comprehensive markdown report with citations

The job runs asynchronously. Use rhythm_get_research_job to poll status.
Status flow: pending → gathering → reading → synthesizing → done (or error)`,
    { query: z.string().describe('The research question or topic to investigate.') },
    async ({ query }: { query: string }) => {
      try {
        const job = await apiPost(apiUrl, apiToken, '/agent-research', { query });
        return toolResult(JSON.stringify(job, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_get_research_job',
    'Get the current status and result of a research job. When status is "done", the report field contains the full markdown report.',
    { id: z.string().describe('The research job UUID.') },
    async ({ id }: { id: string }) => {
      try {
        const job = await apiGet(apiUrl, apiToken, `/agent-research/${id}`);
        return toolResult(JSON.stringify(job, null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(server, 'rhythm_update_research_job',
    `Update a research job's status as you progress through the pipeline. Call this at each stage:

  After planning sources: { status: "gathering", sources: ["url1", "url2", ...] }
  After fetching/reading: { status: "reading" }
  After synthesis:        { status: "done", report: "<markdown report>" }
  On any error:           { status: "error", error: "<error message>" }`,
    {
      id: z.string().describe('The research job UUID.'),
      status: z.enum(['gathering', 'reading', 'synthesizing', 'done', 'error']),
      sources: z.array(z.string()).optional().describe('Source URLs discovered during planning.'),
      report: z.string().optional().describe('Final markdown report (required when status=done).'),
      error: z.string().optional().describe('Error message (required when status=error).'),
    },
    async (args: { id: string; status: string; sources?: string[]; report?: string; error?: string }) => {
      try {
        const { id, ...body } = args;
        const job = await apiPatch(apiUrl, apiToken, `/agent-research/${id}/status`, body);
        return toolResult(JSON.stringify(job, null, 2));
      } catch (err) { return toolError(err); }
    },
  );
}
