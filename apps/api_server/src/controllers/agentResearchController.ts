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
 * The pipeline runs locally through AgentRunner. The job remains durable while
 * the runner executes, and its recorded AgentRunner session is linked back for
 * inspection in the Chats UI.
 */

import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors/app_error';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { writeResearchNoteToVault } from '../services/researchVaultWriteService';
import * as AgentRunner from '../services/agent_runner';

interface ResearchJob {
  id: string;
  query: string;
  status: string;
  sourcesJson: string;
  report: string | null;
  error: string | null;
  agentSessionId: string | null;
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
    agentSessionId: (row.agent_session_id as string | null) ?? null,
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
      `INSERT INTO agent_research_jobs (id, query, status, sources_json, report, error, agent_session_id, requested_by_user_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [job.id, job.query, job.status, job.sourcesJson, job.report, job.error, job.agentSessionId, job.requestedByUserId, now, now],
    );
    return rowToModel(r.rows[0]);
  }
  getDb().prepare(
    `INSERT INTO agent_research_jobs (id, query, status, sources_json, report, error, agent_session_id, requested_by_user_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(job.id, job.query, job.status, job.sourcesJson, job.report, job.error, job.agentSessionId, job.requestedByUserId, now, now);
  return { ...job, createdAt: now, updatedAt: now };
}

async function updateJob(id: string, patch: Partial<Pick<ResearchJob, 'status' | 'sourcesJson' | 'report' | 'error' | 'agentSessionId'>>): Promise<ResearchJob | null> {
  const current = await findJobById(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  const now = new Date().toISOString();
  if (env.dbClient === 'postgres') {
    await getPostgresPool().query(
      `UPDATE agent_research_jobs SET status=$1, sources_json=$2, report=$3, error=$4, agent_session_id=$5, updated_at=$6 WHERE id=$7`,
      [next.status, next.sourcesJson, next.report, next.error, next.agentSessionId, now, id],
    );
  } else {
    getDb().prepare(
      `UPDATE agent_research_jobs SET status=?, sources_json=?, report=?, error=?, agent_session_id=?, updated_at=? WHERE id=?`,
    ).run(next.status, next.sourcesJson, next.report, next.error, next.agentSessionId, now, id);
  }
  return findJobById(id);
}

function researchPrompt(job: ResearchJob): string {
  return `You are running a Deep Research pipeline for query: "${job.query}"

Research job ID: ${job.id}

Research 3-5 authoritative sources using your available research tools. Read and compare them, then return a comprehensive cited markdown report. Include source URLs and distinguish facts from uncertainty. Keep the report under 2000 words. Return only the final report; Rhythm persists the job progress and report.`;
}

/** Run asynchronously after the API has returned the durable pending job. */
export async function executeResearchJob(id: string): Promise<void> {
  const job = await findJobById(id);
  if (!job) return;
  if (!env.agentExecutionEnabled) {
    await updateJob(id, { status: 'error', error: 'Research execution is unavailable on this server. Retry from a local desktop agent server.' });
    return;
  }

  await updateJob(id, { status: 'gathering', error: null });
  await updateJob(id, { status: 'reading' });
  try {
    const result = await AgentRunner.run({
      prompt: researchPrompt(job),
      cwd: process.cwd(),
      outputTarget: 'session',
      agentConfigId: 'research',
      agentKind: 'research',
      ownerUserId: job.requestedByUserId,
      sessionName: `Research: ${job.query}`,
      taskKind: 'research',
    });
    await updateJob(id, { agentSessionId: result.sessionId || null });
    if (result.status !== 'done' || !result.result.trim()) {
      await updateJob(id, {
        status: 'error',
        error: result.error ?? 'Research agent returned no report. Check the research profile model and provider connection, then retry.',
      });
      return;
    }
    await updateJob(id, { status: 'synthesizing' });
    const updated = await updateJob(id, { status: 'done', report: result.result, error: null });
    if (updated) await writeCompletedResearchNote(updated);
  } catch (err) {
    await updateJob(id, { status: 'error', error: `Research runner failed: ${String(err)}` });
  }
}

/** Mark jobs interrupted by a prior process as retryable instead of spinning. */
export async function recoverStaleResearchJobs(): Promise<number> {
  const active = ['pending', 'gathering', 'reading', 'synthesizing'];
  const error = 'Research interrupted by server restart. Retry this job to run it again.';
  if (env.dbClient === 'postgres') {
    const result = await getPostgresPool().query(
      `UPDATE agent_research_jobs SET status='error', error=$1, updated_at=$2 WHERE status = ANY($3)`,
      [error, new Date().toISOString(), active],
    );
    return result.rowCount ?? 0;
  }
  return getDb().prepare(
    `UPDATE agent_research_jobs SET status='error', error=?, updated_at=? WHERE status IN ('pending','gathering','reading','synthesizing')`,
  ).run(error, new Date().toISOString()).changes;
}

async function writeCompletedResearchNote(job: ResearchJob): Promise<void> {
  try {
    const sources = JSON.parse(job.sourcesJson) as unknown;
    await writeResearchNoteToVault({
      jobId: job.id,
      topic: job.query,
      summary: job.report?.split('\n').find((line) => line.trim() !== '')?.trim() ?? '',
      findings: job.report ?? '',
      sources: Array.isArray(sources) ? sources.map(String) : [],
    });
  } catch (vaultErr) {
    logger.warn(`[Research] vault note write failed for job ${job.id}: ${String(vaultErr)}`);
  }
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
        `SELECT * FROM agent_research_jobs WHERE requested_by_user_id IS ? ORDER BY created_at DESC LIMIT 50`,
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
        report: null, error: null, agentSessionId: null, requestedByUserId: userId,
      });
      logger.info(`[Research] Created job ${id} for query: "${query}"`);
      res.status(201).json(job);
      void executeResearchJob(id);
    } catch (err) { next(err); }
  }

  /** Called by the agent via MCP to update job status. */
  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status, sources, report, error } = req.body as Record<string, unknown>;

      const job = await findJobById(id);
      if (!job) throw AppError.notFound('ResearchJob');

      const validStatuses = ['pending', 'gathering', 'reading', 'synthesizing', 'done', 'error'];
      if (status && !validStatuses.includes(status as string)) {
        throw AppError.badRequest(`status must be one of: ${validStatuses.join(', ')}`);
      }

      const newStatus = typeof status === 'string' ? status : job.status;
      const newSources = Array.isArray(sources) ? JSON.stringify(sources) : job.sourcesJson;
      const newReport = typeof report === 'string' ? report : job.report;
      const newError = typeof error === 'string' ? error : job.error;

      const updated = await updateJob(id, { status: newStatus, sourcesJson: newSources, report: newReport, error: newError });

      // Issue #847: on completion, land the findings as Research Database
      // entries (maintainer intake format — see researchVaultConfig.ts).
      // Vault-first write, but BEST-EFFORT relative to this response — a
      // vault write failure (e.g. no vault configured on this machine) must
      // not turn a successful job-status update into a 500; the job's
      // `report` column remains the durable record either way. The flat
      // report yields one entry per job; structured per-source entries are
      // supported by the service for callers that have them.
      if (updated && newStatus === 'done' && typeof newReport === 'string' && newReport.trim() !== '') {
        try {
          await writeCompletedResearchNote(updated);
        } catch (vaultErr) {
          logger.warn(`[Research] vault note write failed for job ${id}: ${String(vaultErr)}`);
        }
      }

      res.json(updated);
    } catch (err) { next(err); }
  }

  async retry(req: Request, res: Response, next: NextFunction) {
    try {
      const job = await findJobById(req.params.id);
      if (!job) throw AppError.notFound('ResearchJob');
      if (job.status !== 'error') throw AppError.badRequest('Only failed research jobs can be retried');
      const updated = await updateJob(job.id, { status: 'pending', error: null, report: null, agentSessionId: null });
      res.status(202).json(updated);
      void executeResearchJob(job.id);
    } catch (err) { next(err); }
  }
}
