import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentResearchRepository } from '../../repositories/agent_research_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { dispatchScheduledResearchProject, researchLocalDate } from '../../services/agentSchedulerService';

async function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db); setDb(db);
  const owner = new UsersRepository().create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  const repo = new AgentResearchRepository();
  const project = await repo.createProject(owner.id, { name: 'Daily', question: 'Daily?', goals: [], domain: 'theology', profileId: 'research', passConfig: [{ role: 'one' }, { role: 'two' }], modelPolicy: {}, criticConfig: {}, synthesisConfig: {}, scheduleRef: 'schedule-1', budget: {} });
  return { db, owner, repo, project };
}

describe('issue #1295 acceptance contract', () => {
  beforeEach(() => { env.researchProjectsEnabled = true; });

  it('issue-1295-c1: routes only project schedules through the orchestrator', async () => {
    const { owner, repo } = await fixture(); const start = vi.fn().mockResolvedValue(undefined);
    const run = await dispatchScheduledResearchProject({ id: 'schedule-1', timezone: 'America/Los_Angeles', createdByUserId: owner.id }, new Date('2026-07-27T12:00:00Z'), repo, { start });
    expect(run?.triggerType).toBe('scheduled'); expect(start).toHaveBeenCalledWith(run!.id, owner.id);
    expect(await dispatchScheduledResearchProject({ id: 'ordinary', timezone: 'UTC', createdByUserId: owner.id }, new Date(), repo, { start })).toBeNull();
  });

  it('issue-1295-c2: coalesces duplicate ticks by project local date', async () => {
    const { owner, repo, project } = await fixture();
    const [a, b] = await Promise.all([
      repo.createOrGetScheduledProjectRun(project.id, owner.id, '2026-07-27'),
      repo.createOrGetScheduledProjectRun(project.id, owner.id, '2026-07-27'),
    ]);
    expect(a?.id).toBe(b?.id); expect(await repo.listProjectRuns(project.id, owner.id)).toHaveLength(1);
  });

  it('issue-1295-c3: preserves same-day pass rows and shared artifact records', async () => {
    const { db, owner, repo, project } = await fixture(); const run = (await repo.createOrGetScheduledProjectRun(project.id, owner.id, '2026-07-27'))!;
    const one = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'one', ordinal: 0, profileId: 'research', config: {} });
    const two = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'two', ordinal: 1, profileId: 'research', config: {} });
    const now = new Date().toISOString();
    for (const [id, job] of [['a1', one], ['a2', two]] as const) db.prepare(`INSERT INTO agent_research_artifacts (id,project_id,project_run_id,job_id,artifact_role,vault_path,metadata_json,created_at) VALUES (?,?,?,?,'pass','Daily/2026-07-27.md',?,?)`).run(id, project.id, run.id, job.id, JSON.stringify({ passId: job.id }), now);
    expect((await repo.getProjectRun(run.id, owner.id))!.artifacts).toHaveLength(2);
  });

  it('issue-1295-c4: retains provenance and partial failure state', async () => {
    const { db, owner, repo, project } = await fixture(); const run = (await repo.createOrGetScheduledProjectRun(project.id, owner.id, '2026-07-27'))!;
    const one = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'one', ordinal: 0, profileId: 'research', config: {} });
    const two = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'two', ordinal: 1, profileId: 'research', config: {} });
    await repo.updateProjectPassJob(one.id, owner.id, { status: 'done' }); await repo.updateProjectPassJob(two.id, owner.id, { status: 'error', error: 'source timeout' });
    db.prepare(`INSERT INTO agent_research_curated_sources (id,project_id,project_run_id,job_id,canonical_url,capture_status,metadata_json,created_at) VALUES ('src',?,?,?,'https://example.com','complete',?,?)`).run(project.id, run.id, one.id, JSON.stringify({ passId: one.id }), new Date().toISOString());
    const actual = (await repo.getProjectRun(run.id, owner.id))!;
    expect(actual.progress).toMatchObject({ completedJobs: 1, failedJobs: 1 }); expect(actual.sources[0]).toMatchObject({ job_id: one.id });
  });

  it('issue-1295-c5: respects timezone boundaries and cancellation', async () => {
    expect(researchLocalDate(new Date('2026-07-28T06:30:00Z'), 'America/Los_Angeles')).toBe('2026-07-27');
    expect(researchLocalDate(new Date('2026-07-28T06:30:00Z'), 'UTC')).toBe('2026-07-28');
    const { owner, repo, project } = await fixture(); const run = (await repo.createOrGetScheduledProjectRun(project.id, owner.id, '2026-07-27'))!;
    await repo.updateProjectRunState(run.id, owner.id, { status: 'cancelled' }); const start = vi.fn();
    const repeated = await dispatchScheduledResearchProject({ id: 'schedule-1', timezone: 'America/Los_Angeles', createdByUserId: owner.id }, new Date('2026-07-27T12:00:00Z'), repo, { start });
    expect(repeated?.status).toBe('cancelled'); expect(start).not.toHaveBeenCalled();
  });

  it('keeps scheduled project routing off with the feature flag', async () => {
    const { owner, repo } = await fixture(); env.researchProjectsEnabled = false;
    expect(await dispatchScheduledResearchProject({ id: 'schedule-1', timezone: 'UTC', createdByUserId: owner.id }, new Date(), repo, { start: vi.fn() })).toBeNull();
  });
});
