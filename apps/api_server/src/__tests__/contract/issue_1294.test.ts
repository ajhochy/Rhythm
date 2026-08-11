import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentResearchRepository } from '../../repositories/agent_research_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { ResearchProjectOrchestrator } from '../../services/research_project_orchestrator';

async function fixture(budget: Record<string, unknown> = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db); setDb(db);
  const owner = new UsersRepository().create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  const repo = new AgentResearchRepository();
  const project = await repo.createProject(owner.id, {
    name: 'Lifecycle', question: 'What persists?', goals: [], domain: 'general', profileId: 'research',
    passConfig: [{ role: 'one', profileId: 'research', model: 'openai/gpt-5' }, { role: 'two', profileId: 'research' }],
    modelPolicy: {}, criticConfig: { enabled: true }, synthesisConfig: { enabled: true }, scheduleRef: null, budget,
  });
  const run = (await repo.createProjectRun(project.id, owner.id, 'manual'))!;
  return { db, owner, repo, project, run };
}

describe('issue #1294 acceptance contract', () => {
  beforeEach(() => { env.researchProjectsEnabled = true; });

  it('issue-1294-c1: derives factual progress and usage', async () => {
    const { db, owner, repo, project, run } = await fixture();
    const job = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'one', ordinal: 0, profileId: 'research', config: { model: 'openai/gpt-5' } });
    await repo.updateProjectPassJob(job.id, owner.id, { status: 'done', agentSessionId: 'session-1' });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO agent_sessions (id,name,agent_kind,status,cwd,created_at,updated_at) VALUES ('session-1','r','research','idle','.',?,?)`).run(now, now);
    db.prepare(`INSERT INTO agent_session_messages (session_id,role,raw_text,stripped_text,tokens_json,cost) VALUES ('session-1','output','x','x',?,?)`).run(JSON.stringify({ input: 10, output: 7, reasoning: 3, cache: { read: 2, write: 1 } }), 0.42);
    db.prepare(`INSERT INTO agent_research_artifacts (id,project_id,project_run_id,artifact_role,vault_path,created_at) VALUES ('a',?,?,'pass','a.md',?)`).run(project.id, run.id, now);
    db.prepare(`INSERT INTO agent_research_curated_sources (id,project_id,project_run_id,canonical_url,capture_status,created_at) VALUES ('s',?,?,'https://example.com','complete',?)`).run(project.id, run.id, now);
    const actual = (await repo.getProjectRun(run.id, owner.id))!;
    expect(actual.usage).toEqual({ tokens: 23, costUsd: 0.42 });
    expect(actual.progress).toMatchObject({ totalJobs: 1, completedJobs: 1, artifactCount: 1, sourceCount: 1 });
    expect((actual.progress.stages as any[])[0]).toMatchObject({ profileId: 'research', model: 'openai/gpt-5', status: 'done' });
  });

  it('issue-1294-c2: aborts active work without deleting completed artifacts', async () => {
    const { db, owner, repo, project, run } = await fixture();
    const done = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'one', ordinal: 0, profileId: 'research', config: {} });
    await repo.updateProjectPassJob(done.id, owner.id, { status: 'done' });
    const active = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'two', ordinal: 1, profileId: 'research', config: {} });
    await repo.updateProjectPassJob(active.id, owner.id, { status: 'gathering', agentSessionId: 'live-session' });
    db.prepare(`INSERT INTO agent_research_artifacts (id,project_id,project_run_id,artifact_role,vault_path,created_at) VALUES ('keep',?,?,'pass','keep.md',?)`).run(project.id, run.id, new Date().toISOString());
    const abort = vi.fn().mockResolvedValue(true);
    expect((await repo.cancelProjectRun(run.id, owner.id, abort))!.status).toBe('cancelled');
    await repo.cancelProjectRun(run.id, owner.id, abort);
    expect(abort).toHaveBeenCalledTimes(1);
    expect((await repo.getProjectRun(run.id, owner.id))!.artifacts).toHaveLength(1);
  });

  it('issue-1294-c3: retries only the selected pass and stale stages', async () => {
    const { owner, repo, project, run } = await fixture();
    const first = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'one', ordinal: 0, profileId: 'research', config: {} });
    const second = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'two', ordinal: 1, profileId: 'research', config: {} });
    await repo.updateProjectPassJob(first.id, owner.id, { status: 'done' }); await repo.updateProjectPassJob(second.id, owner.id, { status: 'error' });
    const critic = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'critic', ordinal: 1000, profileId: 'research', config: {} });
    await repo.updateProjectPassJob(critic.id, owner.id, { status: 'done' });
    await repo.retryProjectPassJob(second.id, owner.id);
    const jobs = await repo.listProjectPassJobs(run.id, owner.id);
    expect(jobs).toHaveLength(3); expect(jobs.find((j) => j.id === first.id)?.status).toBe('done');
    expect(jobs.find((j) => j.id === second.id)?.status).toBe('pending'); expect(jobs.find((j) => j.id === critic.id)?.status).toBe('stale');
  });

  it('issue-1294-c4: resumes only unfinished work after restart', async () => {
    const { owner, repo, project, run } = await fixture();
    const done = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'one', ordinal: 0, profileId: 'research', config: {} });
    const active = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'two', ordinal: 1, profileId: 'research', config: {} });
    await repo.updateProjectPassJob(done.id, owner.id, { status: 'done' }); await repo.updateProjectPassJob(active.id, owner.id, { status: 'gathering' });
    await repo.updateProjectRunState(run.id, owner.id, { status: 'running' }); await repo.markActiveProjectWorkInterrupted();
    let sessionOrdinal = 0;
    const runner = { run: vi.fn().mockImplementation(async () => ({ status: 'done', sessionId: `resumed-${++sessionOrdinal}`, result: 'ok' })) };
    await new ResearchProjectOrchestrator(repo, runner).start(run.id, owner.id);
    expect(runner.run.mock.calls.filter((call) => /pass 1: one/.test(call[0].prompt))).toHaveLength(0);
    expect(runner.run.mock.calls.some((call) => /pass 2: two/.test(call[0].prompt))).toBe(true);
  });

  it('issue-1294-c5: blocks downstream work when a persisted budget is exhausted', async () => {
    const { owner, repo, run } = await fixture({ maxPasses: 1, maxTokens: 1, maxCostUsd: 0.01, maxWallClockMs: 60_000 });
    const runner = { run: vi.fn().mockResolvedValue({ status: 'done', sessionId: 'p', result: 'ok' }) };
    const result = await new ResearchProjectOrchestrator(repo, runner).start(run.id, owner.id);
    expect(result.status).toBe('budget_exhausted');
    expect(result.diagnostics).toMatchObject({ budgetExhausted: true });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('keeps project lifecycle unavailable when the feature flag is off', async () => {
    const { owner, repo, run } = await fixture(); env.researchProjectsEnabled = false;
    await expect(repo.cancelProjectRun(run.id, owner.id, vi.fn())).rejects.toMatchObject({ statusCode: 404 });
  });
});
