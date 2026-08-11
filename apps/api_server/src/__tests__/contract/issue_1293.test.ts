import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../config/env';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentResearchRepository } from '../../repositories/agent_research_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { ResearchProjectOrchestrator } from '../../services/research_project_orchestrator';

async function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  const owner = new UsersRepository().create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  const repo = new AgentResearchRepository();
  const project = await repo.createProject(owner.id, {
    name: 'Critique study', question: 'Which conclusion survives scrutiny?', goals: ['Find disagreements'],
    domain: 'general', profileId: 'research',
    passConfig: [{ role: 'one', profileId: 'research' }, { role: 'two', profileId: 'research' }],
    modelPolicy: {}, criticConfig: { enabled: true, profileId: 'research' },
    synthesisConfig: { enabled: true, profileId: 'research' }, scheduleRef: null, budget: {},
  });
  const run = (await repo.createProjectRun(project.id, owner.id, 'manual'))!;
  return { db, owner, repo, project, run };
}

describe('issue #1293 acceptance contract', () => {
  beforeEach(() => { env.researchProjectsEnabled = true; });

  it('issue-1293-c1: persists separate critic and synthesis stage sessions', async () => {
    // Regression caught: synthesis reuses a pass/critic session and loses stage provenance.
    const { owner, repo, run } = await fixture();
    const runner = { run: vi.fn()
      .mockResolvedValueOnce({ status: 'done', sessionId: 'pass-1', result: 'agree A' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'pass-2', result: 'agree B' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'critic', result: 'critic report' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'synthesis', result: 'canonical synthesis' }) };
    await new ResearchProjectOrchestrator(repo, runner).start(run.id, owner.id);
    const jobs = await repo.listProjectPassJobs(run.id, owner.id);
    expect(jobs.map((job) => job.passRole)).toEqual(['one', 'two', 'critic', 'synthesis']);
    expect(jobs.slice(2).map((job) => job.agentSessionId)).toEqual(['critic', 'synthesis']);
  });

  it('issue-1293-c2: stage prompts include only owned-run artifacts and curated sources', async () => {
    // Regression caught: a stage query omits run_id and leaks another project's artifact.
    const { db, owner, repo, project, run } = await fixture();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO agent_research_artifacts
      (id, project_id, project_run_id, artifact_role, vault_path, created_at)
      VALUES ('owned-artifact', ?, ?, 'pass', 'Reports/owned.md', ?)`).run(project.id, run.id, now);
    db.prepare(`INSERT INTO agent_research_curated_sources
      (id, project_id, project_run_id, canonical_url, capture_status, created_at)
      VALUES ('owned-source', ?, ?, 'https://owned.example/source', 'complete', ?)`).run(project.id, run.id, now);
    const runner = { run: vi.fn()
      .mockResolvedValueOnce({ status: 'done', sessionId: 'p1', result: 'A' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'p2', result: 'B' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'c', result: 'C' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 's', result: 'S' }) };
    await new ResearchProjectOrchestrator(repo, runner).start(run.id, owner.id);
    const stagePrompts = runner.run.mock.calls.slice(2).map((call) => call[0].prompt).join('\n');
    expect(stagePrompts).toContain('Reports/owned.md');
    expect(stagePrompts).toContain('https://owned.example/source');
    expect(stagePrompts).not.toContain('foreign.example');
  });

  it('issue-1293-c3: labels partial evidence as degraded in synthesis', async () => {
    // Regression caught: missing passes are described as consensus.
    const { owner, repo, run } = await fixture();
    const runner = { run: vi.fn()
      .mockResolvedValueOnce({ status: 'done', sessionId: 'p1', result: 'claim A' })
      .mockResolvedValueOnce({ status: 'error', sessionId: 'p2', result: '', error: 'missing' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'c', result: 'conflict noted' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 's', result: 'qualified synthesis' }) };
    await new ResearchProjectOrchestrator(repo, runner).start(run.id, owner.id);
    expect(runner.run.mock.calls[3][0].prompt).toMatch(/DEGRADED.*missing pass/si);
    expect((await repo.getProjectRun(run.id, owner.id))!.status).toBe('degraded');
  });

  it('issue-1293-c4: invalidates downstream stages while preserving pass rows', async () => {
    // Regression caught: selective retry serves stale critic/synthesis as canonical.
    const { owner, repo, run } = await fixture();
    const runner = { run: vi.fn()
      .mockResolvedValueOnce({ status: 'done', sessionId: 'p1', result: 'A' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'p2', result: 'B' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'c', result: 'C' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 's', result: 'S' }) };
    await new ResearchProjectOrchestrator(repo, runner).start(run.id, owner.id);
    await (repo as any).markDownstreamStagesStale(run.id, owner.id);
    const jobs = await repo.listProjectPassJobs(run.id, owner.id);
    expect(jobs.slice(0, 2).map((job) => job.status)).toEqual(['done', 'done']);
    expect(jobs.slice(2).map((job) => job.status)).toEqual(['stale', 'stale']);
  });

  it('issue-1293-c5: records malformed critic output and synthesizes with an evidence-absent warning', async () => {
    // Regression caught: an empty critic result is treated as valid evidence.
    const { owner, repo, run } = await fixture();
    const runner = { run: vi.fn()
      .mockResolvedValueOnce({ status: 'done', sessionId: 'p1', result: 'conflict A' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'p2', result: 'conflict B' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'c', result: '   ' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 's', result: 'degraded output' }) };
    await new ResearchProjectOrchestrator(repo, runner).start(run.id, owner.id);
    const jobs = await repo.listProjectPassJobs(run.id, owner.id);
    expect(jobs.find((job) => job.passRole === 'critic')).toMatchObject({ status: 'error' });
    expect(runner.run.mock.calls[3][0].prompt).toMatch(/critic evidence is absent/i);
  });
});
