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

import { applyApprovedScopeProposal } from '../services/org_proposal_scope_lifecycle';
import { AppError } from '../errors/app_error';
import { logger } from '../utils/logger';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { revertProposal } from '../services/org_proposal_apply';
import { measureProposal } from '../services/org_proposal_measure';
import { validateEvidenceBundle } from '../services/proposal_evidence_validator';
import { buildProposalEvidenceAsync } from '../services/proposal_evidence_builder';
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

/** Stable audit actor for an operator using the authenticated local-only bypass. */
export const LOCAL_OPERATOR_ACTOR_ID = 0;

export class OrgProposalsController {
  /**
   * W6 wiring — POST /:id/experiment. The production DECLARER.
   *
   * An operator supplies the evidence bundle, the two specs, the stopping rule
   * and the exposure cap; this validates the bundle before anything is stored,
   * so an invalid bundle is a 400 here rather than an `inconclusive` discovered
   * a thousand runs later.
   *
   * Deliberately a human path, and deliberately not policy-gated — same
   * authority as approve/revert.
   *
   * C5 — an operator MAY still hand-supply `evidenceBundle` (unchanged
   * behavior: validated exactly as before). When it is omitted, this route
   * calls the deterministic evidence builder (proposal_evidence_builder.ts)
   * to construct one from real durable facts, then validates THAT bundle
   * through the exact same `validateEvidenceBundle` — never a separate,
   * looser path for builder-produced evidence. If no bundle is supplied and
   * none can be built (no qualifying facts, missing target state, an
   * unsupported kind, etc.), this is a 400, not a fabricated bundle.
   */
  async declareExperiment(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const proposal = await repo().findByIdAsync(id);
      if (!proposal) throw AppError.notFound('AgentOrgProposal');

      const body = (req.body ?? {}) as Record<string, unknown>;
      let evidenceBundleInput = body.evidenceBundle;
      if (evidenceBundleInput === undefined || evidenceBundleInput === null) {
        const built = await buildProposalEvidenceAsync(proposal);
        if (!built.ok) {
          throw AppError.badRequest(
            `Proposal ${id}: no evidence bundle was supplied and none could be built: ${built.reason}`,
          );
        }
        evidenceBundleInput = built.bundle;
      }
      const validation = validateEvidenceBundle(evidenceBundleInput);
      if (!validation.valid) {
        throw AppError.badRequest(
          `Proposal ${id}: the evidence bundle is not valid: ${validation.reasons.join('; ')}`,
        );
      }

      const { AgentOrgExperimentsRepository } = await import(
        '../repositories/agent_org_experiments_repository'
      );
      let experiment;
      try {
        experiment = await new AgentOrgExperimentsRepository().declareAsync({
          proposalId: id,
          adapter: validation.bundle.experimentAdapter,
          evidenceBundleJson: JSON.stringify(validation.bundle),
          baselineSpecJson: JSON.stringify(body.baselineSpec ?? null),
          candidateSpecJson: JSON.stringify(body.candidateSpec ?? null),
          // The assignment key is what makes the split reproducible, so it is
          // recorded input, never a fresh random value invented per call.
          assignmentKey: String(body.assignmentKey ?? ''),
          stoppingRule: body.stoppingRule as never,
          maxExposure: Number(body.maxExposure),
        });
      } catch (err) {
        // Every throw out of declareAsync is a rejected declaration (a missing
        // field, an unusable stopping rule, a duplicate undecided experiment),
        // not a server fault.
        throw AppError.badRequest(`Proposal ${id}: ${String((err as Error).message ?? err)}`);
      }

      logger.info(
        `[OrgProposalsController] experiment '${experiment.id}' declared for proposal ${id} ` +
        `(adapter=${experiment.adapter}, maxExposure=${experiment.maxExposure})`,
      );
      res.status(201).json(experiment);
    } catch (err) {
      next(err);
    }
  }

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
      const proposalsRepo = repo();
      const proposal = await proposalsRepo.findByIdAsync(id);
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

      const decidedByUserId = req.auth?.user.id ?? LOCAL_OPERATOR_ACTOR_ID;

      const applyResult = await applyProposal(proposal);
      const exactChangeJson = applyResult.changeJson ?? proposal.changeJson;

      // W1 package C — a scope proposal never reaches `applied` through the
      // generic claim. It is claimed `approved` while its target is still
      // untouched, then the target and the proposal move in ONE atomic
      // revision-fenced transaction, then the committed revision is projected.
      if (applyResult.scopePair) {
        if (!exactChangeJson || !applyResult.beforeSnapshotJson) {
          throw AppError.conflict(
            `Proposal ${id} (kind '${proposal.kind}') lacks the exact change/snapshot binding its scope lifecycle requires`,
          );
        }
        const outcome = await applyApprovedScopeProposal({
          proposal,
          decidedByUserId,
          changeJson: exactChangeJson,
          beforeSnapshotJson: applyResult.beforeSnapshotJson,
          pair: applyResult.scopePair,
        });
        if (outcome.kind === 'conflict') throw AppError.conflict(`Proposal ${id}: ${outcome.reason}`);
        if (outcome.kind === 'reconciliation-required') {
          throw AppError.reconciliationRequired(
            `Proposal ${id}: ${outcome.reason}; ` +
            (outcome.durable
              ? "the proposal is recorded as 'reconciliation-required'"
              : 'the reconciliation record itself could NOT be persisted') +
            ' — the proposal, target scope, and projected profile must be inspected before retrying',
          );
        }
        void measureProposal(outcome.proposal).catch((err) =>
          logger.warn(`[org-proposals] fire-and-forget measure failed for ${id} (non-fatal): ${String(err)}`),
        );
        res.json(outcome.proposal);
        return;
      }

      const applied = await proposalsRepo.claimAppliedWithSnapshotAsync(
        id,
        decidedByUserId,
        applyResult.beforeSnapshotJson ?? null,
        exactChangeJson,
      );
      if (!applied) {
        throw AppError.conflict(`Proposal ${id} was already claimed by another approval`);
      }

      if (!applyResult.measurable) {
        res.json(applied);
        return;
      }

      const measuring = await proposalsRepo.updateStatusAsync(id, 'measuring');

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
      if (outcome === 'unsafe-legacy-scope') {
        throw AppError.conflict(
          `Proposal ${id} uses an unsafe legacy scope snapshot; no changes were made and operator reconciliation is required`,
        );
      }
      if (outcome === 'conflict') {
        throw AppError.conflict(
          `Proposal ${id} no longer matches its exact post-apply scope; no changes were made and operator reconciliation is required`,
        );
      }
      if (outcome === 'reconciliation-required') {
        throw AppError.reconciliationRequired(
          `Proposal ${id} encountered an indeterminate revert result; the durable database transition may have committed, so the proposal, target scope, and projected profile must be inspected before retrying`,
        );
      }
      if (outcome !== 'reverted') {
        throw AppError.conflict(
          `Proposal ${id} could not be reverted safely; no changes were made and operator reconciliation is required`,
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

      const decidedByUserId = req.auth?.user.id;

      const rejected = await repo().updateStatusAsync(id, 'rejected', { decidedByUserId });
      res.json(rejected);
    } catch (err) {
      next(err);
    }
  }
}
