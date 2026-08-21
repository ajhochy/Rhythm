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
import { validateEvidenceBundle } from '../services/proposal_evidence_validator';
import { buildProposalEvidenceAsync } from '../services/proposal_evidence_builder';
import { attachExperimentSummariesAsync } from '../services/proposal_experiment_summary_service';
import { attachToolSafetyReviewProjectionsAsync } from '../services/tool_safety_review_projection';
import {
  hasSecurityNote,
  requiresSecurityNote,
  validateProposalChange,
} from '../services/org_proposal_apply_service';
import { finalizePostApplyLifecycleAsync } from '../services/post_apply_lifecycle';
import { CONDITIONAL_TOOL_INSTALL_CONFIRMATION } from '../services/tool_install_safety_policy';
import {
  createAndVetToolInstallProposalAsync,
  denyToolInstallProposalAsync,
} from '../services/tool_install_proposal_lifecycle';

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
  /** D1.4 — the only authenticated production creation path for tool installs. */
  async createToolInstall(req: Request, res: Response, next: NextFunction) {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.title !== 'string' || body.title.length === 0 ||
          !body.change || typeof body.change !== 'object' || Array.isArray(body.change)) {
        throw AppError.badRequest('tool-install requires a title and a closed change object');
      }
      let proposal;
      try {
        proposal = await createAndVetToolInstallProposalAsync({
          title: body.title,
          change: body.change as Record<string, unknown>,
          rationale: typeof body.rationale === 'string' ? body.rationale : null,
          signalRef: typeof body.signalRef === 'string' ? body.signalRef : null,
          targetRef: typeof body.targetRef === 'string' ? body.targetRef : null,
          dedupKey: typeof body.dedupKey === 'string' ? body.dedupKey : null,
          ownerUserId: req.auth?.user.id ?? null,
        });
      } catch {
        // Never echo caller-controlled payload or sandbox output back to the
        // client; details are fixed-code report reasons where durable.
        throw AppError.badRequest('tool-install proposal validation failed');
      }
      res.status(201).json(proposal);
    } catch (err) {
      next(err);
    }
  }

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
      // C6-3 — additive per-proposal experiment/deployment summary (collecting
      // progress, eligible/missing counts, treatment integrity, guardrail
      // status, terminal reason, tested spec hashes, stale-before-apply
      // conflict). Every existing field on `proposals` is untouched.
      const withSummaries = await attachExperimentSummariesAsync(proposals);
      if (status === 'proposed') {
        withSummaries.sort((a, b) => {
          const aConfidence = a.experimentSummary.calibratedConfidence;
          const bConfidence = b.experimentSummary.calibratedConfidence;
          if (aConfidence !== null && bConfidence !== null) return bConfidence - aConfidence;
          if (aConfidence !== null) return -1;
          if (bConfidence !== null) return 1;
          return 0;
        });
      }
      // D1.5: the tool report is a closed projection, not report JSON. This
      // performs one batch report lookup for the page and removes tool apply
      // JSON before the response reaches any desktop client.
      res.json(await attachToolSafetyReviewProjectionsAsync(withSummaries));
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

      if (proposal.kind !== 'tool-install') {
        if (proposal.status !== 'proposed' && proposal.status !== 'failed') {
          throw AppError.conflict(
            `Proposal ${id} is '${proposal.status}', not 'proposed' (or 'failed', retryable) — cannot approve`,
          );
        }
        if (requiresSecurityNote(proposal) && !hasSecurityNote(proposal)) {
          throw AppError.badRequest(`Proposal ${id} (kind '${proposal.kind}') requires a provenance/security note (provenance_json) before it can be approved`);
        }
        const validation = await validateProposalChange(proposal);
        if (!validation.valid) throw AppError.badRequest(validation.reason ?? `Proposal ${id} failed re-validation at approval time`);
      }

      const decidedByUserId = req.auth?.user.id ?? LOCAL_OPERATOR_ACTOR_ID;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const explicitConditionalConfirmation =
        !!req.auth?.user && body.toolSafetyConfirmation === CONDITIONAL_TOOL_INSTALL_CONFIRMATION;
      let outcome;
      try {
        const { applyApprovedProposalAsync } = await import('../services/org_proposal_apply_service');
        outcome = await applyApprovedProposalAsync({
          proposal,
          decidedByUserId,
          explicitHumanConfirmation: explicitConditionalConfirmation,
          finalizePostApply: finalizePostApplyLifecycleAsync,
          measure: measureProposal,
        });
      } catch (error) {
        if (proposal.kind === 'tool-install') throw AppError.conflict(`Tool-install proposal ${id} cannot be approved at this time`);
        throw error;
      }
      if (outcome.kind === 'conflict') throw AppError.conflict(`Proposal ${id}: ${outcome.reason}`);
      if (outcome.kind === 'reconciliation-required') {
        throw AppError.reconciliationRequired(
          `Proposal ${id}: ${outcome.reason}; ` +
          (outcome.durable ? "the proposal is recorded as 'reconciliation-required'" : 'the reconciliation record itself could NOT be persisted') +
          ' — the proposal, target scope, and projected profile must be inspected before retrying',
        );
      }
      res.json(outcome.proposal);
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

      if (proposal.kind === 'tool-install') {
        let rejected;
        try {
          rejected = await denyToolInstallProposalAsync(id, req.auth?.user.id ?? LOCAL_OPERATOR_ACTOR_ID);
        } catch {
          throw AppError.conflict(`Tool-install proposal ${id} cannot be rejected at this time`);
        }
        res.json(rejected);
        return;
      }

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
