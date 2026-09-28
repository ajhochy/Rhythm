import type Database from 'better-sqlite3';

import { getDb } from '../database/db';

export interface AgentBridgeProjectionInsert {
  projectionId: string;
  localUserId: number;
  hermesProfile: 'default';
  agentId: string;
  revision: number;
  launchKind: 'interactive' | 'delegated';
  sessionKey: string;
  jobId: string | null;
  depth: number;
  chainId: string;
  cwd: string | null;
  snapshotJson: string;
  issuedGeneration: string;
  issuedAt: string;
}

export interface AgentBridgeProjectionRow {
  projection_id: string;
  local_user_id: number;
  hermes_profile: 'default';
  agent_id: string;
  revision: number;
  launch_kind: 'interactive' | 'delegated';
  session_key: string;
  job_id: string | null;
  depth: number;
  chain_id: string;
  cwd: string | null;
  snapshot_json: string;
  issued_generation: string;
  issued_at: string;
}

export interface DelegatedProjectionJobRow {
  id: string;
  local_user_id: number;
  hermes_profile: 'default';
  target_agent_id: string;
  target_revision: number;
  child_runtime_instance: string | null;
  depth: number;
  chain_id: string;
  cwd: string | null;
  state: string;
  lease_token_sha256: string | null;
}

export class AgentBridgeProjectionsRepository {
  constructor(private readonly db: Database.Database = getDb()) {}

  insert(input: AgentBridgeProjectionInsert): void {
    this.db.prepare(`
      INSERT INTO agent_bridge_projections (
        projection_id, local_user_id, hermes_profile, agent_id, revision,
        launch_kind, session_key, job_id, depth, chain_id, cwd,
        snapshot_json, issued_generation, issued_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.projectionId,
      input.localUserId,
      input.hermesProfile,
      input.agentId,
      input.revision,
      input.launchKind,
      input.sessionKey,
      input.jobId,
      input.depth,
      input.chainId,
      input.cwd,
      input.snapshotJson,
      input.issuedGeneration,
      input.issuedAt,
    );
  }

  getByProjectionAndSession(
    projectionId: string,
    sessionKey: string,
  ): AgentBridgeProjectionRow | null {
    return this.db.prepare(`
      SELECT *
      FROM agent_bridge_projections
      WHERE projection_id = ? AND session_key = ?
    `).get(projectionId, sessionKey) as AgentBridgeProjectionRow | undefined ?? null;
  }

  getForGrant(
    projectionId: string,
    sessionKey: string,
    localUserId: number,
    hermesProfile: 'default',
  ): AgentBridgeProjectionRow | null {
    return this.db.prepare(`
      SELECT *
      FROM agent_bridge_projections
      WHERE projection_id = ?
        AND session_key = ?
        AND local_user_id = ?
        AND hermes_profile = ?
    `).get(
      projectionId,
      sessionKey,
      localUserId,
      hermesProfile,
    ) as AgentBridgeProjectionRow | undefined ?? null;
  }

  getForProfile(
    projectionId: string,
    sessionKey: string,
    hermesProfile: 'default',
  ): AgentBridgeProjectionRow | null {
    return this.db.prepare(`
      SELECT *
      FROM agent_bridge_projections
      WHERE projection_id = ?
        AND session_key = ?
        AND hermes_profile = ?
    `).get(
      projectionId,
      sessionKey,
      hermesProfile,
    ) as AgentBridgeProjectionRow | undefined ?? null;
  }

  getByJobId(jobId: string): AgentBridgeProjectionRow | null {
    return this.db.prepare(`
      SELECT * FROM agent_bridge_projections WHERE job_id = ?
    `).get(jobId) as AgentBridgeProjectionRow | undefined ?? null;
  }

  getDelegatedJob(jobId: string): DelegatedProjectionJobRow | null {
    return this.db.prepare(`
      SELECT id, local_user_id, hermes_profile, target_agent_id, target_revision,
             child_runtime_instance, depth, chain_id, cwd, state, lease_token_sha256
      FROM agent_bridge_jobs
      WHERE id = ? AND direction = 'rhythm_to_hermes' AND target_runtime = 'hermes'
    `).get(jobId) as DelegatedProjectionJobRow | undefined ?? null;
  }

  failDelegatedJobForRevision(jobId: string, now: string): void {
    this.db.prepare(`
      UPDATE agent_bridge_jobs
      SET state = 'failed', state_reason = 'target_revision_changed',
          updated_at = ?, terminal_at = ?
      WHERE id = ? AND state IN ('claimed', 'running')
    `).run(now, now, jobId);
  }
}
