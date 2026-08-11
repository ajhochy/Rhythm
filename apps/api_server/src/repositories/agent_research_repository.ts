import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';

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
          WHERE status = ANY($3)`,
        [error, now, active],
      );
      return result.rowCount ?? 0;
    }
    return getDb()
      .prepare(
        `UPDATE agent_research_jobs
            SET status='error', error=?, updated_at=?
          WHERE status IN ('pending','gathering','reading','synthesizing')`,
      )
      .run(error, now).changes;
  }
}
