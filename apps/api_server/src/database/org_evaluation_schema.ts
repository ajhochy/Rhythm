/** Add these tables to both bootstrap paths before the repository is used. */
export const SQLITE_ORG_EVALUATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS org_evaluation_jobs (
  id TEXT PRIMARY KEY, budget_root_id TEXT REFERENCES org_evaluation_jobs(id),
  source_audit_run_id TEXT, owner_user_id INTEGER,
  status TEXT NOT NULL, max_tokens INTEGER NOT NULL, validation_reserve_tokens INTEGER NOT NULL,
  original_hash TEXT NOT NULL, target_ref TEXT NOT NULL, target_revision TEXT NOT NULL,
  input_json TEXT NOT NULL, final_candidate_id TEXT, qualified_proposal_id TEXT,
  failure_reason TEXT, revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS org_evaluation_candidates (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES org_evaluation_jobs(id),
  role TEXT NOT NULL, ordinal INTEGER NOT NULL, kind TEXT NOT NULL,
  target_ref TEXT NOT NULL, config_hash TEXT NOT NULL,
  effective_config_json TEXT NOT NULL, change_json TEXT NOT NULL,
  parent_candidate_ids_json TEXT NOT NULL, composition_parts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(job_id, role, ordinal)
);
CREATE TABLE IF NOT EXISTS org_evaluation_results (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES org_evaluation_jobs(id),
  candidate_id TEXT NOT NULL REFERENCES org_evaluation_candidates(id),
  phase TEXT NOT NULL, task_key TEXT NOT NULL, receipt_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL, status TEXT NOT NULL, score REAL,
  token_usage_json TEXT, failure_reason TEXT, created_at TEXT NOT NULL,
  UNIQUE(job_id, candidate_id, phase, task_key)
);
CREATE TABLE IF NOT EXISTS org_evaluation_token_reservations (
  job_id TEXT NOT NULL REFERENCES org_evaluation_jobs(id), reservation_key TEXT NOT NULL,
  stage TEXT NOT NULL, max_tokens INTEGER NOT NULL, status TEXT NOT NULL,
  actual_tokens INTEGER, created_at TEXT NOT NULL, settled_at TEXT,
  PRIMARY KEY(job_id, reservation_key)
);
CREATE INDEX IF NOT EXISTS idx_org_evaluation_jobs_owner_created
  ON org_evaluation_jobs(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_org_evaluation_jobs_budget_root
  ON org_evaluation_jobs(budget_root_id);
CREATE INDEX IF NOT EXISTS idx_org_evaluation_candidates_job
  ON org_evaluation_candidates(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_org_evaluation_results_job
  ON org_evaluation_results(job_id, created_at);
`;

export const POSTGRES_ORG_EVALUATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS org_evaluation_jobs (
  id TEXT PRIMARY KEY, budget_root_id TEXT REFERENCES org_evaluation_jobs(id),
  source_audit_run_id TEXT, owner_user_id INTEGER,
  status TEXT NOT NULL, max_tokens BIGINT NOT NULL, validation_reserve_tokens BIGINT NOT NULL,
  original_hash TEXT NOT NULL, target_ref TEXT NOT NULL, target_revision TEXT NOT NULL,
  input_json TEXT NOT NULL, final_candidate_id TEXT, qualified_proposal_id TEXT,
  failure_reason TEXT, revision BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS org_evaluation_candidates (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES org_evaluation_jobs(id),
  role TEXT NOT NULL, ordinal INTEGER NOT NULL, kind TEXT NOT NULL,
  target_ref TEXT NOT NULL, config_hash TEXT NOT NULL,
  effective_config_json TEXT NOT NULL, change_json TEXT NOT NULL,
  parent_candidate_ids_json TEXT NOT NULL, composition_parts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(job_id, role, ordinal)
);
CREATE TABLE IF NOT EXISTS org_evaluation_results (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES org_evaluation_jobs(id),
  candidate_id TEXT NOT NULL REFERENCES org_evaluation_candidates(id),
  phase TEXT NOT NULL, task_key TEXT NOT NULL, receipt_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL, status TEXT NOT NULL, score DOUBLE PRECISION,
  token_usage_json TEXT, failure_reason TEXT, created_at TEXT NOT NULL,
  UNIQUE(job_id, candidate_id, phase, task_key)
);
CREATE TABLE IF NOT EXISTS org_evaluation_token_reservations (
  job_id TEXT NOT NULL REFERENCES org_evaluation_jobs(id), reservation_key TEXT NOT NULL,
  stage TEXT NOT NULL, max_tokens BIGINT NOT NULL, status TEXT NOT NULL,
  actual_tokens BIGINT, created_at TEXT NOT NULL, settled_at TEXT,
  PRIMARY KEY(job_id, reservation_key)
);
CREATE INDEX IF NOT EXISTS idx_org_evaluation_jobs_owner_created
  ON org_evaluation_jobs(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_org_evaluation_jobs_budget_root
  ON org_evaluation_jobs(budget_root_id);
CREATE INDEX IF NOT EXISTS idx_org_evaluation_candidates_job
  ON org_evaluation_candidates(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_org_evaluation_results_job
  ON org_evaluation_results(job_id, created_at);
`;
