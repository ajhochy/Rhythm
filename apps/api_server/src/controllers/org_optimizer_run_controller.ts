/**
 * Org Optimizer Run Controller (#850 / org-optimizer-16) — the HTTP seam the
 * `rhythm_run_org_optimizer` MCP tool calls to trigger one full server-side
 * pass of the org self-optimizer loop.
 *
 * Route (mounted at /agent-org-optimizer):
 *   POST /run — build the audit snapshot, run the generators, persist
 *               deduped proposals, auto-apply low-risk ones, return a run
 *               summary. See org_optimizer_run_service.ts for the full
 *               step sequence; this controller is a thin pass-through
 *               (never throws — runOrgOptimizer itself never throws, but the
 *               try/catch here is defense-in-depth for a truly unexpected
 *               error, e.g. a malformed request body reaching JSON.parse
 *               inside an option field).
 */

import type { NextFunction, Request, Response } from 'express';
import { runOrgOptimizer, type RunOrgOptimizerOptions } from '../services/org_optimizer_run_service';
import { runGapDrivenDiscoveryPass } from '../services/gap_discovery_scheduler';

function parseOptions(body: unknown): RunOrgOptimizerOptions {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  const options: RunOrgOptimizerOptions = {};
  if (typeof b.maxProposalsPerRun === 'number' && Number.isFinite(b.maxProposalsPerRun)) {
    options.maxProposalsPerRun = b.maxProposalsPerRun;
  }
  if (typeof b.maxLlmCallsPerRun === 'number' && Number.isFinite(b.maxLlmCallsPerRun)) {
    options.maxLlmCallsPerRun = b.maxLlmCallsPerRun;
  }
  return options;
}

export class OrgOptimizerRunController {
  async run(req: Request, res: Response, next: NextFunction) {
    try {
      // #1115 — a full pass can run 200-600s. Disable this socket's
      // inactivity timeout so the server side can't tear the connection
      // down mid-run, matching the raised client-side timeout in
      // mcp_server/api_client.ts (defense-in-depth: Node's http.Server has
      // no timeout by default, but don't depend on that implicit default).
      req.socket?.setTimeout(0);
      const options = parseOptions(req.body);
      const result = await runOrgOptimizer(options);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /** Narrow actuator for the external-discovery role: the bounded, gap-driven
   * pass only. Proposal risk, deduplication, injection checks, and human
   * approval remain enforced by the existing generator/service path. */
  async runExternalDiscovery(req: Request, res: Response, next: NextFunction) {
    try {
      req.socket?.setTimeout(0);
      res.json(await runGapDrivenDiscoveryPass());
    } catch (err) {
      next(err);
    }
  }
}
