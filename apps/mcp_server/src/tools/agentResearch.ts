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
  const projectFields = {
    name: z.string().min(1),
    question: z.string().min(1),
    goals: z.array(z.string()).default([]),
    domain: z.string().nullable().optional(),
    profileId: z.string().nullable().optional(),
    passConfig: z.array(z.record(z.string(), z.unknown())).default([]),
    modelPolicy: z.record(z.string(), z.unknown()).default({}),
    criticConfig: z.record(z.string(), z.unknown()).default({}),
    synthesisConfig: z.record(z.string(), z.unknown()).default({}),
    scheduleRef: z.string().nullable().optional(),
    budget: z.record(z.string(), z.unknown()).default({}),
  };

  registerTool(
    server,
    "rhythm_list_research_projects",
    "List the current user's named research projects.",
    { include_archived: z.boolean().optional() },
    async ({ include_archived }, extra) => {
      try {
        const query = include_archived ? "?includeArchived=true" : "";
        const value = await apiGet(apiUrl, apiToken, `/agent-research/projects${query}`);
        const externalResult = await scanContextContentAndRecordExternalContentTaint({
          agentUrl, context: trustedSecurityContext(extra), source: "research.project.list",
          label: "research project list", rawContent: JSON.stringify(value, null, 2),
        });
        return externalResult.blocked
          ? { content: [{ type: "text" as const, text: externalResult.text }], isError: true as const }
          : toolResult(externalResult.text);
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(
    server,
    "rhythm_get_research_project",
    "Get one owned research project and its current configuration.",
    { project_id: z.string().uuid() },
    async ({ project_id }, extra) => {
      try {
        const value = await apiGet(apiUrl, apiToken, `/agent-research/projects/${project_id}`);
        const externalResult = await scanContextContentAndRecordExternalContentTaint({
          agentUrl, context: trustedSecurityContext(extra), source: "research.project.get",
          label: "research project", rawContent: JSON.stringify(value, null, 2),
        });
        return externalResult.blocked
          ? { content: [{ type: "text" as const, text: externalResult.text }], isError: true as const }
          : toolResult(externalResult.text);
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(
    server,
    "rhythm_create_research_project",
    "Create an owner-scoped named research project. Research Projects must be enabled.",
    { ...projectFields, approval_id: z.string().optional() },
    async (input, extra) => {
      const { approval_id, ...payload } = input;
      const gate = await authorizeOutboundAction({
        agentUrl, context: trustedSecurityContext(extra), approvalId: approval_id,
        action: "research.project.create", payload,
      });
      if (!gate.allowed) return { content: [{ type: "text" as const, text: gate.refusalMessage as string }], isError: true as const };
      try { return toolResult(JSON.stringify(await apiPost(apiUrl, apiToken, "/agent-research/projects", payload), null, 2)); }
      catch (err) { return toolError(err); }
    },
  );

  registerTool(
    server,
    "rhythm_update_research_project",
    "Update the mutable configuration of an owned research project. Existing run snapshots are unchanged.",
    {
      project_id: z.string().uuid(),
      name: z.string().min(1).optional(),
      question: z.string().min(1).optional(),
      goals: z.array(z.string()).optional(),
      domain: z.string().nullable().optional(),
      profileId: z.string().nullable().optional(),
      passConfig: z.array(z.record(z.string(), z.unknown())).optional(),
      modelPolicy: z.record(z.string(), z.unknown()).optional(),
      criticConfig: z.record(z.string(), z.unknown()).optional(),
      synthesisConfig: z.record(z.string(), z.unknown()).optional(),
      scheduleRef: z.string().nullable().optional(),
      budget: z.record(z.string(), z.unknown()).optional(),
      approval_id: z.string().optional(),
    },
    async (input, extra) => {
      const { project_id, approval_id, ...payload } = input;
      const gate = await authorizeOutboundAction({
        agentUrl, context: trustedSecurityContext(extra), approvalId: approval_id,
        action: "research.project.update", payload: { project_id, ...payload },
      });
      if (!gate.allowed) return { content: [{ type: "text" as const, text: gate.refusalMessage as string }], isError: true as const };
      try { return toolResult(JSON.stringify(await apiPatch(apiUrl, apiToken, `/agent-research/projects/${project_id}`, payload), null, 2)); }
      catch (err) { return toolError(err); }
    },
  );

  registerTool(
    server,
    "rhythm_archive_research_project",
    "Archive an owned research project without deleting its immutable run history.",
    { project_id: z.string().uuid(), approval_id: z.string().optional() },
    async ({ project_id, approval_id }, extra) => {
      const payload = { project_id };
      const gate = await authorizeOutboundAction({
        agentUrl, context: trustedSecurityContext(extra), approvalId: approval_id,
        action: "research.project.archive", payload,
      });
      if (!gate.allowed) return { content: [{ type: "text" as const, text: gate.refusalMessage as string }], isError: true as const };
      try { return toolResult(JSON.stringify(await apiPost(apiUrl, apiToken, `/agent-research/projects/${project_id}/archive`, {}), null, 2)); }
      catch (err) { return toolError(err); }
    },
  );

  registerTool(
    server,
    "rhythm_start_research_project_run",
    "Create an immutable run snapshot for an owned research project.",
    {
      project_id: z.string().uuid(),
      trigger_type: z.enum(["manual", "scheduled", "follow-up"]).default("manual"),
      approval_id: z.string().optional(),
    },
    async ({ project_id, trigger_type, approval_id }, extra) => {
      const payload = { project_id, triggerType: trigger_type };
      const gate = await authorizeOutboundAction({
        agentUrl, context: trustedSecurityContext(extra), approvalId: approval_id,
        action: "research.project.run.start", payload,
      });
      if (!gate.allowed) return { content: [{ type: "text" as const, text: gate.refusalMessage as string }], isError: true as const };
      try { return toolResult(JSON.stringify(await apiPost(apiUrl, apiToken, `/agent-research/projects/${project_id}/runs`, { triggerType: trigger_type }), null, 2)); }
      catch (err) { return toolError(err); }
    },
  );

  registerTool(
    server,
    "rhythm_get_research_project_run",
    "Get factual progress, diagnostics, artifacts, sources, and usage for one owned project run.",
    { project_id: z.string().uuid(), run_id: z.string().uuid() },
    async ({ project_id, run_id }, extra) => {
      try {
        const value = await apiGet(apiUrl, apiToken, `/agent-research/projects/${project_id}/runs/${run_id}`);
        const externalResult = await scanContextContentAndRecordExternalContentTaint({
          agentUrl, context: trustedSecurityContext(extra), source: "research.project.run",
          label: "research project run", rawContent: JSON.stringify(value, null, 2),
        });
        return externalResult.blocked
          ? { content: [{ type: "text" as const, text: externalResult.text }], isError: true as const }
          : toolResult(externalResult.text);
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(
    server,
    "rhythm_discuss_research_report",
    "Create a normal resumable agent session grounded in one owned research run's frozen synthesis, critic, curated sources, and selected full-text artifacts.",
    {
      project_id: z.string().uuid(),
      run_id: z.string().uuid(),
      selected_artifact_ids: z.array(z.string().min(1)).max(3).default([]),
      approval_id: z.string().optional(),
    },
    async ({ project_id, run_id, selected_artifact_ids, approval_id }, extra) => {
      const payload = { project_id, run_id, selectedArtifactIds: selected_artifact_ids };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "research.project.discussion.start",
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [{ type: "text" as const, text: gate.refusalMessage as string }],
          isError: true as const,
        };
      }
      try {
        return toolResult(JSON.stringify(await apiPost(
          apiUrl,
          apiToken,
          `/agent-research/projects/${project_id}/runs/${run_id}/discussions`,
          { selectedArtifactIds: selected_artifact_ids },
        ), null, 2));
      } catch (err) { return toolError(err); }
    },
  );

  registerTool(
    server,
    "rhythm_complete_research_pass",
    "Register the versioned canonical artifacts and curated provenance for one persisted research pass. Paths must be vault-relative Markdown files; the API indexes this completed tool call idempotently from the persisted session transcript.",
    {
      version: z.literal(1),
      job_id: z.string().min(1),
      run_id: z.string().min(1),
      pass_id: z.string().min(1),
      artifacts: z.array(z.object({
        role: z.enum(["canonical", "supporting"]),
        kind: z.enum(["structured", "full-text"]),
        vault_path: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      })),
      sources: z.array(z.object({
        url: z.string().url(),
        canonical_url: z.string().url(),
        capture_status: z.enum(["complete", "partial", "failed"]),
        structured_vault_path: z.string().min(1).optional(),
        full_text_vault_path: z.string().min(1).optional(),
        structured_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
        full_text_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
        failure: z.object({ code: z.string().min(1), message: z.string().min(1) }).optional(),
      })),
      approval_id: z.string().optional().describe(
        "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
      ),
    },
    async (input, extra) => {
      const { approval_id, ...completion } = input;
      const payload = completion;
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "research.complete-pass",
        payload,
      });
      if (!gate.allowed) {
        return {
          content: [{ type: "text" as const, text: gate.refusalMessage as string }],
          isError: true as const,
        };
      }
      return toolResult(JSON.stringify({
        accepted: true,
        version: completion.version,
        job_id: completion.job_id,
        run_id: completion.run_id,
        pass_id: completion.pass_id,
      }));
    },
  );

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
