import type Database from 'better-sqlite3';

import type { RuntimeReport } from './bridge_grants';
import type {
  SharedAgentChanges,
  SharedAgentReason,
  SharedAgentSnapshotV2,
  SharedAgentV1,
} from './contract';
import { installNativeWorkstreamBridgeSchema } from './native_workstream_bridge_schema';

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
  db.exec('SAVEPOINT install_agent_bridge_schema');
  try {
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
    `);
    installNativeWorkstreamBridgeSchema(db);
    db.exec('RELEASE SAVEPOINT install_agent_bridge_schema');
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT install_agent_bridge_schema');
    db.exec('RELEASE SAVEPOINT install_agent_bridge_schema');
    throw error;
  }
}
