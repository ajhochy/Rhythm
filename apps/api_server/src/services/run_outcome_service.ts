/**
 * W4 — run outcome service.
 *
 * Everything in this file is deterministic. There is no LLM call, no scoring of
 * prose, and no heuristic that reads run content: the finalizer is a pure
 * function of a terminal status and three countable evidence fields, and the
 * ledger writers copy identifiers only.
 */
import { randomUUID } from 'node:crypto';

import {
  UNKNOWN_REVISION,
  type AgentRunFeedbackEvent,
  type AttributedRevision,
  type FeedbackSource,
  type ObjectiveEvidence,
  type RunAttribution,
  type RunVerdict,
  type TerminalStatus,
  type UserVerdict,
} from '../models/agent_run_outcome';
import { logger } from '../utils/logger';

export type {
  ObjectiveEvidence,
  RunAttribution,
  RunVerdict,
  TerminalStatus,
} from '../models/agent_run_outcome';

/**
 * W4-c6 — map a terminal status plus objective evidence to a verdict.
 *
 * Rules, in order:
 *  1. An unknown terminal status decides nothing.
 *  2. Evidence that contradicts the status decides nothing (a run reported as
 *     `error` with zero recorded errors is a broken observation, not a failure).
 *  3. Absent evidence decides nothing. Crucially this means absence can never
 *     produce `success` — only `inconclusive`.
 *  4. Otherwise the artifact/error/approval evidence selects the verdict.
 */
export function finalizeVerdict(
  status: TerminalStatus,
  evidence: ObjectiveEvidence,
): RunVerdict {
  const { producedArtifact, errorCount, approvalDenied } = evidence;

  if (status === 'unknown') return 'inconclusive';
  // Contradiction: the status claims a failure the evidence does not show.
  if (status === 'error' && errorCount === 0) return 'inconclusive';
  // Absent evidence: without artifact evidence nothing is decidable.
  if (producedArtifact === null) return 'inconclusive';

  if (status === 'error' || status === 'aborted') {
    return producedArtifact ? 'partial' : 'failure';
  }

  // status === 'completed'
  if (errorCount === null) return 'inconclusive';
  if (approvalDenied === true) return 'partial';
  if (producedArtifact) return errorCount > 0 ? 'partial' : 'success';
  return errorCount > 0 ? 'failure' : 'inconclusive';
}

interface AttributionInput {
  tools?: Array<{ name: string; revision?: string | null }>;
  skills?: Array<{ name: string; revision?: string | null }>;
  configRevision?: number | null;
}

/**
 * Names are supposed to identify a tool or skill, but nothing structurally
 * stops a caller — or an oddly-named MCP tool arriving through real telemetry —
 * from putting prompt text or a credential here. The privacy gate (W4-c10) has
 * to hold at the boundary, not only for the paths that exist today, so every
 * attribution string is redacted and length-capped on the way in.
 */
const MAX_ATTRIBUTION_LENGTH = 200;

function sanitizeAttributionText(value: string): string {
  return redactSecrets(value).slice(0, MAX_ATTRIBUTION_LENGTH);
}

function attribute(
  entries: Array<{ name: string; revision?: string | null }> | undefined,
): AttributedRevision[] {
  return (entries ?? []).map((entry) => ({
    name: sanitizeAttributionText(entry.name),
    // W4-c9: a missing revision becomes an explicit marker, never a plausible
    // stand-in borrowed from a sibling entry or from "current".
    revision:
      typeof entry.revision === 'string' && entry.revision.length > 0
        ? sanitizeAttributionText(entry.revision)
        : UNKNOWN_REVISION,
  }));
}

/**
 * W4-c9 — build the attribution blob. Names identify which tool/skill ran; they
 * are not arguments and not output, so nothing here can carry run content.
 */
export function buildAttribution(input: AttributionInput = {}): RunAttribution {
  return {
    v: 1,
    tools: attribute(input.tools),
    skills: attribute(input.skills),
    configRevision:
      typeof input.configRevision === 'number' && Number.isFinite(input.configRevision)
        ? input.configRevision
        : UNKNOWN_REVISION,
  };
}

export function newLedgerId(): string {
  return randomUUID();
}

/**
 * W4-c10 — the ledger stores identifiers, enums and counts. The single free-text
 * column (`agent_run_feedback_events.reason`) carries an operator's own words,
 * so it is the one place a credential could arrive by hand. Redact the shapes
 * that are unambiguously secrets rather than trusting the typist.
 *
 * ponytail: shape-matching, not entropy analysis. It catches the token formats
 * this product actually handles; widen the list if a new provider shows up.
 */
const SECRET_SHAPES: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
  /\bsk-[A-Za-z0-9._-]{12,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
];

const MAX_REASON_LENGTH = 500;

export function redactSecrets(text: string): string {
  let out = text;
  for (const shape of SECRET_SHAPES) out = out.replace(shape, '[redacted]');
  return out;
}

export function sanitizeFeedbackReason(reason: string | null | undefined): string | null {
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return null;
  return redactSecrets(trimmed).slice(0, MAX_REASON_LENGTH);
}

/**
 * `actor` is an audit label, not prose — but it was the one free-text field on
 * the write path that reached the immutable ledger unredacted and uncapped,
 * bounded only by the 1 MB global JSON body limit. Same treatment as `reason`,
 * with a label-sized cap: a secret pasted here would otherwise defeat the
 * privacy gate on the exact path a human types into, permanently, because the
 * ledger blocks UPDATE and DELETE.
 */
const MAX_ACTOR_LENGTH = 120;

export function sanitizeFeedbackActor(actor: string | null | undefined): string | null {
  if (typeof actor !== 'string') return null;
  const trimmed = actor.trim();
  if (trimmed.length === 0) return null;
  return redactSecrets(trimmed).slice(0, MAX_ACTOR_LENGTH);
}

export interface TerminalRunEvent {
  /** The session that just reached a terminal state — may be a delegated child. */
  sessionId: string;
  terminalStatus: TerminalStatus;
  runEpisodeId?: string | null;
  /**
   * Whether the turn produced observable output. A boolean ABOUT the output —
   * the output itself never crosses this boundary.
   */
  producedArtifact?: boolean | null;
  /** Explicit override; otherwise evidence is read from tool telemetry. */
  evidence?: ObjectiveEvidence;
  scheduledOccurrenceId?: string | null;
  experimentVariant?: string | null;
  proposalId?: string | null;
  profileId?: string | null;
  configRevision?: number | null;
  attribution?: {
    tools?: Array<{ name: string; revision?: string | null }>;
    skills?: Array<{ name: string; revision?: string | null }>;
  };
}

/**
 * W4-c8 — the terminal hook.
 *
 * Fire-and-forget with respect to the user turn: callers invoke it with `void`
 * and never await it, and it NEVER rejects, so a broken ledger cannot surface
 * as a failed turn. Mirrors queueSkillExtraction's posture exactly.
 *
 * W4-c12 — the event's session is resolved to its ROOT run first. A delegated
 * child hitting its own terminal event must not mint a second outcome.
 *
 * Note what is NOT passed in: no prompt, no tool arguments, no tool output. The
 * caller hands over a status, three counted evidence fields and identifiers.
 */
export async function recordTerminalOutcome(event: TerminalRunEvent): Promise<void> {
  try {
    // Imported lazily so this module stays importable (and pure-testable) in
    // contexts that never initialise a database.
    const { AgentRunOutcomesRepository } = await import(
      '../repositories/agent_run_outcomes_repository'
    );
    const repo = new AgentRunOutcomesRepository();
    const rootSessionId = await repo.resolveRootSessionIdAsync(event.sessionId);
    const runEpisodeId = event.runEpisodeId ?? rootSessionId;

    try {
      const { markRunEnrollmentTerminalized } = await import(
        './org_proposal_experiment_service'
      );
      await markRunEnrollmentTerminalized(runEpisodeId);
    } catch (err) {
      logger.warn('[RunOutcome] terminalization skipped (non-fatal)');
    }

    // The row is keyed on the ROOT run, so its objective evidence must describe
    // the root run too. Reading the child's telemetry produced an outcome that
    // silently ignored the root's own errors.
    const telemetry = event.evidence
      ? null
      : await repo.findToolEvidenceAsync(rootSessionId);
    const evidence: ObjectiveEvidence = event.evidence ?? {
      producedArtifact: event.producedArtifact ?? null,
      // No telemetry rows at all means "unknown", not "zero errors".
      errorCount: telemetry?.errorCount ?? null,
      approvalDenied: null,
    };
    // W6 cohort wiring. agent_run_outcomes is UPDATE/DELETE-blocked in both
    // engines, so a cohort label absent from THIS insert can never be added
    // later — assignment has to happen before finalization or the run can never
    // be paired. It happens here, on the root session, which is the subject the
    // deterministic assignment key is computed over.
    //
    // An explicit label on the event always wins: a caller that already knows
    // which arm it ran is authoritative over the lookup.
    const enrollment =
      event.proposalId || event.experimentVariant
        ? null
        : await (async () => {
            const { resolveRunEnrollment } = await import('./org_proposal_experiment_service');
            return resolveRunEnrollment(runEpisodeId);
          })();

    await repo.finalizeAsync({
      rootSessionId,
      sessionId: event.sessionId,
      // C2-D (S2) — persist the SAME runEpisodeId already used above to
      // resolve the enrollment, so a later receipt-backed cohort read can
      // join outcomes to their treatment receipt by this id.
      runEpisodeId,
      scheduledOccurrenceId: event.scheduledOccurrenceId ?? null,
      experimentVariant: event.experimentVariant ?? enrollment?.experimentVariant ?? null,
      proposalId: event.proposalId ?? enrollment?.proposalId ?? null,
      // C3 — populated from the pre-run enrollment/receipt (the run's real,
      // bound identity), never a nullable terminal-time guess. An explicit
      // caller-supplied value still wins, matching experimentVariant/proposalId
      // above.
      profileId: event.profileId ?? enrollment?.profileId ?? null,
      configRevision: event.configRevision ?? enrollment?.configRevision ?? null,
      terminalStatus: event.terminalStatus,
      objectiveVerdict: finalizeVerdict(event.terminalStatus, evidence),
      objectiveEvidence: evidence,
      attribution: buildAttribution({
        // Tool names come from telemetry when it is available; their revisions
        // are not recorded anywhere today, so they are marked unknown rather
        // than filled in with the current version (W4-c9).
        tools: event.attribution?.tools ?? telemetry?.tools.map((name) => ({ name })),
        skills: event.attribution?.skills,
        configRevision: event.configRevision ?? enrollment?.configRevision ?? null,
      }),
    });
  } catch (err) {
    logger.warn('[RunOutcome] terminal outcome not recorded (non-fatal)');
  }
}

export interface RecordFeedbackInput {
  /** May be any session in the run's tree; resolved to the root before writing. */
  sessionId: string;
  source: FeedbackSource;
  verdict: UserVerdict;
  /** Defaults to 1 for an explicit human verdict, 0.5 for an inference. */
  confidence?: number;
  actor?: string | null;
  reason?: string | null;
}

/**
 * Append one feedback event. Never overwrites anything — an inferred verdict
 * arriving after an explicit one is simply another row, and the read model
 * keeps the human's verdict authoritative.
 */
export async function recordFeedback(
  input: RecordFeedbackInput,
): Promise<AgentRunFeedbackEvent> {
  const { AgentRunOutcomesRepository } = await import(
    '../repositories/agent_run_outcomes_repository'
  );
  const repo = new AgentRunOutcomesRepository();
  const rootSessionId = await repo.resolveRootSessionIdAsync(input.sessionId);
  return repo.appendFeedbackAsync({
    rootSessionId,
    source: input.source,
    verdict: input.verdict,
    confidence:
      typeof input.confidence === 'number' && Number.isFinite(input.confidence)
        ? input.confidence
        : input.source === 'explicit_user'
          ? 1
          : 0.5,
    actor: sanitizeFeedbackActor(input.actor),
    reason: sanitizeFeedbackReason(input.reason),
  });
}
