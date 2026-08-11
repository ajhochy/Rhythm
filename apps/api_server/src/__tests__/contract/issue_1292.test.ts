import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../config/env';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentResearchRepository } from '../../repositories/agent_research_repository';
import { UsersRepository } from '../../repositories/users_repository';

const orchestratorModule = '../../services/research_project_orchestrator';

async function orchestratorClass() {
  const loaded = await import(orchestratorModule).catch(() => ({} as Record<string, unknown>));
  expect((loaded as any).ResearchProjectOrchestrator).toBeTypeOf('function');
  return (loaded as any).ResearchProjectOrchestrator;
}

async function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  const owner = new UsersRepository().create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  const repo = new AgentResearchRepository();
  const project = await repo.createProject(owner.id, {
    name: 'Three perspectives', question: 'What should we expect next?',
    goals: ['Evidence', 'Uncertainty'], domain: 'general', profileId: 'research',
    passConfig: [
      { role: 'technical', profileId: 'research', model: 'openai/technical' },
      { role: 'social', profileId: 'AI-Trend-Researcher', model: 'openai/social' },
      { role: 'historical', profileId: 'Theological-Researcher', model: 'openai/history' },
    ],
    modelPolicy: {}, criticConfig: {}, synthesisConfig: {}, scheduleRef: null,
    budget: { timeoutMs: 120000 },
  });
  const run = await repo.createProjectRun(project.id, owner.id, 'manual');
  return { db, owner, repo, project, run: run! };
}

describe('issue #1292 acceptance contract', () => {
  beforeEach(() => {
    (env as typeof env & { researchProjectsEnabled: boolean }).researchProjectsEnabled = true;
  });

  it('issue-1292-c1: creates one persisted job and distinct session per configured pass', async () => {
    // Regression caught: one shared AgentRunner session overwrites all pass provenance.
    const { owner, repo, run } = await fixture();
    const Agent = await orchestratorClass();
    const runner = { run: vi.fn()
      .mockResolvedValueOnce({ status: 'done', sessionId: 'session-a', result: 'A' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'session-b', result: 'B' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'session-c', result: 'C' }) };
    await new Agent(repo, runner).start(run.id, owner.id);
    const jobs = await (repo as any).listProjectPassJobs(run.id, owner.id);
    expect(jobs).toHaveLength(3);
    expect(new Set(jobs.map((job: any) => job.agentSessionId)).size).toBe(3);
    expect(jobs.map((job: any) => job.passOrdinal)).toEqual([0, 1, 2]);
  });

  it('issue-1292-c2: constructs every pass prompt from only the immutable shared snapshot', async () => {
    // Regression caught: pass B sees pass A prose and independence is lost.
    const { owner, repo, run } = await fixture();
    const Agent = await orchestratorClass();
    const runner = { run: vi.fn()
      .mockResolvedValueOnce({ status: 'done', sessionId: 'a', result: 'SIBLING SECRET A' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'b', result: 'SIBLING SECRET B' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'c', result: 'C' }) };
    await new Agent(repo, runner).start(run.id, owner.id);
    for (const [index, call] of runner.run.mock.calls.entries()) {
      expect(call[0].prompt).toContain('What should we expect next?');
      expect(call[0].prompt).toContain('Evidence');
      if (index > 0) expect(call[0].prompt).not.toContain('SIBLING SECRET A');
      if (index > 1) expect(call[0].prompt).not.toContain('SIBLING SECRET B');
    }
  });

  it('issue-1292-c3: preserves successful jobs and marks the run degraded after a partial failure', async () => {
    // Regression caught: one rejected pass rolls back completed artifacts/jobs.
    const { owner, repo, run } = await fixture();
    const Agent = await orchestratorClass();
    const runner = { run: vi.fn()
      .mockResolvedValueOnce({ status: 'done', sessionId: 'a', result: 'kept A' })
      .mockResolvedValueOnce({ status: 'error', sessionId: 'b', result: '', error: 'provider failed' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'c', result: 'kept C' }) };
    const result = await new Agent(repo, runner).start(run.id, owner.id);
    const jobs = await (repo as any).listProjectPassJobs(run.id, owner.id);
    expect(jobs.map((job: any) => job.status)).toEqual(['done', 'error', 'done']);
    expect(jobs[0].report).toBe('kept A');
    expect(jobs[2].report).toBe('kept C');
    expect(result.status).toBe('degraded');
  });

  it('issue-1292-c4: coalesces concurrent and repeated start requests', async () => {
    // Regression caught: double-click/API retry creates six active pass rows.
    const { owner, repo, run } = await fixture();
    const Agent = await orchestratorClass();
    const runner = { run: vi.fn(async ({ sessionName }: any) => ({ status: 'done', sessionId: sessionName, result: 'ok' })) };
    const orchestrator = new Agent(repo, runner);
    await Promise.all([orchestrator.start(run.id, owner.id), orchestrator.start(run.id, owner.id)]);
    await orchestrator.start(run.id, owner.id);
    expect(await (repo as any).listProjectPassJobs(run.id, owner.id)).toHaveLength(3);
    expect(runner.run).toHaveBeenCalledTimes(3);
  });

  it('issue-1292-c5: records timeout capacity and interrupted starts without duplicating completed passes', async () => {
    // Regression caught: interrupted/capacity rows vanish or restart as duplicates.
    const { owner, repo, run } = await fixture();
    const Agent = await orchestratorClass();
    const runner = { run: vi.fn()
      .mockResolvedValueOnce({ status: 'error', sessionId: 'timeout', result: '', error: 'timed out', errorCode: 'timeout' })
      .mockResolvedValueOnce({ status: 'error', sessionId: '', result: '', error: 'capacity', errorCode: 'capacity' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'ok', result: 'kept' }) };
    const orchestrator = new Agent(repo, runner);
    await orchestrator.start(run.id, owner.id);
    const before = await (repo as any).listProjectPassJobs(run.id, owner.id);
    expect(before.map((job: any) => job.error)).toEqual(['timed out', 'capacity', null]);
    await orchestrator.reconcileInterruptedStarts(owner.id);
    const after = await (repo as any).listProjectPassJobs(run.id, owner.id);
    expect(after).toHaveLength(3);
    expect(after.filter((job: any) => job.status === 'done')).toHaveLength(1);

    const interruptedFixture = await fixture();
    const first = await (interruptedFixture.repo as any).createProjectPassJob({
      projectId: interruptedFixture.project.id,
      projectRunId: interruptedFixture.run.id,
      ownerUserId: interruptedFixture.owner.id,
      question: 'What should we expect next?',
      role: 'technical', ordinal: 0, profileId: 'research', config: {},
    });
    await (interruptedFixture.repo as any).updateProjectPassJob(first.id, interruptedFixture.owner.id, {
      status: 'done', agentSessionId: 'already-complete', report: 'preserve me', error: null,
    });
    const second = await (interruptedFixture.repo as any).createProjectPassJob({
      projectId: interruptedFixture.project.id,
      projectRunId: interruptedFixture.run.id,
      ownerUserId: interruptedFixture.owner.id,
      question: 'What should we expect next?',
      role: 'social', ordinal: 1, profileId: 'AI-Trend-Researcher', config: {},
    });
    await (interruptedFixture.repo as any).updateProjectPassJob(second.id, interruptedFixture.owner.id, {
      status: 'gathering',
    });
    await (interruptedFixture.repo as any).updateProjectRunState(
      interruptedFixture.run.id,
      interruptedFixture.owner.id,
      { status: 'running' },
    );
    const resumeRunner = { run: vi.fn()
      .mockResolvedValueOnce({ status: 'done', sessionId: 'resumed-social', result: 'social' })
      .mockResolvedValueOnce({ status: 'done', sessionId: 'resumed-history', result: 'history' }) };
    await new Agent(interruptedFixture.repo, resumeRunner)
      .reconcileInterruptedStarts(interruptedFixture.owner.id);
    const reconciled = await (interruptedFixture.repo as any).listProjectPassJobs(
      interruptedFixture.run.id,
      interruptedFixture.owner.id,
    );
    expect(reconciled).toHaveLength(3);
    expect(reconciled[0]).toMatchObject({ agentSessionId: 'already-complete', report: 'preserve me' });
    expect(resumeRunner.run).toHaveBeenCalledTimes(2);
  });
});
