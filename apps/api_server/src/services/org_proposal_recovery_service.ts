/**
 * W1 package C — the bounded recovery sweep.
 *
 * The database commit, the profile file, and the engine reload are three
 * stores that cannot be committed together. The lifecycle's honest guarantee is
 * therefore durable DETECTION, and this is the thing that acts on it:
 *
 *   - a profile whose projected revision lags the database (a crash between the
 *     atomic commit and the file write) is re-projected;
 *   - a proposal parked in `approved` or `applied` is classified and either
 *     resumed or durably marked `reconciliation-required`.
 *
 * Everything here is BOUNDED — a hard per-run limit, an attempt count, and a
 * backoff — because an unbounded reconciler that retries a permanently broken
 * row is just a busy loop that hides the breakage.
 *
 * What this deliberately does NOT do: resume an `approved` proposal whose
 * target has moved. The human approved an exact preimage; if that preimage is
 * gone their approval no longer describes anything, so it needs a new one.
 */

import { logger } from '../utils/logger';
import { env } from '../config/env';
import { getDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { projectLatestAgentProfile } from './agent_profile_projection_service';
import { verifyScopeSnapshotForRevert } from './scope_mutation_contract';
import { readScopeFieldValue } from './scope_pair_classification';
import { parseStrictJson } from './strict_json';

/** Stop re-projecting a profile that has failed this many times in a row. */
export const PROJECTION_ATTEMPT_LIMIT = 5;
/** Hard ceiling on work per sweep, so one run cannot monopolise the process. */
export const RECOVERY_SWEEP_LIMIT = 50;

export interface RecoverySweepResult {
  /** Profiles whose file lagged the database and were re-projected. */
  projectionsRepaired: number;
  /** Profiles still lagging after the attempt (or over the attempt limit). */
  projectionsUnresolved: number;
  /** Proposals durably marked `reconciliation-required` by this sweep. */
  proposalsReconciled: number;
  /** Proposals inspected and found coherent — left exactly as they were. */
  proposalsHealthy: number;
}

export interface RecoverySweepDeps {
  proposalsRepo?: AgentOrgProposalsRepository;
  configsRepo?: AgentConfigsRepository;
  project?: typeof projectLatestAgentProfile;
  limit?: number;
}

interface LaggingRow {
  profile_id: string;
  revision: number;
  attempt_count: number;
}

/**
 * Profiles whose durable projection state proves the file is behind the row —
 * either never recorded, or recorded at an older revision, or recorded as a
 * failed attempt. Bounded, and profiles past the attempt limit are excluded
 * rather than retried forever.
 */
function laggingProfiles(limit: number): LaggingRow[] {
  return getDb()
    .prepare(
      `SELECT c.id AS profile_id, c.revision AS revision,
              COALESCE(p.attempt_count, 0) AS attempt_count
         FROM agent_configs c
         LEFT JOIN agent_profile_projections p ON p.profile_id = c.id
        WHERE (p.profile_id IS NULL
               OR p.projection_state = 'pending'
               OR p.file_projected_revision IS NULL
               OR p.file_projected_revision < c.revision)
          AND COALESCE(p.attempt_count, 0) < ?
        ORDER BY c.id
        LIMIT ?`,
    )
    .all(PROJECTION_ATTEMPT_LIMIT, limit) as LaggingRow[];
}

/**
 * Is this scope proposal's claim still describing reality? `approved` means the
 * target must still hold the exact prior bytes; `applied` means it must hold
 * the exact applied bytes. Anything else — including a target that vanished or
 * a snapshot that no longer verifies — is incoherent and needs a human.
 */
function scopeClaimIsCoherent(
  proposal: { kind: string; status: string; changeJson: string | null; beforeSnapshotJson: string | null },
  configsRepo: AgentConfigsRepository,
): boolean {
  if (!proposal.changeJson || !proposal.beforeSnapshotJson) return false;
  let snapshot: unknown;
  try {
    snapshot = parseStrictJson(proposal.beforeSnapshotJson, 'proposal before_snapshot_json');
  } catch {
    return false;
  }
  const verified = verifyScopeSnapshotForRevert(snapshot, proposal.kind, proposal.changeJson);
  if (!verified) return false;
  const target = configsRepo.getById(verified.prepared.agentConfigId);
  if (!target) return false;
  const live = readScopeFieldValue(target, verified.prepared.field);
  return proposal.status === 'approved'
    ? live === verified.prepared.priorValue
    : live === verified.prepared.expectedAppliedValue;
}

const SCOPE_KINDS = new Set(['tighten-scope', 'prune-scope', 'refine-scope', 'broaden-scope']);

/**
 * One bounded pass. NEVER throws — the caller is a background loop, and a
 * reconciler that can take the process down is worse than a lagging file.
 */
export async function runRecoverySweep(
  deps: RecoverySweepDeps = {},
): Promise<RecoverySweepResult> {
  const result: RecoverySweepResult = {
    projectionsRepaired: 0,
    projectionsUnresolved: 0,
    proposalsReconciled: 0,
    proposalsHealthy: 0,
  };
  // The ledger and the profile files are local-engine concepts; the hosted
  // split store has no HOME to project into.
  if (env.dbClient === 'postgres') return result;

  const limit = deps.limit ?? RECOVERY_SWEEP_LIMIT;
  const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();
  const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  const project = deps.project ?? projectLatestAgentProfile;

  try {
    for (const row of laggingProfiles(limit)) {
      const outcome = project({
        profileId: row.profile_id,
        expectedRevision: row.revision,
        cause: 'recovery',
      });
      if (outcome.kind === 'projected' || outcome.kind === 'not-applicable' || outcome.kind === 'stale') {
        result.projectionsRepaired += 1;
      } else {
        result.projectionsUnresolved += 1;
        logger.warn(
          `[org-proposal-recovery] profile '${row.profile_id}' still lagging after re-projection: ${outcome.kind}`,
        );
      }
    }
  } catch (error) {
    logger.warn(`[org-proposal-recovery] projection sweep failed (non-fatal): ${String(error)}`);
  }

  try {
    let budget = limit;
    for (const status of ['approved', 'applied'] as const) {
      for (const proposal of await proposalsRepo.listByStatusAsync(status)) {
        if (budget <= 0) break;
        budget -= 1;
        if (!SCOPE_KINDS.has(proposal.kind)) continue;
        if (scopeClaimIsCoherent(proposal, configsRepo)) {
          result.proposalsHealthy += 1;
          continue;
        }
        const marked = await proposalsRepo.markReconciliationRequiredAsync({
          proposalId: proposal.id,
          expectedStatus: proposal.status,
          expectedRevision: proposal.revision,
          reason:
            `recovery sweep found a '${proposal.status}' scope claim whose target no longer ` +
            'matches the exact bytes it was approved against',
        });
        if (marked) result.proposalsReconciled += 1;
      }
    }
  } catch (error) {
    logger.warn(`[org-proposal-recovery] proposal sweep failed (non-fatal): ${String(error)}`);
  }

  return result;
}
