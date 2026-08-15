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

import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import {
  deleteAgentProfileFile,
  isProjectableAgentConfigIgnoringEnabled,
  writeAgentProfileFile,
  type AgentProfileWriteResult,
} from './opencode_agent_writer';

export type ProjectionCause =
  | 'scope-apply'
  | 'scope-compensation'
  | 'scope-revert'
  | 'recovery';

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
  // A blocked/disabled/locked profile must not simply be left alone: its old
  // file would keep serving the PRE-mutation scope to the engine, which for a
  // tightening is strictly wider than what was just approved.
  if (
    agentConfigExecutionBlockReason(current) !== null &&
    isProjectableAgentConfigIgnoringEnabled(current)
  ) {
    deleteAgentProfileFile(current.id);
    return { kind: 'not-applicable', revision: current.revision };
  }
  const result = write(current);
  // ────────────────────────────────────────────────────────────────────

  if (result === 'blocked') return { kind: 'blocked', revision: current.revision };
  if (result === 'failed') return { kind: 'failed', revision: current.revision };
  if (result === 'skipped') return { kind: 'not-applicable', revision: current.revision };
  if (current.revision !== input.expectedRevision) {
    return {
      kind: 'stale',
      requestedRevision: input.expectedRevision,
      currentRevision: current.revision,
    };
  }
  return { kind: 'projected', revision: current.revision, write: result };
}
