/**
 * Org Proposals Controller (#826 / org-optimizer-10) — human-gate review
 * queue. Per the 2026-07-02 policy update this is the EXCEPTION path
 * (new-agent + external-adoption/webhook-wiring today) plus an audit-trail /
 * rollback view of auto-applied proposals — most proposals flow through the
 * auto-apply lane (org-optimizer-05) and never sit in `proposed`.
 *
 * Routes (mounted at /agent-org-proposals):
 *   GET  /?status=proposed   — list proposals by status (default: proposed)
 *   POST /:id/approve        — re-validate + run the kind's apply step
 *   POST /:id/reject         — mark rejected (feeds the dedup seen-set)
 *   POST /:id/revert         — #857: undo an already-`active` (kept) proposal,
 *                              restoring before_snapshot_json and setting
 *                              status='reverted'. This is the human-triggered
 *                              counterpart to the auto-measure revert path
 *                              (org_proposal_measure.ts) — it exists because
 *                              the first live optimizer run needed exactly
 *                              this ("undo a proposal that already passed
 *                              measurement but turns out to be wrong") and had
 *                              no supported way to do it short of a manual DB
 *                              edit (see docs/ai/runs/2026-07-02-mega-buildout-
 *                              fork-eval-memory.md).
 */

import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app_error';
import { logger } from '../utils/logger';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { revertProposal } from '../services/org_proposal_apply';
import { measureProposal } from '../services/org_proposal_measure';
import {
  applyProposal,
  hasSecurityNote,
  requiresSecurityNote,
  validateProposalChange,
} from '../services/org_proposal_apply_service';

/**
 * IMPORTANT: AgentOrgProposalsRepository's constructor calls getDb() eagerly
 * and caches the returned connection on `this.db` (unlike most repositories
 * in this codebase, which call getDb() lazily per query). A module-level
 * singleton instance here would therefore capture whichever DB connection
 * was live at import time — wrong in tests that call setDb() per test case,
 * and unsafe if the process ever re-initializes its DB connection. Construct
 * a fresh repository per request instead so every call sees the current
 * connection.
 */
function repo(): AgentOrgProposalsRepository {
  return new AgentOrgProposalsRepository();
}

export class OrgProposalsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : 'proposed';
      const proposals = await repo().listByStatusAsync(status);
      res.json(proposals);
    } catch (err) {
      next(err);
    }
  }

  async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const proposal = await repo().findByIdAsync(id);
      if (!proposal) throw AppError.notFound('AgentOrgProposal');

      // #1056 — a proposal the applier marked 'failed' (e.g. a publish-skill-
      // to-org attempt that hit an unreachable production API) is retryable:
      // a re-approve re-runs the SAME apply step from here. No other kind
      // ever writes 'failed', so this is a no-op for every other kind's flow.
      if (proposal.status !== 'proposed' && proposal.status !== 'failed') {
        throw AppError.conflict(
          `Proposal ${id} is '${proposal.status}', not 'proposed' (or 'failed', retryable) — cannot approve`,
        );
      }

      // Gate: external-adoption and webhook-wiring require a non-empty
      // provenance/security note BEFORE the apply step ever runs. This is the
      // real gate; the Flutter disabled-button state (#827) is a UX aid only.
      if (requiresSecurityNote(proposal) && !hasSecurityNote(proposal)) {
        throw AppError.badRequest(
          `Proposal ${id} (kind '${proposal.kind}') requires a provenance/security note ` +
            `(provenance_json) before it can be approved`,
        );
      }

      // Re-validate the change at apply time — never trust the state it was
      // in when proposed. Returns 400 (not 500) on an invalid change so the
      // reviewer sees an actionable reason.
      const validation = await validateProposalChange(proposal);
      if (!validation.valid) {
        throw AppError.badRequest(
          validation.reason ?? `Proposal ${id} failed re-validation at approval time`,
        );
      }

      const decidedByUserId =
        typeof req.body?.decidedByUserId === 'number' ? req.body.decidedByUserId : undefined;

      const applyResult = await applyProposal(proposal);

      const applied = await repo().updateStatusAsync(id, 'applied', {
        decidedByUserId,
        beforeSnapshotJson: applyResult.beforeSnapshotJson,
        // An applier may reshape change_json (e.g. workflow-prompt-fix rewrites
        // its prose diagnosis into the BodyRefinementChange the measure step
        // reads). Undefined = leave change_json untouched.
        changeJson: applyResult.changeJson,
      });

      if (!applyResult.measurable) {
        res.json(applied);
        return;
      }

      const measuring = await repo().updateStatusAsync(id, 'measuring');

      // #971-3 — fire-and-forget a measure attempt so a human-approved proposal
      // doesn't wait for the next optimizer run's sweep to get keep/revert'd
      // (closes F3 for the common case). Deliberately NOT awaited — the approve
      // response returns immediately; measureProposal never throws (the .catch
      // is belt-and-suspenders against a rejected promise).
      if (measuring) {
        void measureProposal(measuring).catch((err) =>
          logger.warn(`[org-proposals] fire-and-forget measure failed for ${id} (non-fatal): ${String(err)}`),
        );
      }

      res.json(measuring);
    } catch (err) {
      next(err);
    }
  }

  /**
   * #857 — undo an already-`active` proposal. Only legal from `active`
   * (the repository's state machine still rejects every other source status,
   * including the already-supported `measuring` auto-revert path, which
   * callers should keep going through org_proposal_measure.ts instead of
   * this route). Restores `before_snapshot_json` via the same
   * `revertProposal` the auto-measure path uses, then reports the final row.
   */
  async revert(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const proposal = await repo().findByIdAsync(id);
      if (!proposal) throw AppError.notFound('AgentOrgProposal');

      if (proposal.status !== 'active') {
        throw AppError.conflict(
          `Proposal ${id} is '${proposal.status}', not 'active' — cannot revert`,
        );
      }

      const outcome = await revertProposal(proposal);
      if (outcome !== 'reverted') {
        throw AppError.conflict(
          `Proposal ${id} could not be reverted (missing or unparseable before_snapshot_json)`,
        );
      }

      const reverted = await repo().findByIdAsync(id);
      res.json(reverted);
    } catch (err) {
      next(err);
    }
  }

  async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const proposal = await repo().findByIdAsync(id);
      if (!proposal) throw AppError.notFound('AgentOrgProposal');

      if (proposal.status !== 'proposed') {
        throw AppError.conflict(
          `Proposal ${id} is '${proposal.status}', not 'proposed' — cannot reject`,
        );
      }

      const decidedByUserId =
        typeof req.body?.decidedByUserId === 'number' ? req.body.decidedByUserId : undefined;

      const rejected = await repo().updateStatusAsync(id, 'rejected', { decidedByUserId });
      res.json(rejected);
    } catch (err) {
      next(err);
    }
  }
}
