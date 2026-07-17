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
 *
 * #1112/#1114: a capability gap ALSO triggers its own debounced discovery
 * pass directly (gap_discovery_scheduler.ts, server-side, no agent turn) —
 * this tool's manual/scheduled full pass is additive to that, not the only
 * way discovery runs. External discovery itself now judges BOTH a skill fix
 * (skills.sh) and an MCP-server fix (mcp-registry, when
 * RHYTHM_MCP_REGISTRY_SEARCH_URL is configured) per gap, through the same
 * "strictly beats the would-be draft" judge and the same #873 injection
 * pre-vet — an MCP win still surfaces as an `external-adoption` proposal,
 * always human-gated, and installs scoped to the requesting agent only.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiPost, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

/**
 * #1115 — a full pass (with external discovery) can run 200-600s, but
 * org_optimizer_run_controller holds the POST open for the whole
 * synchronous run and undici's default fetch dispatcher aborts with a
 * generic "TypeError: fetch failed" if response HEADERS don't arrive within
 * its hard-coded 300s default. Mirrors the proven #1039/#1040 undici
 * override, scoped to just this call (see api_client.ts ApiPostOptions).
 */
export const ORG_OPTIMIZER_RUN_TIMEOUT_MS = 900_000;

export function registerOrgOptimizerTools(server: McpServer, agentUrl: string, apiToken: string) {
  registerTool(server, 'rhythm_run_org_optimizer',
    `Run one full pass of the org self-optimizer loop, server-side: build a fresh org audit snapshot, run the internal generators (scope hygiene, recipe, webhook wiring; delegation/new-agent run with no signals this pass; external discovery also runs, grounded on open capability gaps, IN ADDITION to its own separate less-frequent schedule AND the gap-triggered debounced pass every new gap already schedules on its own), persist proposals deduped against previously-seen gaps, and auto-apply LOW-risk proposals only (HIGH-risk kinds — create-agent, grant/expand-delegation, broaden-scope, webhook-wiring, external-adoption — are NEVER auto-applied; they are left in the review queue). External discovery judges a skill fix and an MCP-server fix per gap on equal footing; an MCP win still installs scoped to only the requesting agent, never globally.

Per-run caps (proposals/run, LLM calls/run) and the engine cold-start throttle are enforced server-side — a call during the cold-start window is a documented no-op (skipped: true), not an error.

Returns a run summary: proposalsCreated, capped, byKind, byRisk (low/high), and byOutcome (autoApplied/kept/reverted/queued/skipped), plus the auditRunId every proposal from this run shares.

Call this once per scheduled audit run — it is idempotent for unchanged gaps (re-running produces no duplicate proposals).`,
    {
      maxProposalsPerRun: z.number().optional().describe('Override the default per-run proposal cap (default 20).'),
      maxLlmCallsPerRun: z.number().optional().describe('Override the default per-run LLM-call cap (default 40).'),
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await apiPost(agentUrl, apiToken, '/agent-org-optimizer/run', args, {
          timeoutMs: ORG_OPTIMIZER_RUN_TIMEOUT_MS,
        });
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) { return toolError(err); }
    },
  );
}
