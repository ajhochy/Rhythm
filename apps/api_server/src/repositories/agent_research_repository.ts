import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors/app_error';

export interface ResearchJob {
  id: string;
  query: string;
  status: string;
  sourcesJson: string;
  report: string | null;
  error: string | null;
  agentSessionId: string | null;
  researchType: 'generic' | 'ai-trends' | 'theological';
  title: string;
  agentProfileId: string | null;
  origin: 'page' | 'specialist-run';
  vaultPath: string | null;
  canRetry: boolean;
  requestedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export type ResearchJobPatch = Partial<
  Pick<
    ResearchJob,
    | 'status'
    | 'sourcesJson'
    | 'report'
    | 'error'
    | 'agentSessionId'
    | 'vaultPath'
  >
>;

export interface ResearchProjectInput {
  name: string;
  question: string;
  goals: unknown[];
  domain: string | null;
  profileId: string | null;
  passConfig: unknown[];
  modelPolicy: Record<string, unknown>;
  criticConfig: Record<string, unknown>;
  synthesisConfig: Record<string, unknown>;
  scheduleRef: string | null;
  budget: Record<string, unknown>;
}

export interface ResearchProject extends ResearchProjectInput {
  id: string;
  ownerUserId: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ResearchProjectPatch = Partial<ResearchProjectInput>;

export interface ResearchProjectRun {
  id: string;
  projectId: string;
  ownerUserId: number;
  triggerType: 'manual' | 'scheduled' | 'follow-up';
  configSnapshot: Record<string, unknown>;
  status: string;
  progress: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  canonicalArtifact: Record<string, unknown> | null;
  artifacts: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  usage: { tokens: number; costUsd: number };
}

export interface ResearchProjectPass {
  id: string;
  projectId: string;
  projectRunId: string;
  passRole: string;
  passOrdinal: number;
  runConfig: Record<string, unknown>;
  status: string;
  agentSessionId: string | null;
  report: string | null;
  error: string | null;
}

function passRow(row: Record<string, unknown>): ResearchProjectPass {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    projectRunId: row.project_run_id as string,
    passRole: row.pass_role as string,
    passOrdinal: Number(row.pass_ordinal),
    runConfig: parsedJson(row.run_config_json, {}),
    status: row.status as string,
    agentSessionId: (row.agent_session_id as string | null) ?? null,
    report: (row.report as string | null) ?? null,
    error: (row.error as string | null) ?? null,
  };
}

function parsedJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function projectRow(row: Record<string, unknown>): ResearchProject {
  return {
    id: row.id as string,
    ownerUserId: Number(row.owner_user_id),
    name: row.name as string,
    question: row.question as string,
    goals: parsedJson(row.goals_json, []),
    domain: (row.domain as string | null) ?? null,
    profileId: (row.profile_id as string | null) ?? null,
    passConfig: parsedJson(row.pass_config_json, []),
    modelPolicy: parsedJson(row.model_policy_json, {}),
    criticConfig: parsedJson(row.critic_config_json, {}),
    synthesisConfig: parsedJson(row.synthesis_config_json, {}),
    scheduleRef: (row.schedule_ref as string | null) ?? null,
    budget: parsedJson(row.budget_json, {}),
    archivedAt: row.archived_at ? timestamp(row.archived_at) : null,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function baseRunRow(row: Record<string, unknown>): Omit<ResearchProjectRun, 'canonicalArtifact' | 'artifacts' | 'sources' | 'usage'> {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    ownerUserId: Number(row.owner_user_id),
    triggerType: row.trigger_type as ResearchProjectRun['triggerType'],
    configSnapshot: parsedJson(row.config_snapshot_json, {}),
    status: row.status as string,
    progress: parsedJson(row.progress_json, {}),
    diagnostics: parsedJson(row.diagnostics_json, {}),
    startedAt: row.started_at ? timestamp(row.started_at) : null,
    completedAt: row.completed_at ? timestamp(row.completed_at) : null,
    createdAt: timestamp(row.created_at),
  };
}

function timestamp(value: unknown): string {
  return typeof value === 'string' ? value : (value as Date).toISOString();
}

function rowToModel(row: Record<string, unknown>): ResearchJob {
  return {
    id: row.id as string,
    query: row.query as string,
    status: row.status as string,
    sourcesJson: (row.sources_json as string) ?? '[]',
    report: (row.report as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    agentSessionId: (row.agent_session_id as string | null) ?? null,
    researchType:
      (row.research_type as ResearchJob['researchType']) ?? 'generic',
    title: (row.title as string | null) ?? (row.query as string),
    agentProfileId: (row.agent_profile_id as string | null) ?? null,
    origin: (row.origin as ResearchJob['origin']) ?? 'page',
    vaultPath: (row.vault_path as string | null) ?? null,
    canRetry:
      row.status === 'error' &&
      (row.origin ?? 'page') === 'page' &&
      (row.research_type ?? 'generic') === 'generic',
    requestedByUserId: (row.requested_by_user_id as number | null) ?? null,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

/**
 * Persistence boundary for the existing research-job engine.
 *
 * An undefined owner is the trusted local-agent view and may see every row.
 * An authenticated owner may see its own rows plus ownerless legacy rows.
 */
export class AgentResearchRepository {
  private requireProjectsEnabled(): void {
    if (!env.researchProjectsEnabled) throw AppError.notFound('ResearchProject');
  }

  async createProject(
    ownerUserId: number,
    input: ResearchProjectInput,
  ): Promise<ResearchProject> {
    this.requireProjectsEnabled();
    const id = randomUUID();
    const now = new Date().toISOString();
    const values = [
      id, ownerUserId, input.name, input.question, JSON.stringify(input.goals),
      input.domain, input.profileId, JSON.stringify(input.passConfig),
      JSON.stringify(input.modelPolicy), JSON.stringify(input.criticConfig),
      JSON.stringify(input.synthesisConfig), input.scheduleRef,
      JSON.stringify(input.budget), now, now,
    ];
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO agent_research_projects
          (id, owner_user_id, name, question, goals_json, domain, profile_id,
           pass_config_json, model_policy_json, critic_config_json,
           synthesis_config_json, schedule_ref, budget_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        values,
      );
    } else {
      getDb().prepare(
        `INSERT INTO agent_research_projects
          (id, owner_user_id, name, question, goals_json, domain, profile_id,
           pass_config_json, model_policy_json, critic_config_json,
           synthesis_config_json, schedule_ref, budget_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(...values);
    }
    return (await this.getProject(id, ownerUserId))!;
  }

  async listProjects(ownerUserId: number, includeArchived = false): Promise<ResearchProject[]> {
    this.requireProjectsEnabled();
    const archived = includeArchived ? '' : ' AND archived_at IS NULL';
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `SELECT * FROM agent_research_projects WHERE owner_user_id = $1${archived} ORDER BY updated_at DESC`,
        [ownerUserId],
      );
      return result.rows.map(projectRow);
    }
    return (getDb().prepare(
      `SELECT * FROM agent_research_projects WHERE owner_user_id = ?${archived} ORDER BY updated_at DESC`,
    ).all(ownerUserId) as Record<string, unknown>[]).map(projectRow);
  }

  async getProject(id: string, ownerUserId: number): Promise<ResearchProject | null> {
    this.requireProjectsEnabled();
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        'SELECT * FROM agent_research_projects WHERE id = $1 AND owner_user_id = $2',
        [id, ownerUserId],
      );
      return result.rows[0] ? projectRow(result.rows[0]) : null;
    }
    const row = getDb().prepare(
      'SELECT * FROM agent_research_projects WHERE id = ? AND owner_user_id = ?',
    ).get(id, ownerUserId) as Record<string, unknown> | undefined;
    return row ? projectRow(row) : null;
  }

  async updateProject(
    id: string,
    ownerUserId: number,
    patch: ResearchProjectPatch,
  ): Promise<ResearchProject | null> {
    const current = await this.getProject(id, ownerUserId);
    if (!current) return null;
    const next = { ...current, ...patch };
    const now = new Date().toISOString();
    const values = [
      next.name, next.question, JSON.stringify(next.goals), next.domain,
      next.profileId, JSON.stringify(next.passConfig), JSON.stringify(next.modelPolicy),
      JSON.stringify(next.criticConfig), JSON.stringify(next.synthesisConfig),
      next.scheduleRef, JSON.stringify(next.budget), now, id, ownerUserId,
    ];
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE agent_research_projects SET name=$1, question=$2, goals_json=$3,
          domain=$4, profile_id=$5, pass_config_json=$6, model_policy_json=$7,
          critic_config_json=$8, synthesis_config_json=$9, schedule_ref=$10,
          budget_json=$11, updated_at=$12 WHERE id=$13 AND owner_user_id=$14`,
        values,
      );
    } else {
      getDb().prepare(
        `UPDATE agent_research_projects SET name=?, question=?, goals_json=?,
          domain=?, profile_id=?, pass_config_json=?, model_policy_json=?,
          critic_config_json=?, synthesis_config_json=?, schedule_ref=?,
          budget_json=?, updated_at=? WHERE id=? AND owner_user_id=?`,
      ).run(...values);
    }
    return this.getProject(id, ownerUserId);
  }

  async archiveProject(id: string, ownerUserId: number): Promise<ResearchProject | null> {
    this.requireProjectsEnabled();
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        'UPDATE agent_research_projects SET archived_at=$1, updated_at=$1 WHERE id=$2 AND owner_user_id=$3',
        [now, id, ownerUserId],
      );
    } else {
      getDb().prepare(
        'UPDATE agent_research_projects SET archived_at=?, updated_at=? WHERE id=? AND owner_user_id=?',
      ).run(now, now, id, ownerUserId);
    }
    return this.getProject(id, ownerUserId);
  }

  async createProjectRun(
    projectId: string,
    ownerUserId: number,
    triggerType: ResearchProjectRun['triggerType'],
  ): Promise<ResearchProjectRun | null> {
    this.requireProjectsEnabled();
    const project = await this.getProject(projectId, ownerUserId);
    if (!project || project.archivedAt) return null;
    const id = randomUUID();
    const now = new Date().toISOString();
    const snapshot = {
      projectId: project.id,
      name: project.name,
      question: project.question,
      goals: project.goals,
      domain: project.domain,
      profileId: project.profileId,
      passConfig: project.passConfig,
      modelPolicy: project.modelPolicy,
      criticConfig: project.criticConfig,
      synthesisConfig: project.synthesisConfig,
      scheduleRef: project.scheduleRef,
      budget: project.budget,
      triggerType,
      createdAt: now,
    };
    const values = [id, projectId, ownerUserId, triggerType, JSON.stringify(snapshot), now];
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO agent_research_project_runs
          (id, project_id, owner_user_id, trigger_type, config_snapshot_json, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        values,
      );
    } else {
      getDb().prepare(
        `INSERT INTO agent_research_project_runs
          (id, project_id, owner_user_id, trigger_type, config_snapshot_json, created_at)
         VALUES (?,?,?,?,?,?)`,
      ).run(...values);
    }
    return this.getProjectRun(id, ownerUserId);
  }

  async listProjectRuns(projectId: string, ownerUserId: number): Promise<ResearchProjectRun[]> {
    this.requireProjectsEnabled();
    const project = await this.getProject(projectId, ownerUserId);
    if (!project) return [];
    const rows = env.dbClient === 'postgres'
      ? (await getPostgresPool().query(
          'SELECT * FROM agent_research_project_runs WHERE project_id=$1 AND owner_user_id=$2 ORDER BY created_at DESC',
          [projectId, ownerUserId],
        )).rows
      : getDb().prepare(
          'SELECT * FROM agent_research_project_runs WHERE project_id=? AND owner_user_id=? ORDER BY created_at DESC',
        ).all(projectId, ownerUserId) as Record<string, unknown>[];
    return Promise.all(rows.map((row: Record<string, unknown>) => this.hydrateRun(row)));
  }

  async getProjectRun(id: string, ownerUserId: number): Promise<ResearchProjectRun | null> {
    this.requireProjectsEnabled();
    const row = env.dbClient === 'postgres'
      ? (await getPostgresPool().query(
          'SELECT * FROM agent_research_project_runs WHERE id=$1 AND owner_user_id=$2',
          [id, ownerUserId],
        )).rows[0]
      : getDb().prepare(
          'SELECT * FROM agent_research_project_runs WHERE id=? AND owner_user_id=?',
        ).get(id, ownerUserId) as Record<string, unknown> | undefined;
    return row ? this.hydrateRun(row) : null;
  }

  private async hydrateRun(row: Record<string, unknown>): Promise<ResearchProjectRun> {
    const base = baseRunRow(row);
    const artifacts = await this.listRunRows('agent_research_artifacts', base.id);
    const sources = await this.listRunRows('agent_research_curated_sources', base.id);
    const canonicalArtifact = artifacts.find((artifact) => artifact.artifact_role === 'canonical') ?? null;
    return {
      ...base,
      canonicalArtifact,
      artifacts,
      sources,
      usage: { tokens: 0, costUsd: 0 },
    };
  }

  private async listRunRows(table: 'agent_research_artifacts' | 'agent_research_curated_sources', runId: string): Promise<Record<string, unknown>[]> {
    if (env.dbClient === 'postgres') {
      return (await getPostgresPool().query(
        `SELECT * FROM ${table} WHERE project_run_id=$1 ORDER BY created_at`,
        [runId],
      )).rows;
    }
    return getDb().prepare(
      `SELECT * FROM ${table} WHERE project_run_id=? ORDER BY created_at`,
    ).all(runId) as Record<string, unknown>[];
  }

  async getArtifact(id: string, ownerUserId: number): Promise<Record<string, unknown> | null> {
    this.requireProjectsEnabled();
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `SELECT a.* FROM agent_research_artifacts a
          JOIN agent_research_projects p ON p.id=a.project_id
         WHERE a.id=$1 AND p.owner_user_id=$2`,
        [id, ownerUserId],
      );
      return result.rows[0] ?? null;
    }
    return (getDb().prepare(
      `SELECT a.* FROM agent_research_artifacts a
        JOIN agent_research_projects p ON p.id=a.project_id
       WHERE a.id=? AND p.owner_user_id=?`,
    ).get(id, ownerUserId) as Record<string, unknown> | undefined) ?? null;
  }

  async createProjectPassJob(input: {
    projectId: string;
    projectRunId: string;
    ownerUserId: number;
    question: string;
    role: string;
    ordinal: number;
    profileId: string;
    config: Record<string, unknown>;
  }): Promise<ResearchProjectPass> {
    this.requireProjectsEnabled();
    const run = await this.getProjectRun(input.projectRunId, input.ownerUserId);
    if (!run || run.projectId !== input.projectId) throw AppError.notFound('ResearchProjectRun');
    const id = randomUUID();
    const now = new Date().toISOString();
    const values = [
      id, input.question, 'pending', '[]', input.role, input.profileId,
      input.ownerUserId, input.projectId, input.projectRunId, input.role,
      input.ordinal, JSON.stringify(input.config), now, now,
    ];
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO agent_research_jobs
          (id, query, status, sources_json, title, agent_profile_id,
           requested_by_user_id, project_id, project_run_id, pass_role,
           pass_ordinal, run_config_json, research_type, origin, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'generic','project-pass',$13,$14)`,
        values,
      );
    } else {
      getDb().prepare(
        `INSERT INTO agent_research_jobs
          (id, query, status, sources_json, title, agent_profile_id,
           requested_by_user_id, project_id, project_run_id, pass_role,
           pass_ordinal, run_config_json, research_type, origin, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'generic','project-pass',?,?)`,
      ).run(...values);
    }
    return (await this.getProjectPassJob(id, input.ownerUserId))!;
  }

  async getProjectPassJob(id: string, ownerUserId: number): Promise<ResearchProjectPass | null> {
    this.requireProjectsEnabled();
    const row = env.dbClient === 'postgres'
      ? (await getPostgresPool().query(
          `SELECT j.* FROM agent_research_jobs j
            JOIN agent_research_project_runs r ON r.id=j.project_run_id
           WHERE j.id=$1 AND r.owner_user_id=$2`,
          [id, ownerUserId],
        )).rows[0]
      : getDb().prepare(
          `SELECT j.* FROM agent_research_jobs j
            JOIN agent_research_project_runs r ON r.id=j.project_run_id
           WHERE j.id=? AND r.owner_user_id=?`,
        ).get(id, ownerUserId) as Record<string, unknown> | undefined;
    return row ? passRow(row) : null;
  }

  async listProjectPassJobs(runId: string, ownerUserId: number): Promise<ResearchProjectPass[]> {
    this.requireProjectsEnabled();
    const rows = env.dbClient === 'postgres'
      ? (await getPostgresPool().query(
          `SELECT j.* FROM agent_research_jobs j
            JOIN agent_research_project_runs r ON r.id=j.project_run_id
           WHERE j.project_run_id=$1 AND r.owner_user_id=$2 ORDER BY j.pass_ordinal`,
          [runId, ownerUserId],
        )).rows
      : getDb().prepare(
          `SELECT j.* FROM agent_research_jobs j
            JOIN agent_research_project_runs r ON r.id=j.project_run_id
           WHERE j.project_run_id=? AND r.owner_user_id=? ORDER BY j.pass_ordinal`,
        ).all(runId, ownerUserId) as Record<string, unknown>[];
    return rows.map(passRow);
  }

  async updateProjectPassJob(
    id: string,
    ownerUserId: number,
    patch: { status?: string; agentSessionId?: string | null; report?: string | null; error?: string | null },
  ): Promise<ResearchProjectPass | null> {
    const current = await this.getProjectPassJob(id, ownerUserId);
    if (!current) return null;
    const next = { ...current, ...patch };
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE agent_research_jobs SET status=$1, agent_session_id=$2, report=$3,
          error=$4, updated_at=$5 WHERE id=$6`,
        [next.status, next.agentSessionId, next.report, next.error, now, id],
      );
    } else {
      getDb().prepare(
        `UPDATE agent_research_jobs SET status=?, agent_session_id=?, report=?,
          error=?, updated_at=? WHERE id=?`,
      ).run(next.status, next.agentSessionId, next.report, next.error, now, id);
    }
    return this.getProjectPassJob(id, ownerUserId);
  }

  async updateProjectRunState(
    id: string,
    ownerUserId: number,
    patch: { status: string; progress?: Record<string, unknown>; diagnostics?: Record<string, unknown>; startedAt?: string | null; completedAt?: string | null },
  ): Promise<ResearchProjectRun | null> {
    const current = await this.getProjectRun(id, ownerUserId);
    if (!current) return null;
    const next = { ...current, ...patch };
    const values = [
      next.status, JSON.stringify(next.progress), JSON.stringify(next.diagnostics),
      next.startedAt, next.completedAt, id, ownerUserId,
    ];
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE agent_research_project_runs SET status=$1, progress_json=$2,
          diagnostics_json=$3, started_at=$4, completed_at=$5
         WHERE id=$6 AND owner_user_id=$7`,
        values,
      );
    } else {
      getDb().prepare(
        `UPDATE agent_research_project_runs SET status=?, progress_json=?,
          diagnostics_json=?, started_at=?, completed_at=?
         WHERE id=? AND owner_user_id=?`,
      ).run(...values);
    }
    return this.getProjectRun(id, ownerUserId);
  }

  async markDownstreamStagesStale(runId: string, ownerUserId: number): Promise<number> {
    this.requireProjectsEnabled();
    if (!(await this.getProjectRun(runId, ownerUserId))) return 0;
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `UPDATE agent_research_jobs SET status='stale', updated_at=$1
          WHERE project_run_id=$2 AND pass_role IN ('critic','synthesis')`,
        [new Date().toISOString(), runId],
      );
      return result.rowCount ?? 0;
    }
    return getDb().prepare(
      `UPDATE agent_research_jobs SET status='stale', updated_at=?
        WHERE project_run_id=? AND pass_role IN ('critic','synthesis')`,
    ).run(new Date().toISOString(), runId).changes;
  }

  async listInterruptedProjectRuns(ownerUserId: number): Promise<ResearchProjectRun[]> {
    this.requireProjectsEnabled();
    const rows = env.dbClient === 'postgres'
      ? (await getPostgresPool().query(
          `SELECT * FROM agent_research_project_runs WHERE owner_user_id=$1 AND status='running'`,
          [ownerUserId],
        )).rows
      : getDb().prepare(
          `SELECT * FROM agent_research_project_runs WHERE owner_user_id=? AND status='running'`,
        ).all(ownerUserId) as Record<string, unknown>[];
    return Promise.all(rows.map((row: Record<string, unknown>) => this.hydrateRun(row)));
  }

  async listInterruptedProjectRunOwners(): Promise<number[]> {
    this.requireProjectsEnabled();
    const rows = env.dbClient === 'postgres'
      ? (await getPostgresPool().query(
          `SELECT DISTINCT owner_user_id FROM agent_research_project_runs WHERE status='running'`,
        )).rows
      : getDb().prepare(
          `SELECT DISTINCT owner_user_id FROM agent_research_project_runs WHERE status='running'`,
        ).all() as Array<{ owner_user_id: number }>;
    return rows.map((row: { owner_user_id: number }) => Number(row.owner_user_id));
  }

  async insert(
    job: Omit<ResearchJob, 'createdAt' | 'updatedAt'>,
  ): Promise<ResearchJob> {
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `INSERT INTO agent_research_jobs
           (id, query, status, sources_json, report, error, agent_session_id,
            research_type, title, agent_profile_id, origin, vault_path,
            requested_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          job.id,
          job.query,
          job.status,
          job.sourcesJson,
          job.report,
          job.error,
          job.agentSessionId,
          job.researchType,
          job.title,
          job.agentProfileId,
          job.origin,
          job.vaultPath,
          job.requestedByUserId,
          now,
          now,
        ],
      );
      return rowToModel(result.rows[0]);
    }

    getDb()
      .prepare(
        `INSERT INTO agent_research_jobs
           (id, query, status, sources_json, report, error, agent_session_id,
            research_type, title, agent_profile_id, origin, vault_path,
            requested_by_user_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        job.id,
        job.query,
        job.status,
        job.sourcesJson,
        job.report,
        job.error,
        job.agentSessionId,
        job.researchType,
        job.title,
        job.agentProfileId,
        job.origin,
        job.vaultPath,
        job.requestedByUserId,
        now,
        now,
      );
    return { ...job, createdAt: now, updatedAt: now };
  }

  async findById(id: string): Promise<ResearchJob | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        'SELECT * FROM agent_research_jobs WHERE id = $1',
        [id],
      );
      return result.rows.length > 0 ? rowToModel(result.rows[0]) : null;
    }
    const row = getDb()
      .prepare('SELECT * FROM agent_research_jobs WHERE id = ?')
      .get(id);
    return row ? rowToModel(row as Record<string, unknown>) : null;
  }

  async findVisibleById(
    id: string,
    ownerUserId: number | undefined,
  ): Promise<ResearchJob | null> {
    if (ownerUserId === undefined) return this.findById(id);
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `SELECT * FROM agent_research_jobs
          WHERE id = $1
            AND (requested_by_user_id IS NULL OR requested_by_user_id = $2)`,
        [id, ownerUserId],
      );
      return result.rows.length > 0 ? rowToModel(result.rows[0]) : null;
    }
    const row = getDb()
      .prepare(
        `SELECT * FROM agent_research_jobs
          WHERE id = ?
            AND (requested_by_user_id IS NULL OR requested_by_user_id = ?)`,
      )
      .get(id, ownerUserId);
    return row ? rowToModel(row as Record<string, unknown>) : null;
  }

  async listVisible(ownerUserId: number | undefined): Promise<ResearchJob[]> {
    if (env.dbClient === 'postgres') {
      const result =
        ownerUserId === undefined
          ? await getPostgresPool().query(
              'SELECT * FROM agent_research_jobs ORDER BY created_at DESC LIMIT 50',
            )
          : await getPostgresPool().query(
              `SELECT * FROM agent_research_jobs
                WHERE requested_by_user_id IS NULL OR requested_by_user_id = $1
                ORDER BY created_at DESC LIMIT 50`,
              [ownerUserId],
            );
      return result.rows.map(rowToModel);
    }
    const rows =
      ownerUserId === undefined
        ? getDb()
            .prepare(
              'SELECT * FROM agent_research_jobs ORDER BY created_at DESC LIMIT 50',
            )
            .all()
        : getDb()
            .prepare(
              `SELECT * FROM agent_research_jobs
                WHERE requested_by_user_id IS NULL OR requested_by_user_id = ?
                ORDER BY created_at DESC LIMIT 50`,
            )
            .all(ownerUserId);
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  async update(id: string, patch: ResearchJobPatch): Promise<ResearchJob | null> {
    const current = await this.findById(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE agent_research_jobs
            SET status=$1, sources_json=$2, report=$3, error=$4,
                agent_session_id=$5, vault_path=$6, updated_at=$7
          WHERE id=$8`,
        [
          next.status,
          next.sourcesJson,
          next.report,
          next.error,
          next.agentSessionId,
          next.vaultPath,
          now,
          id,
        ],
      );
    } else {
      getDb()
        .prepare(
          `UPDATE agent_research_jobs
              SET status=?, sources_json=?, report=?, error=?,
                  agent_session_id=?, vault_path=?, updated_at=?
            WHERE id=?`,
        )
        .run(
          next.status,
          next.sourcesJson,
          next.report,
          next.error,
          next.agentSessionId,
          next.vaultPath,
          now,
          id,
        );
    }
    return this.findById(id);
  }

  async remove(job: ResearchJob): Promise<void> {
    const triggerPattern = `%Job ID: ${job.id}%`;
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `DELETE FROM pending_claude_triggers
          WHERE task_id IS NULL AND prompt LIKE $1`,
        [triggerPattern],
      );
      await getPostgresPool().query(
        'DELETE FROM agent_research_jobs WHERE id = $1',
        [job.id],
      );
      return;
    }
    getDb().transaction(() => {
      getDb()
        .prepare(
          `DELETE FROM pending_claude_triggers
            WHERE task_id IS NULL AND prompt LIKE ?`,
        )
        .run(triggerPattern);
      getDb()
        .prepare('DELETE FROM agent_research_jobs WHERE id = ?')
        .run(job.id);
    })();
  }

  async recoverActive(error: string): Promise<number> {
    const active = ['pending', 'gathering', 'reading', 'synthesizing'];
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `UPDATE agent_research_jobs
            SET status='error', error=$1, updated_at=$2
          WHERE status = ANY($3) AND project_run_id IS NULL`,
        [error, now, active],
      );
      return result.rowCount ?? 0;
    }
    return getDb()
      .prepare(
        `UPDATE agent_research_jobs
            SET status='error', error=?, updated_at=?
          WHERE status IN ('pending','gathering','reading','synthesizing')
            AND project_run_id IS NULL`,
      )
      .run(error, now).changes;
  }
}
