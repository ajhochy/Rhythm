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
import {
  AgentResearchRepository,
  type ResearchJob,
  type ResearchProjectInput,
  type ResearchProjectPatch,
  type ResearchProjectRun,
} from '../repositories/agent_research_repository';
import { logger } from '../utils/logger';
import { writeGenericResearchReport } from '../services/generic_research_report';
import * as AgentRunner from '../services/agent_runner';

const researchJobs = new AgentResearchRepository();

function projectOwner(req: Request): number {
  const owner = req.auth?.user.id;
  if (owner === undefined) throw AppError.unauthorized('Research projects require an authenticated owner');
  return owner;
}

function optionalObject(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw AppError.badRequest(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalArray(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw AppError.badRequest(`${field} must be an array`);
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw AppError.badRequest(`${field} must be a string or null`);
  return value.trim();
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw AppError.badRequest(`${field} is required`);
  }
  return value.trim();
}

function projectInput(body: Record<string, unknown>): ResearchProjectInput {
  return {
    name: requiredString(body.name, 'name'),
    question: requiredString(body.question, 'question'),
    goals: optionalArray(body.goals, 'goals'),
    domain: optionalString(body.domain, 'domain'),
    profileId: optionalString(body.profileId, 'profileId'),
    passConfig: optionalArray(body.passConfig, 'passConfig'),
    modelPolicy: optionalObject(body.modelPolicy, 'modelPolicy'),
    criticConfig: optionalObject(body.criticConfig, 'criticConfig'),
    synthesisConfig: optionalObject(body.synthesisConfig, 'synthesisConfig'),
    scheduleRef: optionalString(body.scheduleRef, 'scheduleRef'),
    budget: optionalObject(body.budget, 'budget'),
  };
}

function projectPatch(body: Record<string, unknown>): ResearchProjectPatch {
  const patch: ResearchProjectPatch = {};
  if ('name' in body) patch.name = requiredString(body.name, 'name');
  if ('question' in body) patch.question = requiredString(body.question, 'question');
  if ('goals' in body) patch.goals = optionalArray(body.goals, 'goals');
  if ('domain' in body) patch.domain = optionalString(body.domain, 'domain');
  if ('profileId' in body) patch.profileId = optionalString(body.profileId, 'profileId');
  if ('passConfig' in body) patch.passConfig = optionalArray(body.passConfig, 'passConfig');
  if ('modelPolicy' in body) patch.modelPolicy = optionalObject(body.modelPolicy, 'modelPolicy');
  if ('criticConfig' in body) patch.criticConfig = optionalObject(body.criticConfig, 'criticConfig');
  if ('synthesisConfig' in body) patch.synthesisConfig = optionalObject(body.synthesisConfig, 'synthesisConfig');
  if ('scheduleRef' in body) patch.scheduleRef = optionalString(body.scheduleRef, 'scheduleRef');
  if ('budget' in body) patch.budget = optionalObject(body.budget, 'budget');
  return patch;
}

function triggerType(value: unknown): ResearchProjectRun['triggerType'] {
  if (value === undefined) return 'manual';
  if (value === 'manual' || value === 'scheduled' || value === 'follow-up') return value;
  throw AppError.badRequest('triggerType must be manual, scheduled, or follow-up');
}

function researchPrompt(job: ResearchJob): string {
  return `You are running a Deep Research pipeline for query: "${job.query}"

Research job ID: ${job.id}

Research 3-5 authoritative sources using your available research tools. Read and compare them, then return a comprehensive cited markdown report. Include source URLs and distinguish facts from uncertainty. Keep the report under 2000 words. Return only the final report; Rhythm persists it at Areas/Research/General/Reports/<date>-<slug>.md.`;
}

/** Run asynchronously after the API has returned the durable pending job. */
export async function executeResearchJob(id: string): Promise<void> {
  const job = await researchJobs.findById(id);
  if (!job) return;
  if (!env.agentExecutionEnabled) {
    await researchJobs.update(id, { status: 'error', error: 'Research execution is unavailable on this server. Retry from a local desktop agent server.' });
    return;
  }

  await researchJobs.update(id, { status: 'gathering', error: null });
  await researchJobs.update(id, { status: 'reading' });
  try {
    const result = await AgentRunner.run({
      prompt: researchPrompt(job),
      cwd: process.cwd(),
      outputTarget: 'session',
      agentConfigId: 'research',
      agentKind: 'research',
      ...(env.researchModel ? { modelOverride: env.researchModel } : {}),
      ownerUserId: job.requestedByUserId,
      sessionName: `Research: ${job.query}`,
      taskKind: 'research',
    });
    await researchJobs.update(id, { agentSessionId: result.sessionId || null });
    if (result.status !== 'done' || !result.result.trim()) {
      await researchJobs.update(id, {
        status: 'error',
        error: result.error ?? 'Research agent returned no report. Check the research profile model and provider connection, then retry.',
      });
      return;
    }
    await researchJobs.update(id, { status: 'synthesizing' });
    const vaultPath = await writeCompletedResearchNote({ ...job, report: result.result });
    await researchJobs.update(id, { status: 'done', report: result.result, error: null, vaultPath });
  } catch (err) {
    await researchJobs.update(id, { status: 'error', error: `Research runner failed: ${String(err)}` });
  }
}

/** Mark jobs interrupted by a prior process as retryable instead of spinning. */
export async function recoverStaleResearchJobs(): Promise<number> {
  const error = 'Research interrupted by server restart. Retry this job to run it again.';
  return researchJobs.recoverActive(error);
}

async function writeCompletedResearchNote(job: ResearchJob): Promise<string | null> {
  try {
    return await writeGenericResearchReport({
      jobId: job.id,
      topic: job.query,
      report: job.report ?? '',
    });
  } catch (vaultErr) {
    logger.warn(`[Research] vault note write failed for job ${job.id}: ${String(vaultErr)}`);
    return null;
  }
}

function buildResearchPrompt(query: string, id: string): string {
  return `You are running a Deep Research pipeline for query: "${query}"

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
}

async function enqueueResearchTrigger(
  job: Pick<ResearchJob, 'id' | 'query' | 'requestedByUserId'>,
): Promise<void> {
  const now = new Date().toISOString();
  const prompt = buildResearchPrompt(job.query, job.id);
  if (env.dbClient === 'postgres') {
    await getPostgresPool().query(
      `INSERT INTO pending_claude_triggers
         (task_id, triggered_by_user_id, prompt, created_at)
       VALUES (NULL, $1, $2, $3)`,
      [job.requestedByUserId, prompt, now],
    );
    return;
  }
  getDb().prepare(
    `INSERT INTO pending_claude_triggers
       (task_id, triggered_by_user_id, prompt, created_at)
     VALUES (NULL, ?, ?, ?)`,
  ).run(job.requestedByUserId, prompt, now);
}

async function resetResearchJob(job: ResearchJob): Promise<ResearchJob> {
  const now = new Date().toISOString();
  if (env.dbClient === 'postgres') {
    await getPostgresPool().query(
      `UPDATE agent_research_jobs
       SET status = 'pending', sources_json = '[]', report = NULL,
           error = NULL, updated_at = $1
       WHERE id = $2`,
      [now, job.id],
    );
  } else {
    getDb().prepare(
      `UPDATE agent_research_jobs
       SET status = 'pending', sources_json = '[]', report = NULL,
           error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(now, job.id);
  }
  return (await researchJobs.findById(job.id))!;
}

export class AgentResearchController {
  async listProjects(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await researchJobs.listProjects(projectOwner(req), req.query.includeArchived === 'true'));
    } catch (err) { next(err); }
  }

  async createProject(req: Request, res: Response, next: NextFunction) {
    try {
      const created = await researchJobs.createProject(
        projectOwner(req),
        projectInput(req.body as Record<string, unknown>),
      );
      res.status(201).json(created);
    } catch (err) { next(err); }
  }

  async getProject(req: Request, res: Response, next: NextFunction) {
    try {
      const project = await researchJobs.getProject(req.params.projectId, projectOwner(req));
      if (!project) throw AppError.notFound('ResearchProject');
      res.json(project);
    } catch (err) { next(err); }
  }

  async updateProject(req: Request, res: Response, next: NextFunction) {
    try {
      const project = await researchJobs.updateProject(
        req.params.projectId,
        projectOwner(req),
        projectPatch(req.body as Record<string, unknown>),
      );
      if (!project) throw AppError.notFound('ResearchProject');
      res.json(project);
    } catch (err) { next(err); }
  }

  async archiveProject(req: Request, res: Response, next: NextFunction) {
    try {
      const project = await researchJobs.archiveProject(req.params.projectId, projectOwner(req));
      if (!project) throw AppError.notFound('ResearchProject');
      res.json(project);
    } catch (err) { next(err); }
  }

  async listProjectRuns(req: Request, res: Response, next: NextFunction) {
    try {
      const owner = projectOwner(req);
      const project = await researchJobs.getProject(req.params.projectId, owner);
      if (!project) throw AppError.notFound('ResearchProject');
      res.json(await researchJobs.listProjectRuns(project.id, owner));
    } catch (err) { next(err); }
  }

  async createProjectRun(req: Request, res: Response, next: NextFunction) {
    try {
      const run = await researchJobs.createProjectRun(
        req.params.projectId,
        projectOwner(req),
        triggerType((req.body as Record<string, unknown>).triggerType),
      );
      if (!run) throw AppError.notFound('ResearchProject');
      res.status(201).json(run);
    } catch (err) { next(err); }
  }

  async getProjectRun(req: Request, res: Response, next: NextFunction) {
    try {
      const run = await researchJobs.getProjectRun(req.params.runId, projectOwner(req));
      if (!run || run.projectId !== req.params.projectId) throw AppError.notFound('ResearchProjectRun');
      res.json(run);
    } catch (err) { next(err); }
  }

  async getProjectArtifact(req: Request, res: Response, next: NextFunction) {
    try {
      const artifact = await researchJobs.getArtifact(req.params.artifactId, projectOwner(req));
      if (!artifact || artifact.project_id !== req.params.projectId) throw AppError.notFound('ResearchArtifact');
      res.json(artifact);
    } catch (err) { next(err); }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await researchJobs.listVisible(req.auth?.user.id));
    } catch (err) { next(err); }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const job = await researchJobs.findVisibleById(
        req.params.id,
        req.auth?.user.id,
      );
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

      const job = await researchJobs.insert({
        id, query, status: 'pending', sourcesJson: '[]',
        report: null, error: null, agentSessionId: null, researchType: 'generic', title: query,
        agentProfileId: 'research', origin: 'page', vaultPath: null, canRetry: false, requestedByUserId: userId,
      });
      logger.info(`[Research] Created job ${id} for query: "${query}"`);
      res.status(201).json(job);
      void executeResearchJob(id);
    } catch (err) { next(err); }
  }

  async retry(req: Request, res: Response, next: NextFunction) {
    try {
      const job = await researchJobs.findVisibleById(
        req.params.id,
        req.auth?.user.id,
      );
      if (!job) throw AppError.notFound('ResearchJob');
      if (!job.canRetry) {
        throw AppError.badRequest('Only failed page research jobs can be retried');
      }
      const reset = await researchJobs.update(job.id, {
        status: 'pending',
        error: null,
        report: null,
        agentSessionId: null,
      });
      logger.info(`[Research] Retrying job ${job.id}`);
      res.status(202).json(reset);
      void executeResearchJob(job.id);
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const job = await researchJobs.findVisibleById(
        req.params.id,
        req.auth?.user.id,
      );
      if (!job) throw AppError.notFound('ResearchJob');
      await researchJobs.remove(job);
      res.status(204).end();
    } catch (err) { next(err); }
  }

  /** Called by the agent via MCP to update job status. */
  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status, sources, report, error } = req.body as Record<string, unknown>;

      const job = await researchJobs.findVisibleById(id, req.auth?.user.id);
      if (!job) throw AppError.notFound('ResearchJob');

      const validStatuses = ['pending', 'gathering', 'reading', 'synthesizing', 'done', 'error'];
      if (status && !validStatuses.includes(status as string)) {
        throw AppError.badRequest(`status must be one of: ${validStatuses.join(', ')}`);
      }

      const newStatus = typeof status === 'string' ? status : job.status;
      const newSources = Array.isArray(sources) ? JSON.stringify(sources) : job.sourcesJson;
      const newReport = typeof report === 'string' ? report : job.report;
      const newError = typeof error === 'string' ? error : job.error;

      const updated = await researchJobs.update(id, { status: newStatus, sourcesJson: newSources, report: newReport, error: newError });

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

}
