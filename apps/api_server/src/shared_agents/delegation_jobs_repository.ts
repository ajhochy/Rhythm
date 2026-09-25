import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type Database from 'better-sqlite3';

import { getDb } from '../database/db';

export type AgentBridgeJobDirection = 'rhythm_to_hermes' | 'hermes_to_rhythm';
export type AgentBridgeJobState =
  | 'queued' | 'claimed' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export type AgentBridgeJobDeliveryState = 'pending' | 'waking' | 'delivered';

export interface AgentBridgeJobRow {
  id: string;
  direction: AgentBridgeJobDirection;
  idempotency_key: string;
  request_sha256: string;
  local_user_id: number;
  hermes_profile: 'default';
  parent_runtime: 'opencode' | 'hermes';
  parent_runtime_instance: string;
  parent_session_id: string;
  parent_agent_id: string;
  parent_projection_id: string | null;
  target_agent_id: string;
  target_revision: number;
  target_runtime: 'opencode' | 'hermes';
  child_runtime_instance: string | null;
  child_session_id: string | null;
  depth: number;
  chain_id: string;
  prompt: string;
  context: string | null;
  cwd: string | null;
  state: AgentBridgeJobState;
  state_reason: string | null;
  cancel_requested_at: string | null;
  result_text: string | null;
  result_truncated: number;
  progress_json: string | null;
  lease_token_sha256: string | null;
  lease_expires_at: string | null;
  delivery_state: AgentBridgeJobDeliveryState;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  terminal_at: string | null;
}

export interface AgentBridgeJobInsert {
  id?: string;
  direction: AgentBridgeJobDirection;
  idempotencyKey: string;
  requestSha256: string;
  localUserId: number;
  hermesProfile: 'default';
  parentRuntime: 'opencode' | 'hermes';
  parentRuntimeInstance: string;
  parentSessionId: string;
  parentAgentId: string;
  parentProjectionId: string | null;
  targetAgentId: string;
  targetRevision: number;
  targetRuntime: 'opencode' | 'hermes';
  depth: number;
  chainId: string;
  prompt: string;
  context: string | null;
  cwd: string | null;
  now: string;
}

export interface BridgeJobView {
  jobId: string;
  direction: AgentBridgeJobDirection;
  state: AgentBridgeJobState;
  stateReason: string | null;
  targetAgentId: string;
  targetRevision: number;
  targetRuntime: 'opencode' | 'hermes';
  depth: number;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
  progress: { steps: number; latestKind: string } | null;
  resultAvailable: boolean;
  delivered: boolean;
}

export class BridgeJobError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 409) {
    super(code);
    this.name = 'BridgeJobError';
  }
}

const TERMINAL = new Set<AgentBridgeJobState>(['succeeded', 'failed', 'cancelled']);
const LEASE_MS = 60_000;
const QUEUED_TIMEOUT_MS = 10 * 60_000;
const RESULT_CHARS = 16_384;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenMatches(token: string, expected: string | null): boolean {
  if (!expected) return false;
  const actual = Buffer.from(digest(token), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function plusMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function truncateResult(value: string | undefined): { text: string | null; truncated: number } {
  if (value === undefined) return { text: null, truncated: 0 };
  return { text: value.slice(0, RESULT_CHARS), truncated: value.length > RESULT_CHARS ? 1 : 0 };
}

export class AgentBridgeJobsRepository {
  constructor(private readonly db: Database.Database = getDb()) {}

  createOrReplay(input: AgentBridgeJobInsert): { row: AgentBridgeJobRow; replay: boolean } {
    const existing = this.db.prepare(`
      SELECT * FROM agent_bridge_jobs
       WHERE local_user_id = ? AND parent_runtime = ?
         AND parent_session_id = ? AND idempotency_key = ?
    `).get(
      input.localUserId,
      input.parentRuntime,
      input.parentSessionId,
      input.idempotencyKey,
    ) as AgentBridgeJobRow | undefined;
    if (existing) {
      if (existing.request_sha256 !== input.requestSha256) {
        throw new BridgeJobError('idempotency_conflict');
      }
      return { row: existing, replay: true };
    }

    const id = input.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO agent_bridge_jobs (
        id, direction, idempotency_key, request_sha256, local_user_id, hermes_profile,
        parent_runtime, parent_runtime_instance, parent_session_id, parent_agent_id,
        parent_projection_id, target_agent_id, target_revision, target_runtime,
        depth, chain_id, prompt, context, cwd, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `).run(
      id, input.direction, input.idempotencyKey, input.requestSha256,
      input.localUserId, input.hermesProfile, input.parentRuntime,
      input.parentRuntimeInstance, input.parentSessionId, input.parentAgentId,
      input.parentProjectionId, input.targetAgentId, input.targetRevision,
      input.targetRuntime, input.depth, input.chainId, input.prompt, input.context,
      input.cwd, input.now, input.now,
    );
    return { row: this.get(id)!, replay: false };
  }

  get(id: string): AgentBridgeJobRow | null {
    return this.db.prepare(`SELECT * FROM agent_bridge_jobs WHERE id = ?`)
      .get(id) as AgentBridgeJobRow | undefined ?? null;
  }

  view(row: AgentBridgeJobRow): BridgeJobView {
    let progress: BridgeJobView['progress'] = null;
    if (row.progress_json) {
      try {
        const parsed = JSON.parse(row.progress_json) as { steps?: unknown; latestKind?: unknown };
        if (Number.isInteger(parsed.steps) && typeof parsed.latestKind === 'string') {
          progress = { steps: parsed.steps as number, latestKind: parsed.latestKind };
        }
      } catch {
        progress = null;
      }
    }
    return {
      jobId: row.id,
      direction: row.direction,
      state: row.state,
      stateReason: row.state_reason,
      targetAgentId: row.target_agent_id,
      targetRevision: row.target_revision,
      targetRuntime: row.target_runtime,
      depth: row.depth,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      terminalAt: row.terminal_at,
      progress,
      resultAvailable: TERMINAL.has(row.state),
      delivered: row.delivery_state === 'delivered',
    };
  }

  listForParent(input: {
    localUserId: number;
    parentRuntime: 'opencode' | 'hermes';
    parentSessionId: string;
    jobId?: string;
  }): AgentBridgeJobRow[] {
    const suffix = input.jobId ? ' AND id = ?' : '';
    const args = [input.localUserId, input.parentRuntime, input.parentSessionId];
    if (input.jobId) args.push(input.jobId);
    return this.db.prepare(`
      SELECT * FROM agent_bridge_jobs
       WHERE local_user_id = ? AND parent_runtime = ? AND parent_session_id = ?${suffix}
       ORDER BY created_at DESC, id DESC
    `).all(...args) as AgentBridgeJobRow[];
  }

  claimNext(input: {
    localUserId: number;
    hermesProfile: 'default';
    runtimeGeneration: string;
    now: string;
  }): { row: AgentBridgeJobRow; leaseToken: string } | null {
    const leaseToken = randomBytes(32).toString('base64url');
    const row = this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state = 'claimed', child_runtime_instance = ?, lease_token_sha256 = ?,
             lease_expires_at = ?, updated_at = ?
       WHERE id = (
         SELECT id FROM agent_bridge_jobs
          WHERE local_user_id = ? AND hermes_profile = ?
            AND direction = 'rhythm_to_hermes' AND state = 'queued'
          ORDER BY created_at, id LIMIT 1
       )
       RETURNING *
    `).get(
      input.runtimeGeneration,
      digest(leaseToken),
      plusMs(input.now, LEASE_MS),
      input.now,
      input.localUserId,
      input.hermesProfile,
    ) as AgentBridgeJobRow | undefined;
    return row ? { row, leaseToken } : null;
  }

  hasQueued(localUserId: number, hermesProfile: 'default'): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM agent_bridge_jobs
       WHERE local_user_id=? AND hermes_profile=?
         AND direction='rhythm_to_hermes' AND state='queued'
       LIMIT 1
    `).get(localUserId, hermesProfile));
  }

  report(input: {
    jobId: string;
    leaseToken: string;
    phase: 'running' | 'progress' | 'succeeded' | 'failed' | 'cancelled';
    childSessionKey?: string;
    progress?: { steps: number; latestKind: string };
    resultText?: string;
    errorCode?: string;
    now: string;
  }): AgentBridgeJobRow {
    const current = this.get(input.jobId);
    if (!current) throw new BridgeJobError('job_not_found', 404);
    if (!tokenMatches(input.leaseToken, current.lease_token_sha256)) {
      throw new BridgeJobError('lease_invalid', 403);
    }
    if (TERMINAL.has(current.state)) throw new BridgeJobError('job_terminal');
    if (current.state === 'unknown') {
      if (!input.childSessionKey || input.childSessionKey !== current.child_session_id) {
        throw new BridgeJobError('lease_invalid', 403);
      }
      if (input.phase !== 'succeeded' && input.phase !== 'failed') {
        throw new BridgeJobError('job_unknown');
      }
    }

    const terminal = input.phase === 'succeeded' || input.phase === 'failed' || input.phase === 'cancelled';
    const nextState: AgentBridgeJobState = input.phase === 'progress'
      ? current.state
      : input.phase;
    const result = truncateResult(input.resultText);
    const updated = this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state = ?, state_reason = ?, child_session_id = COALESCE(?, child_session_id),
             result_text = COALESCE(?, result_text),
             result_truncated = CASE WHEN ? IS NULL THEN result_truncated ELSE ? END,
             progress_json = COALESCE(?, progress_json), lease_expires_at = ?,
             updated_at = ?, terminal_at = CASE WHEN ? THEN ? ELSE terminal_at END
       WHERE id = ? AND state = ?
       RETURNING *
    `).get(
      nextState,
      input.phase === 'failed' ? input.errorCode ?? 'engine_error' : null,
      input.childSessionKey ?? null,
      result.text,
      input.resultText ?? null,
      result.truncated,
      input.progress ? JSON.stringify(input.progress) : null,
      terminal ? current.lease_expires_at : plusMs(input.now, LEASE_MS),
      input.now,
      terminal ? 1 : 0,
      input.now,
      input.jobId,
      current.state,
    ) as AgentBridgeJobRow | undefined;
    if (!updated) return this.get(input.jobId)!;
    return updated;
  }

  assertClaimProjection(input: {
    jobId: string;
    leaseToken: string;
    targetRevision: number;
    runtimeGeneration: string;
    cwd: string | null;
    now: string;
  }): AgentBridgeJobRow {
    const row = this.get(input.jobId);
    if (!row || (row.state !== 'claimed' && row.state !== 'running')) {
      throw new BridgeJobError('job_not_claimed');
    }
    if (!tokenMatches(input.leaseToken, row.lease_token_sha256) ||
        row.child_runtime_instance !== input.runtimeGeneration) {
      throw new BridgeJobError('lease_invalid', 403);
    }
    if (row.cwd !== input.cwd) throw new BridgeJobError('cwd_mismatch');
    if (row.target_revision !== input.targetRevision) {
      this.db.prepare(`
        UPDATE agent_bridge_jobs
           SET state='failed', state_reason='target_revision_changed',
               updated_at=?, terminal_at=?
         WHERE id=? AND state IN ('claimed','running')
      `).run(input.now, input.now, input.jobId);
      throw new BridgeJobError('target_revision_changed');
    }
    return row;
  }

  setChild(jobId: string, childSessionId: string, runtimeInstance = 'local', now = new Date().toISOString()): AgentBridgeJobRow {
    const row = this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET child_session_id=?, child_runtime_instance=?, state='running', updated_at=?
       WHERE id=? AND state='queued' AND child_session_id IS NULL
       RETURNING *
    `).get(childSessionId, runtimeInstance, now, jobId) as AgentBridgeJobRow | undefined;
    if (!row) throw new BridgeJobError('child_already_set');
    return row;
  }

  completeFromRunner(
    jobId: string,
    result: { status: 'done' | 'error'; result: string; error?: string; errorCode?: string },
    now = new Date().toISOString(),
  ): AgentBridgeJobRow {
    const current = this.get(jobId);
    if (!current) throw new BridgeJobError('job_not_found', 404);
    if (TERMINAL.has(current.state)) return current;
    const stored = truncateResult(result.status === 'done' ? result.result : result.error);
    const row = this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state=?, state_reason=?, result_text=?, result_truncated=?, updated_at=?, terminal_at=?
       WHERE id=? AND state IN ('queued','running')
       RETURNING *
    `).get(
      result.status === 'done' ? 'succeeded' : 'failed',
      result.status === 'done' ? null : result.errorCode ?? 'engine_error',
      stored.text, stored.truncated, now, now, jobId,
    ) as AgentBridgeJobRow | undefined;
    return row ?? this.get(jobId)!;
  }

  cancel(jobId: string, now = new Date().toISOString()): AgentBridgeJobRow {
    const current = this.get(jobId);
    if (!current) throw new BridgeJobError('job_not_found', 404);
    if (TERMINAL.has(current.state) || current.state === 'unknown') {
      throw new BridgeJobError('job_terminal');
    }
    return this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='cancelled', cancel_requested_at=?, updated_at=?, terminal_at=?
       WHERE id=? AND state NOT IN ('succeeded','failed','cancelled')
       RETURNING *
    `).get(now, now, now, jobId) as AgentBridgeJobRow;
  }

  readResult(jobId: string, now = new Date().toISOString()): AgentBridgeJobRow {
    const current = this.get(jobId);
    if (!current) throw new BridgeJobError('job_not_found', 404);
    if (!TERMINAL.has(current.state)) throw new BridgeJobError('job_not_terminal');
    this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET delivery_state='delivered', delivered_at=COALESCE(delivered_at, ?), updated_at=updated_at
       WHERE id=? AND delivery_state <> 'delivered'
    `).run(now, jobId);
    return this.get(jobId)!;
  }

  recoverAfterRestart(now = new Date().toISOString()): void {
    this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='unknown', state_reason='api_restarted', updated_at=?
       WHERE direction='hermes_to_rhythm' AND state IN ('queued','running')
    `).run(now);
    this.sweep(now);
  }

  markRuntimeRetired(runtimeGeneration: string, now = new Date().toISOString()): void {
    this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='unknown', state_reason='runtime_retired', updated_at=?
       WHERE direction='rhythm_to_hermes' AND child_runtime_instance=?
         AND state IN ('claimed','running')
    `).run(now, runtimeGeneration);
  }

  sweep(now = new Date().toISOString()): string[] {
    const queuedCutoff = new Date(Date.parse(now) - QUEUED_TIMEOUT_MS).toISOString();
    const terminalParents = (this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='failed', state_reason='hermes_runtime_timeout', updated_at=?, terminal_at=?
       WHERE direction='rhythm_to_hermes' AND state='queued' AND created_at < ?
       RETURNING parent_session_id
    `).all(now, now, queuedCutoff) as Array<{ parent_session_id: string }>)
      .map((row) => row.parent_session_id);
    this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='unknown', state_reason='lease_expired', updated_at=?
       WHERE direction='rhythm_to_hermes' AND state IN ('claimed','running')
         AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
    `).run(now, now);
    return [...new Set(terminalParents)];
  }

  listWakingParentIds(limit = 100): string[] {
    return (this.db.prepare(`
      SELECT DISTINCT parent_session_id
        FROM agent_bridge_jobs
       WHERE parent_runtime='opencode' AND delivery_state='waking'
       ORDER BY parent_session_id LIMIT ?
    `).all(limit) as Array<{ parent_session_id: string }>).map((row) => row.parent_session_id);
  }

  claimCompletedForParent(
    parentSessionId: string,
    now = new Date().toISOString(),
  ): AgentBridgeJobRow[] {
    const unknownCutoff = new Date(Date.parse(now) - 15 * 60_000).toISOString();
    const ids = (this.db.prepare(`
      SELECT id FROM agent_bridge_jobs
       WHERE parent_runtime='opencode' AND parent_session_id=? AND delivery_state='pending'
         AND (state IN ('succeeded','failed','cancelled')
           OR (state='unknown' AND updated_at < ?))
       ORDER BY created_at, id
    `).all(parentSessionId, unknownCutoff) as Array<{ id: string }>).map((row) => row.id);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE agent_bridge_jobs SET delivery_state='waking' WHERE id IN (${placeholders}) AND delivery_state='pending'`).run(...ids);
    return this.db.prepare(`SELECT * FROM agent_bridge_jobs WHERE id IN (${placeholders}) AND delivery_state='waking' ORDER BY created_at, id`).all(...ids) as AgentBridgeJobRow[];
  }

  listWakingForParent(parentSessionId: string): AgentBridgeJobRow[] {
    return this.db.prepare(`SELECT * FROM agent_bridge_jobs WHERE parent_runtime='opencode' AND parent_session_id=? AND delivery_state='waking' ORDER BY created_at, id`)
      .all(parentSessionId) as AgentBridgeJobRow[];
  }

  markDelivered(ids: string[], now = new Date().toISOString()): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE agent_bridge_jobs SET delivery_state='delivered', delivered_at=COALESCE(delivered_at, ?) WHERE id IN (${placeholders}) AND delivery_state='waking'`)
      .run(now, ...ids);
  }

  releaseDeliveryClaims(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE agent_bridge_jobs SET delivery_state='pending' WHERE id IN (${placeholders}) AND delivery_state='waking'`)
      .run(...ids);
  }
}
