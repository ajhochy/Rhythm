import { createHash, randomUUID } from 'node:crypto';

import { getDb } from '../database/db';
import type {
  AgentWorkstream,
  AgentWorkstreamCheckpoint,
  AgentWorkstreamClosedReason,
  AgentWorkstreamState,
} from '../models/agent_workstream';

type Row = {
  id: string; owner_user_id: number; project_id: string; goal: string; constraints_text: string;
  criteria_text: string; checkpoint_json: string; state: AgentWorkstreamState;
  state_reason: string | null; closed_reason: AgentWorkstreamClosedReason;
  executor_epoch: string | null; last_job_id: string | null; revision: number;
  create_key: string; created_at: string; updated_at: string;
};

const toModel = (row: Row): AgentWorkstream => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  projectId: row.project_id,
  goal: row.goal,
  constraints: row.constraints_text,
  criteria: row.criteria_text,
  checkpoint: JSON.parse(row.checkpoint_json) as AgentWorkstreamCheckpoint,
  state: row.state,
  stateReason: row.state_reason,
  closedReason: row.closed_reason,
  executorEpoch: row.executor_epoch,
  lastJobId: row.last_job_id,
  revision: row.revision,
  createKey: row.create_key,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ACTIVE = new Set<AgentWorkstreamState>(['queued', 'running']);

export class AgentWorkstreamsRepository {
  create(ownerUserId: number, input: {
    projectId: string; goal: string; constraints: string; criteria: string;
    checkpoint: AgentWorkstreamCheckpoint; createKey: string;
  }): { row: AgentWorkstream; replay: boolean; conflict: boolean } {
    const payloadHash = hash(input);
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM agent_workstreams
      WHERE owner_user_id=? AND project_id=? AND create_key=?`).get(
      ownerUserId, input.projectId, input.createKey,
    ) as Row | undefined;
    if (existing) {
      const stored = db.prepare('SELECT payload_hash FROM agent_workstreams WHERE id=?').get(existing.id) as { payload_hash: string };
      return { row: toModel(existing), replay: true, conflict: stored.payload_hash !== payloadHash };
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    try {
      db.prepare(`INSERT INTO agent_workstreams (
        id,owner_user_id,project_id,goal,constraints_text,criteria_text,checkpoint_json,
        state,state_reason,closed_reason,executor_epoch,last_job_id,revision,create_key,payload_hash,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,'ready',NULL,NULL,NULL,NULL,1,?,?,?,?)`).run(
        id, ownerUserId, input.projectId, input.goal, input.constraints, input.criteria,
        JSON.stringify(input.checkpoint), input.createKey, payloadHash, now, now,
      );
    } catch (error) {
      const row = db.prepare(`SELECT * FROM agent_workstreams
        WHERE owner_user_id=? AND project_id=? AND create_key=?`).get(
        ownerUserId, input.projectId, input.createKey,
      ) as Row | undefined;
      if (!row) throw error;
      const stored = db.prepare('SELECT payload_hash FROM agent_workstreams WHERE id=?').get(row.id) as { payload_hash: string };
      return { row: toModel(row), replay: true, conflict: stored.payload_hash !== payloadHash };
    }
    return { row: this.find(ownerUserId, input.projectId, id)!, replay: false, conflict: false };
  }

  find(ownerUserId: number, projectId: string, id: string): AgentWorkstream | null {
    const row = getDb().prepare(`SELECT * FROM agent_workstreams
      WHERE owner_user_id=? AND project_id=? AND id=?`).get(ownerUserId, projectId, id) as Row | undefined;
    return row ? toModel(row) : null;
  }

  list(ownerUserId: number, projectId: string, limit: number, after?: string): AgentWorkstream[] {
    const rows = (after
      ? getDb().prepare(`SELECT * FROM agent_workstreams WHERE owner_user_id=? AND project_id=? AND id>?
          ORDER BY id LIMIT ?`).all(ownerUserId, projectId, after, limit)
      : getDb().prepare(`SELECT * FROM agent_workstreams WHERE owner_user_id=? AND project_id=?
          ORDER BY id LIMIT ?`).all(ownerUserId, projectId, limit)) as Row[];
    return rows.map(toModel);
  }

  revise(ownerUserId: number, projectId: string, id: string, expected: number,
    patch: Partial<Pick<AgentWorkstream, 'goal' | 'constraints' | 'criteria' | 'checkpoint'>>,
  ): AgentWorkstream | null {
    const current = this.find(ownerUserId, projectId, id);
    if (!current) return null;
    const next = { ...current, ...patch };
    const now = new Date().toISOString();
    // A control revision fences any in-flight result from application.  The
    // engine is not presumed stopped; its arrival remains visible as stale.
    const state = ACTIVE.has(current.state) ? 'blocked' : current.state;
    const reason = ACTIVE.has(current.state) ? 'controls_revised' : current.stateReason;
    const changed = getDb().prepare(`UPDATE agent_workstreams
      SET goal=?,constraints_text=?,criteria_text=?,checkpoint_json=?,state=?,state_reason=?,
          revision=revision+1,updated_at=?
      WHERE owner_user_id=? AND project_id=? AND id=? AND revision=? AND revision < 9007199254740991`).run(
      next.goal, next.constraints, next.criteria, JSON.stringify(next.checkpoint), state, reason,
      now, ownerUserId, projectId, id, expected,
    ).changes;
    return changed ? this.find(ownerUserId, projectId, id) : null;
  }

  pause(ownerUserId: number, projectId: string, id: string, expected: number): AgentWorkstream | null {
    const now = new Date().toISOString();
    const changed = getDb().prepare(`UPDATE agent_workstreams
      SET state='paused',state_reason='user_paused',closed_reason='user_paused',
          revision=revision+1,updated_at=?
      WHERE owner_user_id=? AND project_id=? AND id=? AND revision=?
        AND state NOT IN ('completed','cancelled') AND revision < 9007199254740991`).run(
      now, ownerUserId, projectId, id, expected,
    ).changes;
    return changed ? this.find(ownerUserId, projectId, id) : null;
  }

  resume(ownerUserId: number, projectId: string, id: string, expected: number): AgentWorkstream | null {
    const now = new Date().toISOString();
    const changed = getDb().prepare(`UPDATE agent_workstreams
      SET state='ready',state_reason=NULL,closed_reason=NULL,executor_epoch=NULL,
          revision=revision+1,updated_at=?
      WHERE owner_user_id=? AND project_id=? AND id=? AND revision=?
        AND state IN ('paused','blocked','unknown') AND revision < 9007199254740991`).run(
      now, ownerUserId, projectId, id, expected,
    ).changes;
    return changed ? this.find(ownerUserId, projectId, id) : null;
  }

  cancel(ownerUserId: number, projectId: string, id: string, expected: number): AgentWorkstream | null {
    const now = new Date().toISOString();
    const changed = getDb().prepare(`UPDATE agent_workstreams
      SET state='cancelled',state_reason='user_cancelled',closed_reason='user_cancelled',
          revision=revision+1,updated_at=?
      WHERE owner_user_id=? AND project_id=? AND id=? AND revision=?
        AND state <> 'completed' AND revision < 9007199254740991`).run(
      now, ownerUserId, projectId, id, expected,
    ).changes;
    return changed ? this.find(ownerUserId, projectId, id) : null;
  }

  setRuntimeState(input: {
    ownerUserId: number; projectId: string; id: string; state: AgentWorkstreamState;
    reason: string | null; executorEpoch?: string | null; lastJobId?: string | null;
  }): AgentWorkstream | null {
    const now = new Date().toISOString();
    const closedReason = input.state === 'paused' ? 'user_paused'
      : input.state === 'cancelled' ? 'user_cancelled' : null;
    const changed = getDb().prepare(`UPDATE agent_workstreams
      SET state=?,state_reason=?,closed_reason=?,executor_epoch=COALESCE(?,executor_epoch),
          last_job_id=COALESCE(?,last_job_id),updated_at=?
      WHERE owner_user_id=? AND project_id=? AND id=?`).run(
      input.state, input.reason, closedReason, input.executorEpoch ?? null,
      input.lastJobId ?? null, now, input.ownerUserId, input.projectId, input.id,
    ).changes;
    return changed ? this.find(input.ownerUserId, input.projectId, input.id) : null;
  }

  /**
   * Applies an executor observation only while the exact control generation it
   * observed is still current.  User pause/cancel/revise controls increment
   * the revision, so a late engine callback cannot reopen or overwrite them.
   * This deliberately does not increment the revision: it is executor status,
   * not a user-authored control edit.
   */
  setRuntimeStateIfCurrent(input: {
    ownerUserId: number;
    projectId: string;
    id: string;
    expectedRevision: number;
    expectedExecutorEpoch: string | null;
    expectedLastJobId: string | null;
    expectedStates: AgentWorkstreamState[];
    state: AgentWorkstreamState;
    reason: string | null;
    executorEpoch?: string | null;
    lastJobId?: string | null;
  }): AgentWorkstream | null {
    if (input.expectedStates.length === 0) return null;
    const now = new Date().toISOString();
    const placeholders = input.expectedStates.map(() => '?').join(',');
    const changed = getDb().prepare(`UPDATE agent_workstreams
      SET state=?,state_reason=?,closed_reason=NULL,executor_epoch=?,last_job_id=?,updated_at=?
      WHERE owner_user_id=? AND project_id=? AND id=? AND revision=?
        AND executor_epoch IS ? AND last_job_id IS ?
        AND state IN (${placeholders})`).run(
      input.state,
      input.reason,
      input.executorEpoch === undefined ? input.expectedExecutorEpoch : input.executorEpoch,
      input.lastJobId === undefined ? input.expectedLastJobId : input.lastJobId,
      now,
      input.ownerUserId,
      input.projectId,
      input.id,
      input.expectedRevision,
      input.expectedExecutorEpoch,
      input.expectedLastJobId,
      ...input.expectedStates,
    ).changes;
    return changed ? this.find(input.ownerUserId, input.projectId, input.id) : null;
  }

  updateCheckpointForApplication(input: {
    ownerUserId: number; projectId: string; id: string; expectedRevision: number;
    checkpoint: AgentWorkstreamCheckpoint; state: AgentWorkstreamState; reason: string | null;
  }): AgentWorkstream | null {
    const now = new Date().toISOString();
    const changed = getDb().prepare(`UPDATE agent_workstreams
      SET checkpoint_json=?,state=?,state_reason=?,closed_reason=NULL,updated_at=?
      WHERE owner_user_id=? AND project_id=? AND id=? AND revision=?`).run(
      JSON.stringify(input.checkpoint), input.state, input.reason, now,
      input.ownerUserId, input.projectId, input.id, input.expectedRevision,
    ).changes;
    return changed ? this.find(input.ownerUserId, input.projectId, input.id) : null;
  }
}
