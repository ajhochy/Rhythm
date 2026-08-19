/**
 * D2.1 (#1431) — the post-apply monitor/repair/revert lifecycle store.
 *
 * `proposal_id` is UNIQUE (DB-enforced), and `createAsync` proactively checks
 * for an existing row first — "one event per applied proposal" — matching
 * `AgentOrgProposalsRepository.createAsync`'s dedup-key idempotency
 * precedent: a retried apply-trigger never mints a second row or clobbers
 * the first.
 *
 * `redactSecrets` (the same shape-matching redactor `run_outcome_service.ts`
 * uses on its one free-text ledger column) runs over every JSON blob column
 * on the way in — the repository never trusts a caller to have redacted a
 * pre-change snapshot or an alert payload before calling it.
 *
 * ponytail: SQLite only for this slice, mirroring the C1/C2 enrollment and
 * receipt repositories — no bespoke Postgres branch exists here because this
 * table has no Postgres-only production caller yet (D2.5 wires the real
 * apply boundary). The migration itself IS dual-engine (see migrations.ts /
 * postgres_bootstrap.ts) per D2.1's own acceptance criteria.
 */

import Database from 'better-sqlite3';

import { getDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { redactSecrets } from '../services/run_outcome_service';
import {
  CreatePostApplyEventInput,
  GuardrailStatus,
  MAX_REPAIR_ATTEMPTS,
  PostApplyChangeType,
  PostApplyEvent,
  PostApplyRevertStatus,
  UpdatePostApplyEventPatch,
  parseRepairProposalIds,
} from '../models/post_apply_event';

interface PostApplyEventRow {
  id: string;
  proposal_id: string;
  profile_id: string;
  change_type: string;
  pre_change_snapshot_json: string;
  monitoring_window_start: string;
  monitoring_window_end: string;
  guardrail_status: string;
  repair_proposal_ids_json: string;
  revert_status: string;
  alert_payload_json: string | null;
  created_at: string;
  updated_at: string;
}

function rowToModel(row: PostApplyEventRow): PostApplyEvent {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    profileId: row.profile_id,
    changeType: row.change_type as PostApplyChangeType,
    preChangeSnapshotJson: row.pre_change_snapshot_json,
    monitoringWindowStart: row.monitoring_window_start,
    monitoringWindowEnd: row.monitoring_window_end,
    guardrailStatus: row.guardrail_status as GuardrailStatus,
    repairProposalIdsJson: row.repair_proposal_ids_json,
    revertStatus: row.revert_status as PostApplyRevertStatus,
    alertPayloadJson: row.alert_payload_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class PostApplyEventsRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
    } else {
      try {
        this.db = getDb();
      } catch {
        this.db = makeInMemoryDb();
      }
    }
  }

  /**
   * Create the one PostApplyEvent for `input.proposalId`. Idempotent: an
   * existing row for that proposal is returned unchanged rather than
   * duplicated or overwritten.
   */
  async createAsync(input: CreatePostApplyEventInput): Promise<PostApplyEvent> {
    const existing = await this.findByProposalIdAsync(input.proposalId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const row = {
      id: input.id ?? crypto.randomUUID(),
      proposal_id: input.proposalId,
      profile_id: input.profileId,
      change_type: input.changeType,
      pre_change_snapshot_json: redactSecrets(input.preChangeSnapshotJson),
      monitoring_window_start: input.monitoringWindowStart,
      monitoring_window_end: input.monitoringWindowEnd,
      guardrail_status: 'monitoring' as GuardrailStatus,
      repair_proposal_ids_json: '[]',
      revert_status: 'none' as PostApplyRevertStatus,
      alert_payload_json: null as string | null,
      created_at: now,
      updated_at: now,
    };

    try {
      this.db
        .prepare(
          `INSERT INTO agent_org_post_apply_events
             (id, proposal_id, profile_id, change_type, pre_change_snapshot_json,
              monitoring_window_start, monitoring_window_end, guardrail_status,
              repair_proposal_ids_json, revert_status, alert_payload_json, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          row.id,
          row.proposal_id,
          row.profile_id,
          row.change_type,
          row.pre_change_snapshot_json,
          row.monitoring_window_start,
          row.monitoring_window_end,
          row.guardrail_status,
          row.repair_proposal_ids_json,
          row.revert_status,
          row.alert_payload_json,
          row.created_at,
          row.updated_at,
        );
    } catch (err) {
      // A concurrent create for the same proposal lost the race between the
      // proactive check above and this insert — the UNIQUE index is the
      // backstop; read back the winner rather than throwing.
      const winner = await this.findByProposalIdAsync(input.proposalId);
      if (winner) return winner;
      throw err;
    }

    const created = await this.findByProposalIdAsync(input.proposalId);
    if (!created) {
      throw new Error(`post apply event for proposal '${input.proposalId}' was not persisted`);
    }
    return created;
  }

  async findByProposalIdAsync(proposalId: string): Promise<PostApplyEvent | null> {
    const row = this.db
      .prepare(`SELECT * FROM agent_org_post_apply_events WHERE proposal_id = ?`)
      .get(proposalId) as PostApplyEventRow | undefined;
    return row ? rowToModel(row) : null;
  }

  async findByIdAsync(id: string): Promise<PostApplyEvent | null> {
    const row = this.db
      .prepare(`SELECT * FROM agent_org_post_apply_events WHERE id = ?`)
      .get(id) as PostApplyEventRow | undefined;
    return row ? rowToModel(row) : null;
  }

  /**
   * Patch guardrail/repair/revert/alert/window fields on the one event for
   * `proposalId`. Returns null if no event exists for it. `repairProposalIdsJson`
   * (when provided) is truncated to the most recent {@link MAX_REPAIR_ATTEMPTS}
   * entries — defense-in-depth; the real 3-strike loop (D2.3) should never
   * pass more than that itself.
   */
  async updateStatusAsync(
    proposalId: string,
    patch: UpdatePostApplyEventPatch,
  ): Promise<PostApplyEvent | null> {
    const current = await this.findByProposalIdAsync(proposalId);
    if (!current) return null;

    const nextGuardrailStatus = patch.guardrailStatus ?? current.guardrailStatus;
    const nextRevertStatus = patch.revertStatus ?? current.revertStatus;
    const nextMonitoringWindowEnd = patch.monitoringWindowEnd ?? current.monitoringWindowEnd;
    const nextAlertPayloadJson =
      patch.alertPayloadJson === undefined
        ? current.alertPayloadJson
        : patch.alertPayloadJson === null
          ? null
          : redactSecrets(patch.alertPayloadJson);

    let nextRepairProposalIdsJson = current.repairProposalIdsJson;
    if (patch.repairProposalIdsJson !== undefined) {
      const ids = parseRepairProposalIds(patch.repairProposalIdsJson).slice(0, MAX_REPAIR_ATTEMPTS);
      nextRepairProposalIdsJson = JSON.stringify(ids);
    }

    this.db
      .prepare(
        `UPDATE agent_org_post_apply_events
           SET guardrail_status = ?, repair_proposal_ids_json = ?, revert_status = ?,
               alert_payload_json = ?, monitoring_window_end = ?, updated_at = ?
         WHERE proposal_id = ?`,
      )
      .run(
        nextGuardrailStatus,
        nextRepairProposalIdsJson,
        nextRevertStatus,
        nextAlertPayloadJson,
        nextMonitoringWindowEnd,
        new Date().toISOString(),
        proposalId,
      );

    return this.findByProposalIdAsync(proposalId);
  }
}
