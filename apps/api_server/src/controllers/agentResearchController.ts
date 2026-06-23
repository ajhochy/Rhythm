/**
 * Deep Research Controller
 *
 * Manages agent_research_jobs. A research job is a multi-step pipeline:
 *   1. 'pending' → agent reads the query, plans sources
 *   2. 'gathering' → agent fetches each source URL
 *   3. 'reading' → agent reads + summarises each source
 *   4. 'synthesizing' → agent writes the final report
 *   5. 'done' → report stored in agent_research_jobs.report
 *
 * The pipeline runs via the normal agent trigger path: creating a research
 * job inserts a pending_claude_triggers row with a structured prompt that
 * instructs the agent to execute the pipeline and call rhythm_update_research_job
 * at each step.
 */

import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors/app_error';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';

interface ResearchJob {
  id: string;
  query: string;
  status: string;
  sourcesJson: string;
  report: string | null;
  error: string | null;
  requestedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

function rowToModel(row: Record<string, unknown>): ResearchJob {
  return {
    id: row.id as string,
    query: row.query as string,
    status: row.status as string,
    sourcesJson: (row.sources_json as string) ?? '[]',
    report: (row.report as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    requestedByUserId: (row.requested_by_user_id as number | null) ?? null,
    createdAt:
      typeof row.created_at === 'string' ? row.created_at : (row.created_at as Date).toISOString(),
    updatedAt:
      typeof row.updated_at === 'string' ? row.updated_at : (row.updated_at as Date).toISOString(),
  };
}

async function insertJob(job: Omit<ResearchJob, 'createdAt' | 'updatedAt'>): Promise<ResearchJob> {
  const now = new Date().toISOString();
  if (env.dbClient === 'postgres') {
    const r = await getPostgresPool().query(
      `INSERT INTO agent_research_jobs (id, query, status, sources_json, report, error, requested_by_user_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [job.id, job.query, job.status, job.sourcesJson, job.report, job.error, job.requestedByUserId, now, now],
    );
    return rowToModel(r.rows[0]);
  }
  getDb().prepare(
    `INSERT INTO agent_research_jobs (id, query, status, sources_json, report, error, requested_by_user_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(job.id, job.query, job.status, job.sourcesJson, job.report, job.error, job.requestedByUserId, now, now);
  return { ...job, createdAt: now, updatedAt: now };
}

async function findJobById(id: string): Promise<ResearchJob | null> {
  if (env.dbClient === 'postgres') {
    const r = await getPostgresPool().query(`SELECT * FROM agent_research_jobs WHERE id = $1`, [id]);
    return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
  }
  const row = getDb().prepare(`SELECT * FROM agent_research_jobs WHERE id = ?`).get(id);
  return row ? rowToModel(row as Record<string, unknown>) : null;
}

export class AgentResearchController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.auth?.user.id;
      if (env.dbClient === 'postgres') {
        const r = await getPostgresPool().query(
          `SELECT * FROM agent_research_jobs WHERE requested_by_user_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [userId],
        );
        res.json(r.rows.map(rowToModel));
        return;
      }
      const rows = getDb().prepare(
        `SELECT * FROM agent_research_jobs WHERE requested_by_user_id = ? ORDER BY created_at DESC LIMIT 50`,
      ).all(userId ?? null);
      res.json((rows as Record<string, unknown>[]).map(rowToModel));
    } catch (err) { next(err); }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const job = await findJobById(req.params.id);
      if (!job) throw AppError.notFound('ResearchJob');
      res.json(job);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { query } = req.body as Record<string, unknown>;
      if (!query || typeof query !== 'string') throw AppError.badRequest('query is required');

      const id = randomUUID();
      const userId = req.auth?.user.id ?? null;

      const job = await insertJob({
        id, query, status: 'pending', sourcesJson: '[]',
        report: null, error: null, requestedByUserId: userId,
      });

      // Insert a pending trigger so the agent starts the research pipeline
      const prompt = `You are running a Deep Research pipeline for query: "${query}"

Job ID: ${id}

Steps:
1. Plan 3-5 authoritative sources to read for this query.
2. For each source, fetch the URL and extract the key information.
3. Synthesize all sources into a comprehensive, cited report.
4. Call rhythm_update_research_job to update status at each step:
   - After planning: status='gathering', sources=[url1, url2, ...]
   - After reading: status='reading'
   - After synthesis: status='done', report=<final markdown report>
   If anything fails: status='error', error=<message>

Be thorough. Cite sources. Write in markdown. Keep the report under 2000 words.`;

      const now = new Date().toISOString();
      if (env.dbClient === 'postgres') {
        await getPostgresPool().query(
          `INSERT INTO pending_claude_triggers
             (task_id, triggered_by_user_id, prompt, created_at)
           VALUES (NULL, $1, $2, $3)`,
          [userId, prompt, now],
        );
      } else {
        getDb().prepare(
          `INSERT INTO pending_claude_triggers
             (task_id, triggered_by_user_id, prompt, created_at)
           VALUES (NULL, ?, ?, ?)`,
        ).run(userId, prompt, now);
      }

      logger.info(`[Research] Created job ${id} for query: "${query}"`);
      res.status(201).json(job);
    } catch (err) { next(err); }
  }

  /** Called by the agent via MCP to update job status. */
  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status, sources, report, error } = req.body as Record<string, unknown>;

      const job = await findJobById(id);
      if (!job) throw AppError.notFound('ResearchJob');

      const now = new Date().toISOString();
      const validStatuses = ['pending', 'gathering', 'reading', 'synthesizing', 'done', 'error'];
      if (status && !validStatuses.includes(status as string)) {
        throw AppError.badRequest(`status must be one of: ${validStatuses.join(', ')}`);
      }

      const newStatus = typeof status === 'string' ? status : job.status;
      const newSources = Array.isArray(sources) ? JSON.stringify(sources) : job.sourcesJson;
      const newReport = typeof report === 'string' ? report : job.report;
      const newError = typeof error === 'string' ? error : job.error;

      if (env.dbClient === 'postgres') {
        await getPostgresPool().query(
          `UPDATE agent_research_jobs
           SET status=$1, sources_json=$2, report=$3, error=$4, updated_at=$5
           WHERE id=$6`,
          [newStatus, newSources, newReport, newError, now, id],
        );
      } else {
        getDb().prepare(
          `UPDATE agent_research_jobs
           SET status=?, sources_json=?, report=?, error=?, updated_at=?
           WHERE id=?`,
        ).run(newStatus, newSources, newReport, newError, now, id);
      }

      res.json(await findJobById(id));
    } catch (err) { next(err); }
  }
}
