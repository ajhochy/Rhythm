/**
 * MCP tool for the Org Self-Optimizer's live run-loop trigger (#850,
 * org-optimizer-16).
 *
 * rhythm_run_org_optimizer — runs the WHOLE optimizer pass server-side in one
 * call: build the audit snapshot, run the generators, persist deduped
 * proposals, auto-apply low-risk ones (high-risk kinds are NEVER auto-applied
 * — see org_risk_classifier.ts / org_optimizer_run_service.ts), and return a
 * structured run summary.
 *
 * Routed at RHYTHM_AGENT_URL (the LOCAL agent server, :4001) — this is an
 * agent-execution surface backed by local SQLite (agent_org_proposals),
 * exactly like rhythm_list_scheduled_tasks / rhythm_list_sessions /
 * rhythm_remember_memory, never the production serverConfig.url (dual-
 * endpoint rule, see CLAUDE.md).
 *
 * Access to this tool is restricted to the org-optimizer role's own scope
 * (.mcp-roles/org-optimizer.mcp.json) — the MCP dispatch guard (#736) denies
 * it for any other session, since it is not in another role's allowlist.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiPost, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerOrgOptimizerTools(server: McpServer, agentUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_run_org_optimizer',
    `Run one full pass of the org self-optimizer loop, server-side: build a fresh org audit snapshot, run the internal generators (scope hygiene, recipe, webhook wiring; delegation/new-agent run with no signals this pass, external discovery is on its own separate schedule), persist proposals deduped against previously-seen gaps, and auto-apply LOW-risk proposals only (HIGH-risk kinds — create-agent, grant/expand-delegation, broaden-scope, webhook-wiring, external-adoption — are NEVER auto-applied; they are left in the review queue).

Per-run caps (proposals/run, LLM calls/run) and the engine cold-start throttle are enforced server-side — a call during the cold-start window is a documented no-op (skipped: true), not an error.

Returns a run summary: proposalsCreated, capped, byKind, byRisk (low/high), and byOutcome (autoApplied/kept/reverted/queued/skipped), plus the auditRunId every proposal from this run shares.

Call this once per scheduled audit run — it is idempotent for unchanged gaps (re-running produces no duplicate proposals).`,
    {
      maxProposalsPerRun: z.number().optional().describe('Override the default per-run proposal cap (default 20).'),
      maxLlmCallsPerRun: z.number().optional().describe('Override the default per-run LLM-call cap (default 40).'),
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await apiPost(agentUrl, apiToken, '/agent-org-optimizer/run', args);
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) { return toolError(err); }
    },
  );
}
