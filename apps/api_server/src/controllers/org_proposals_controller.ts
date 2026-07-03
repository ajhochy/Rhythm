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
 */

import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app_error';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
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

      if (proposal.status !== 'proposed') {
        throw AppError.conflict(
          `Proposal ${id} is '${proposal.status}', not 'proposed' — cannot approve`,
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
      });

      if (!applyResult.measurable) {
        res.json(applied);
        return;
      }

      const measuring = await repo().updateStatusAsync(id, 'measuring');
      res.json(measuring);
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
