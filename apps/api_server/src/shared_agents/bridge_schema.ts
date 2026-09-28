import type Database from 'better-sqlite3';

import type { RuntimeReport } from './bridge_grants';
import type {
  SharedAgentChanges,
  SharedAgentReason,
  SharedAgentSnapshotV2,
  SharedAgentV1,
} from './contract';

export interface BridgeErrorResponse {
  error: {
    code: string;
    /** Omitted only for errors whose frozen contract explicitly permits the code alone. */
    message?: string;
    [key: string]: unknown;
  };
}

export interface RegisterGrantRequest extends Record<string, unknown> {
  grantId?: unknown;
  capabilitySha256?: unknown;
  sessionToken?: unknown;
  runtimeGeneration?: unknown;
  serverOrigin?: unknown;
  authGeneration?: unknown;
  scopes?: unknown;
  memoryVaultId?: unknown;
}

export interface RegisterGrantResponse {
  grantId: string;
  replacedGrantId: string | null;
}

export interface RevokeScopesRequest extends Record<string, unknown> {
  scopes?: unknown;
}

export interface RevokeScopesResponse {
  scopes: string[];
}

export type RuntimeReportRequest = RuntimeReport;

export interface ProjectionIssueRequest extends Record<string, unknown> {
  acceptVersions?: unknown;
  agentId?: unknown;
  cwd?: unknown;
  launchKind?: unknown;
  expectedRevision?: unknown;
  leaseToken?: unknown;
  sessionKey?: unknown;
  jobId?: unknown;
}

export interface ProjectionIssueResponse {
  schema: 'rhythm.hermes-projection.v1';
  projectionId: string;
  agentId: string;
  revision: number;
  ownerId: string;
  snapshot: SharedAgentSnapshotV2;
  reasons: SharedAgentReason[];
}

export interface ProjectionCheckRequest extends Record<string, unknown> {
  sessionKey?: unknown;
  includeSnapshot?: unknown;
}

export interface ProjectionCheckResponse {
  ok: true;
  ownerId: string;
  snapshot?: SharedAgentSnapshotV2;
}

export interface AgentPatchRequest extends Record<string, unknown> {
  expectedRevision?: unknown;
  changes?: unknown;
}

export type AgentPatchResponse =
  | { status: 'applied'; agent: SharedAgentV1 }
  | { status: 'confirmation_required'; confirmationId: string; expiresAt: string };

export interface AgentPatchStatusRequest extends Record<string, unknown> {
  confirmationId?: unknown;
}

export interface AgentPatchStatusResponse {
  status: 'pending' | 'applied' | 'rejected' | 'expired' | 'superseded' | 'conflict';
  agent?: SharedAgentV1;
  currentRevision?: number;
}

export interface ConfirmationNextRequest extends Record<string, unknown> {
  waitMs?: unknown;
}

export interface AgentPatchConfirmationView {
  confirmationId: string;
  agentId: string;
  agentLabel: string;
  expectedRevision: number;
  currentRevision: number;
  fields: Array<{ name: string; before: string; after: string }>;
  changesSha256: string;
}

export interface ConfirmationDecisionRequest extends Record<string, unknown> {
  changesSha256?: unknown;
  approve?: unknown;
}

export interface ConfirmationDecisionResponse {
  status: 'applied' | 'rejected' | 'conflict' | 'expired';
}

export interface ValidatedAgentPatch {
  expectedRevision: number;
  changes: SharedAgentChanges;
}

/** SQLite-only bridge ledger. Hosted Postgres never calls this installer. */
export function installAgentBridgeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_bridge_projections (
      projection_id TEXT PRIMARY KEY, local_user_id INTEGER NOT NULL, hermes_profile TEXT NOT NULL,
      agent_id TEXT NOT NULL, revision INTEGER NOT NULL,
      launch_kind TEXT NOT NULL CHECK (launch_kind IN ('interactive','delegated')),
      session_key TEXT NOT NULL, job_id TEXT NULL UNIQUE,
      depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 2), chain_id TEXT NOT NULL, cwd TEXT NULL,
      snapshot_json TEXT NOT NULL, issued_generation TEXT NOT NULL, issued_at TEXT NOT NULL,
      UNIQUE (hermes_profile, session_key)
    );
    CREATE TABLE IF NOT EXISTS agent_bridge_jobs (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL CHECK (direction IN ('rhythm_to_hermes','hermes_to_rhythm')),
      idempotency_key TEXT NOT NULL, request_sha256 TEXT NOT NULL,
      local_user_id INTEGER NOT NULL, hermes_profile TEXT NOT NULL,
      parent_runtime TEXT NOT NULL CHECK (parent_runtime IN ('opencode','hermes')),
      parent_runtime_instance TEXT NOT NULL, parent_session_id TEXT NOT NULL,
      parent_agent_id TEXT NOT NULL, parent_projection_id TEXT NULL,
      target_agent_id TEXT NOT NULL, target_revision INTEGER NOT NULL,
      target_runtime TEXT NOT NULL CHECK (target_runtime IN ('opencode','hermes')),
      child_runtime_instance TEXT NULL, child_session_id TEXT NULL,
      depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 2), chain_id TEXT NOT NULL,
      prompt TEXT NOT NULL, context TEXT NULL, cwd TEXT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued','claimed','running','succeeded','failed','cancelled','unknown')),
      state_reason TEXT NULL, cancel_requested_at TEXT NULL,
      result_text TEXT NULL, result_truncated INTEGER NOT NULL DEFAULT 0, progress_json TEXT NULL,
      lease_token_sha256 TEXT NULL, lease_expires_at TEXT NULL,
      delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending','waking','delivered')),
      delivered_at TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_at TEXT NULL,
      UNIQUE (local_user_id, parent_runtime, parent_session_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_bridge_jobs_claim ON agent_bridge_jobs(local_user_id, hermes_profile, state, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_bridge_jobs_parent ON agent_bridge_jobs(parent_runtime, parent_session_id, delivery_state);
    CREATE TRIGGER IF NOT EXISTS agent_bridge_jobs_terminal_immutable BEFORE UPDATE OF state ON agent_bridge_jobs
      WHEN OLD.state IN ('succeeded','failed','cancelled') AND NEW.state <> OLD.state
      BEGIN SELECT RAISE(ABORT, 'agent_bridge_job_terminal'); END;
    CREATE TRIGGER IF NOT EXISTS agent_bridge_jobs_unknown_exit BEFORE UPDATE OF state ON agent_bridge_jobs
      WHEN OLD.state = 'unknown' AND NEW.state NOT IN ('unknown','succeeded','failed')
      BEGIN SELECT RAISE(ABORT, 'agent_bridge_job_unknown'); END;
  `);
}
