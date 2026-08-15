/**
 * W1 corrective-6 package C — the one profile-projection boundary.
 *
 * Every caller that wants an agent profile rendered to
 * `~/.config/opencode/agents/<id>.md` states an INTENT — a profile id plus the
 * config revision it believes it is projecting — and never hands over a config
 * row. That is the whole point: a caller holding a row it read before an await
 * has, by then, a possibly-stale copy, and writing it would silently overwrite
 * a newer operator edit. The boundary re-reads the latest row itself and
 * projects THAT, so the file can lag the database but can never contradict a
 * newer revision.
 *
 * The read-to-write span below contains no `await`, so on the supported local
 * single-owner deployment nothing can interleave between reading the latest
 * revision and replacing the file.
 *
 * What this boundary does NOT claim (see the package-C architecture review):
 *   - it is not atomic with the database;
 *   - it is not proof the OpenCode engine reloaded the new bytes;
 *   - it does not fence two processes sharing one HOME.
 * Those need an outbox/owner daemon. The safe guarantee here is durable
 * DETECTION: a caller learns `stale`/`blocked`/`failed` and can reconcile.
 */

import { getDb } from '../database/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import {
  agentProfileFileExists,
  deleteAgentProfileFile,
  isProjectableAgentConfigIgnoringEnabled,
  writeAgentProfileFile,
  type AgentProfileWriteResult,
} from './opencode_agent_writer';

export type ProjectionCause =
  | 'scope-apply'
  | 'scope-compensation'
  | 'scope-revert'
  | 'recovery'
  | 'config-create'
  | 'config-update'
  | 'import'
  | 'seed'
  | 'sync';

export type ProjectionOutcome =
  /** The requested revision was the latest, and it is now on disk. */
  | { kind: 'projected'; revision: number; write: AgentProfileWriteResult }
  /** A newer revision existed; THAT one was projected, never the caller's. */
  | { kind: 'stale'; requestedRevision: number; currentRevision: number }
  /** Content scan refused the profile. Nothing was written. */
  | { kind: 'blocked'; revision: number }
  /** The write itself failed. */
  | { kind: 'failed'; revision: number }
  /**
   * The profile is not projectable at all (disabled, security-locked, not an
   * agent). Nothing was written — and any stale file was REMOVED, so the engine
   * cannot keep loading a wider scope than the database now holds.
   */
  | { kind: 'not-applicable'; revision: number }
  /** The profile row no longer exists. */
  | { kind: 'missing' };

export interface ProjectLatestAgentProfileInput {
  profileId: string;
  expectedRevision: number;
  cause: ProjectionCause;
  /** Test/DI seams. Neither may be used to pass a caller-held row. */
  configsRepo?: AgentConfigsRepository;
  writeProfile?: (config: Parameters<typeof writeAgentProfileFile>[0]) => AgentProfileWriteResult;
}

/**
 * The durable half of the boundary's promise. The file write is not atomic
 * with the database, so the ONLY honest guarantee is that a lag is detectable:
 * `file_projected_revision` behind `agent_configs.revision` is exactly what a
 * recovery sweep looks for after a crash between the commit and the write.
 *
 * Never throws, and never touches `agent_configs` — recording projection
 * progress there would trip the raw-writer auto-bump and advance the lifecycle
 * CAS token for something that is not a domain change.
 */
function recordProjection(
  profileId: string,
  outcome: ProjectionOutcome,
): void {
  if (env.dbClient === 'postgres') return;
  const state = outcome.kind === 'projected'
    ? 'projected'
    : outcome.kind === 'not-applicable'
      ? 'not-applicable'
      : 'pending';
  const projectedRevision = outcome.kind === 'projected'
    ? outcome.revision
    : outcome.kind === 'not-applicable'
      ? outcome.revision
      : null;
  const errorCode = outcome.kind === 'projected' || outcome.kind === 'not-applicable'
    ? null
    : outcome.kind;
  try {
    getDb().prepare(
      `INSERT INTO agent_profile_projections
         (profile_id, file_projected_revision, projection_state, last_error_code,
          last_attempt_at, attempt_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET
         file_projected_revision =
           COALESCE(excluded.file_projected_revision, agent_profile_projections.file_projected_revision),
         projection_state = excluded.projection_state,
         last_error_code = excluded.last_error_code,
         last_attempt_at = excluded.last_attempt_at,
         attempt_count = CASE
           WHEN excluded.projection_state = 'pending'
             THEN agent_profile_projections.attempt_count + 1
           ELSE 0
         END,
         updated_at = excluded.updated_at`,
    ).run(
      profileId,
      projectedRevision,
      state,
      errorCode,
      new Date().toISOString(),
      state === 'pending' ? 1 : 0,
      new Date().toISOString(),
    );
  } catch (error) {
    // A ledger write that fails must not turn a successful projection into a
    // failure — it only costs the sweep its hint.
    logger.warn(
      `[agent-profile-projection] could not record projection for '${profileId}': ${String(error)}`,
    );
  }
}

export function projectLatestAgentProfile(
  input: ProjectLatestAgentProfileInput,
): ProjectionOutcome {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error('Profile projection requires a non-negative integer expected revision');
  }
  const configsRepo = input.configsRepo ?? new AgentConfigsRepository();
  const write = input.writeProfile ?? writeAgentProfileFile;

  // ── critical section: latest read → render → replace, with no await ──
  const current = configsRepo.getById(input.profileId);
  if (!current) return { kind: 'missing' };
  const record = (outcome: ProjectionOutcome): ProjectionOutcome => {
    recordProjection(input.profileId, outcome);
    return outcome;
  };
  // A blocked/disabled/locked profile must not simply be left alone: its old
  // file would keep serving the PRE-mutation scope to the engine, which for a
  // tightening is strictly wider than what was just approved.
  if (
    agentConfigExecutionBlockReason(current) !== null &&
    isProjectableAgentConfigIgnoringEnabled(current)
  ) {
    deleteAgentProfileFile(current.id);
    // deleteAgentProfileFile never throws — it swallows every rmSync failure as
    // a warning — so the delete has to be PROVED. A file that survived still
    // serves the pre-mutation (wider) scope to the engine, which is exactly the
    // incoherence `not-applicable` claims to have removed.
    if (agentProfileFileExists(current.id)) {
      return record({ kind: 'failed', revision: current.revision });
    }
    return record({ kind: 'not-applicable', revision: current.revision });
  }
  const result = write(current);
  // ────────────────────────────────────────────────────────────────────

  if (result === 'blocked') return record({ kind: 'blocked', revision: current.revision });
  if (result === 'failed') return record({ kind: 'failed', revision: current.revision });
  if (result === 'skipped') return record({ kind: 'not-applicable', revision: current.revision });
  // A `stale` outcome still PROJECTED the latest row — the caller's intent was
  // behind, the file is not — so the ledger records the revision on disk.
  recordProjection(input.profileId, { kind: 'projected', revision: current.revision, write: result });
  if (current.revision !== input.expectedRevision) {
    return {
      kind: 'stale',
      requestedRevision: input.expectedRevision,
      currentRevision: current.revision,
    };
  }
  return { kind: 'projected', revision: current.revision, write: result };
}

/**
 * For callers that have just written a row and want it projected. The row is
 * used ONLY for its id and revision — the boundary still re-reads the latest
 * config itself, so a caller holding a row across an await cannot overwrite a
 * newer operator edit. That is the whole reason this adapter exists instead of
 * every callsite reaching for `writeAgentProfileFile` directly.
 */
export function projectAgentProfileAfterWrite(
  config: { id: string; revision?: number },
  cause: ProjectionCause,
): ProjectionOutcome {
  return projectLatestAgentProfile({
    profileId: config.id,
    // A row without a revision is the legacy pre-column shape; treating it as
    // 0 makes the boundary report `stale` rather than silently claiming the
    // caller projected the latest.
    expectedRevision: config.revision ?? 0,
    cause,
  });
}
