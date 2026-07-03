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
      const options = parseOptions(req.body);
      const result = await runOrgOptimizer(options);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}
