/**
 * learning_session_eligibility.ts — W3 (self-improvement-engine-foundation plan).
 *
 * Shared, pure eligibility predicate for skill harvesting (skill_extractor.ts).
 * Without this gate, the harvest loop can recursively feed on its OWN
 * background work: a skill-extract distill session, an org-optimizer
 * diagnostic run, or a scheduled task run all produce agent_session_messages
 * that look exactly like a user turn to the round-count/LLM-distill machinery.
 * The live audit backing this plan found 11 harvested drafts sourced from
 * system sessions (8 scheduled, 3 self-improvement).
 *
 * `evaluateLearningSessionEligibility` is the pure matrix: given a session (or
 * null), decide eligibility and return a MACHINE-READABLE reason so callers
 * and tests can assert on cause, not just a boolean. `checkLearningSessionEligibility`
 * is the fail-closed convenience wrapper real callers use: it looks the
 * session up by id and treats "not found" OR "repo threw" identically as
 * ineligible — a lookup failure must never be silently treated as eligible.
 */

import { logger } from '../utils/logger';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentSession } from '../models/agent_session';

export type LearningEligibilityReason =
  | 'eligible'
  | 'session-missing'
  | 'system-session'
  | 'category-self-improvement'
  | 'category-scheduled'
  | 'curator-role';

export interface LearningEligibility {
  eligible: boolean;
  reason: LearningEligibilityReason;
}

/**
 * mcpRole values this codebase's OWN curator/measurement/optimizer background
 * loops stamp on the sessions they create (skill_extractor.ts, skill_refiner.ts,
 * generators/workflow_signal_generator.ts). A session running under one of
 * these roles is the learner examining its own or another curator's output,
 * not user work — never a harvest source, independent of (and in addition to)
 * the category/isSystem checks above it.
 */
export const CURATOR_MCP_ROLES: ReadonlySet<string> = new Set([
  'skill-extract',
  'skill-refine-judge',
  'skill-measure-score',
  'skill-refine-rewrite',
  'org-optimizer-diagnose',
]);

/** Minimal session shape the pure matrix needs — callers may pass a full AgentSession. */
export type LearningEligibilitySessionInput = Pick<AgentSession, 'isSystem' | 'category' | 'mcpRole'>;

/**
 * Pure eligibility matrix. `null` (session not found) fails closed.
 */
export function evaluateLearningSessionEligibility(
  session: LearningEligibilitySessionInput | null,
): LearningEligibility {
  if (!session) return { eligible: false, reason: 'session-missing' };
  if (session.isSystem) return { eligible: false, reason: 'system-session' };
  if (session.category === 'self_improvement') return { eligible: false, reason: 'category-self-improvement' };
  if (session.category === 'scheduled') return { eligible: false, reason: 'category-scheduled' };
  if (session.mcpRole && CURATOR_MCP_ROLES.has(session.mcpRole)) {
    return { eligible: false, reason: 'curator-role' };
  }
  return { eligible: true, reason: 'eligible' };
}

export interface CheckLearningSessionEligibilityDeps {
  /** Injectable for tests; defaults to a fresh AgentSessionsRepository. */
  sessionsRepo?: Pick<AgentSessionsRepository, 'findById'>;
}

/**
 * Fail-closed lookup + evaluate. A missing session and a repo read failure
 * are BOTH treated as ineligible ('session-missing') — never as eligible.
 */
export function checkLearningSessionEligibility(
  sessionId: string,
  deps: CheckLearningSessionEligibilityDeps = {},
): LearningEligibility {
  const repo = deps.sessionsRepo ?? new AgentSessionsRepository();
  let session: AgentSession | null;
  try {
    session = repo.findById(sessionId);
  } catch (err) {
    logger.warn(`[learning-session-eligibility] session lookup failed for ${sessionId} (fail-closed): ${String(err)}`);
    session = null;
  }
  return evaluateLearningSessionEligibility(session);
}
