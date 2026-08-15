/**
 * learning_session_eligibility.ts — W3 (self-improvement-engine-foundation plan).
 *
 * Shared, pure eligibility predicate for skill harvesting (skill_extractor.ts)
 * AND real-usage counting (skill_usage_tracker.ts). Without this gate, the
 * harvest/usage loop can recursively feed on its OWN background work: a
 * skill-extract distill session, an org-optimizer diagnostic run, or a
 * scheduled task run all produce agent_session_messages that look exactly
 * like a user turn to the round-count/LLM-distill/usage-threshold machinery.
 * The live audit backing this plan found 11 harvested drafts sourced from
 * system sessions (8 scheduled, 3 self-improvement).
 *
 * `evaluateLearningSessionEligibility` is the pure matrix: given a session (or
 * null), decide eligibility and return a MACHINE-READABLE reason so callers
 * and tests can assert on cause, not just a boolean.
 *
 * W3 late-review corrective package — this is an ALLOW-LIST, not a deny-list:
 * a session is eligible ONLY when its runtime metadata matches the one known
 * user-authored chat shape exactly (`isSystem === false`, `category === 'chat'`,
 * `mcpRole` a valid null/string not naming a curator role). ANY other runtime
 * value — missing, wrong-typed, or an unrecognized string — is ineligible.
 * This matters because `LearningEligibilitySessionInput`'s fields are typed
 * `unknown`: callers include raw-SQL joins (skill_usage_tracker.ts) whose rows
 * are never guaranteed to match the shape a well-formed `AgentSession` would.
 * A deny-list here would silently ADMIT any unrecognized/corrupt metadata
 * shape instead of refusing it.
 *
 * `checkLearningSessionEligibility` is the fail-closed convenience wrapper real
 * callers use: it looks the session up by id and treats "not found" OR "repo
 * threw" identically as ineligible — a lookup failure must never be silently
 * treated as eligible. It also short-circuits under Postgres: agent_sessions
 * reads there would otherwise go through `getDb()`, which throws
 * unconditionally under `dbClient === 'postgres'` (SQLite-only handle) — that
 * exception was being relied on as de facto Postgres control flow. The
 * explicit check makes the "unsupported under Postgres" behavior deliberate
 * rather than an artifact of an unrelated throw.
 */

import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentSession } from '../models/agent_session';

export type LearningEligibilityReason =
  | 'eligible'
  | 'session-missing'
  | 'postgres-unsupported'
  | 'system-session'
  | 'invalid-is-system'
  | 'category-self-improvement'
  | 'category-scheduled'
  | 'invalid-category'
  | 'invalid-mcp-role'
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

/**
 * Minimal session shape the pure matrix needs. Fields are intentionally typed
 * `unknown` (not `AgentSession`'s real `boolean`/`SessionCategory`/`string |
 * null` types) and optional: this predicate's job is to validate RUNTIME
 * metadata that may not match those static types at all — a raw-SQL join row,
 * a corrupt column, a caller that dropped a field. A well-formed `AgentSession`
 * is always structurally assignable here; the looser type exists for the
 * malformed-input side of the matrix, not the happy path.
 */
export interface LearningEligibilitySessionInput {
  isSystem?: unknown;
  category?: unknown;
  mcpRole?: unknown;
}

/**
 * Pure eligibility matrix. `null` (session not found) fails closed.
 *
 * Allow-list order: isSystem shape/value, then category shape/value, then
 * mcpRole shape/value, then curator-role membership. Each step both validates
 * the runtime SHAPE (reject unknown types outright) and the specific VALUE
 * (reject known-bad values with their own reason) before moving on — a
 * malformed field anywhere in the chain is ineligible, never coerced into a
 * default.
 */
export function evaluateLearningSessionEligibility(
  session: LearningEligibilitySessionInput | null,
): LearningEligibility {
  if (!session) return { eligible: false, reason: 'session-missing' };

  if (session.isSystem !== false) {
    return { eligible: false, reason: session.isSystem === true ? 'system-session' : 'invalid-is-system' };
  }

  if (session.category !== 'chat') {
    if (session.category === 'self_improvement') return { eligible: false, reason: 'category-self-improvement' };
    if (session.category === 'scheduled') return { eligible: false, reason: 'category-scheduled' };
    return { eligible: false, reason: 'invalid-category' };
  }

  if (session.mcpRole !== null && typeof session.mcpRole !== 'string') {
    return { eligible: false, reason: 'invalid-mcp-role' };
  }
  if (session.mcpRole && CURATOR_MCP_ROLES.has(session.mcpRole)) {
    return { eligible: false, reason: 'curator-role' };
  }

  return { eligible: true, reason: 'eligible' };
}

/**
 * Runtime adapter for a raw `agent_sessions` SQL row's classification columns
 * (used by skill_usage_tracker.ts's message/session join, or any other
 * raw-SQL caller). SQLite stores `is_system` as an INTEGER (0/1); this adapter
 * maps only the two KNOWN-good values to real booleans and passes any other
 * value straight through un-normalized, so a corrupt column fails the strict
 * `isSystem !== false` check in `evaluateLearningSessionEligibility` instead
 * of being silently coerced into a truthy/falsy guess.
 */
export interface RawSessionClassificationColumns {
  is_system: unknown;
  category: unknown;
  mcp_role: unknown;
}

export function toLearningEligibilitySessionInput(
  row: RawSessionClassificationColumns,
): LearningEligibilitySessionInput {
  return {
    isSystem: row.is_system === 1 ? true : row.is_system === 0 ? false : row.is_system,
    category: row.category,
    mcpRole: row.mcp_role,
  };
}

export interface CheckLearningSessionEligibilityDeps {
  /** Injectable for tests; defaults to a fresh AgentSessionsRepository. */
  sessionsRepo?: Pick<AgentSessionsRepository, 'findById'>;
}

/**
 * Fail-closed lookup + evaluate. A missing session and a repo read failure
 * are BOTH treated as ineligible ('session-missing') — never as eligible.
 *
 * Short-circuits unconditionally under Postgres: `agent_sessions` lookups
 * here always go through the SQLite-only `getDb()` handle, which throws
 * ("Database not initialized") whenever `dbClient === 'postgres'`. Relying on
 * that throw to reach the fail-closed catch below would work by accident;
 * this makes the Postgres-unsupported outcome explicit and gives it its own
 * reason code instead of overloading 'session-missing'.
 */
export function checkLearningSessionEligibility(
  sessionId: string,
  deps: CheckLearningSessionEligibilityDeps = {},
): LearningEligibility {
  if (env.dbClient === 'postgres') {
    return { eligible: false, reason: 'postgres-unsupported' };
  }

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
