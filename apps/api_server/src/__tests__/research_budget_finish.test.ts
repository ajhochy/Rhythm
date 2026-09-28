import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentResearchController, DEFAULT_RESEARCH_BUDGET, projectBudget } from '../controllers/agentResearchController';
import { AgentResearchRepository } from '../repositories/agent_research_repository';
import { UsersRepository } from '../repositories/users_repository';
import { ResearchProjectOrchestrator } from '../services/research_project_orchestrator';
import { ResearchDiscussionService } from '../services/research_discussion_service';
import { indexResearchSession } from '../services/specialist_research_indexer';

const SOURCE_URL = 'https://www.nfl.com/news/week-4-waiver-wire';

async function fixture(budget: Record<string, unknown>) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db); setDb(db);
  // Real layout: the Obsidian MCP writes at the vault root; the memory vault is its AGENT-MEMORY subfolder.
  const vault = mkdtempSync(path.join(tmpdir(), 'rhythm-research-budget-'));
  mkdirSync(path.join(vault, '.obsidian'));
  mkdirSync(path.join(vault, 'AGENT-MEMORY'));
  process.env.MEMORY_VAULT_PATH = path.join(vault, 'AGENT-MEMORY');
  const owner = new UsersRepository().create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  const repo = new AgentResearchRepository();
  const project = await repo.createProject(owner.id, {
    name: 'Week 4', question: 'Who to add?', goals: [], domain: 'fantasy', profileId: 'research',
    passConfig: [{ role: 'evidence', profileId: 'research' }], modelPolicy: {},
    criticConfig: { enabled: true }, synthesisConfig: { enabled: true }, scheduleRef: null, budget,
  });
  const run = (await repo.createProjectRun(project.id, owner.id, 'manual'))!;
  return { db, vault, owner, repo, project, run };
}

/** An evidence session as the engine persists it: MCP tool name carries the `rhythm_` server prefix. */
function evidenceSession(db: Database.Database, vault: string, sessionId: string, jobId: string, runId: string, tokens: number, ownerUserId = 1) {
  const now = new Date().toISOString();
  for (const file of ['Areas/Research/General/Reports/evidence.md', 'Areas/Research/General/Sources/notes.md']) {
    mkdirSync(path.dirname(path.join(vault, file)), { recursive: true });
    writeFileSync(path.join(vault, file), `# ${file}\n`);
  }
  db.prepare(`INSERT OR IGNORE INTO agent_sessions (id,name,agent_kind,status,cwd,owner_user_id,created_at,updated_at) VALUES (?,?,'research','idle','.',?,?,?)`)
    .run(sessionId, 'Research evidence', ownerUserId, now, now);
  const parts = [{
    type: 'tool', tool: 'rhythm_rhythm_complete_research_pass', state: {
      status: 'completed', input: {
        version: 1, job_id: jobId, run_id: runId, pass_id: jobId,
        artifacts: [
          { role: 'canonical', kind: 'structured', vault_path: 'Areas/Research/General/Reports/evidence.md' },
          { role: 'supporting', kind: 'structured', vault_path: 'Areas/Research/General/Sources/notes.md' },
        ],
        sources: [{ url: SOURCE_URL, canonical_url: SOURCE_URL, capture_status: 'complete', structured_vault_path: 'Areas/Research/General/Sources/notes.md' }],
      },
    },
  }];
  db.prepare(`INSERT INTO agent_session_messages (session_id,role,raw_text,stripped_text,parts_json,tokens_json,cost) VALUES (?,'output',?,?,?,?,0)`)
    .run(sessionId, 'Evidence pass completed and registered.', 'Evidence pass completed and registered.', JSON.stringify(parts),
      JSON.stringify({ input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }));
}

describe('research budget defaults, finish-with-current-evidence, and source registration', () => {
  beforeEach(() => { env.researchProjectsEnabled = true; });

  it('fills omitted budget fields with defaults and rejects out-of-bounds values', () => {
    expect(projectBudget(undefined)).toEqual(DEFAULT_RESEARCH_BUDGET);
    expect(projectBudget({ maxTokens: 2_000_000, junk: 1 })).toEqual({ ...DEFAULT_RESEARCH_BUDGET, maxTokens: 2_000_000 });
    expect(() => projectBudget({ maxTokens: 1000 })).toThrow(/budget.maxTokens/);
    expect(() => projectBudget({ maxWallClockMs: 1000 })).toThrow(/budget.maxWallClockMs/);
    expect(() => projectBudget({ maxPasses: 1.5 })).toThrow(/integer/);
    expect(() => projectBudget({ maxCostUsd: -1 })).toThrow(/budget.maxCostUsd/);
    expect(() => projectBudget('lots')).toThrow(/budget must be an object/);
  });

  it('PATCH budget validates and persists the normalized budget', async () => {
    const { owner, project } = await fixture({});
    const controller = new AgentResearchController();
    const call = async (budget: unknown) => {
      const next = vi.fn(); const json = vi.fn();
      await controller.updateProject({ params: { projectId: project.id }, body: { budget }, auth: { user: { id: owner.id } }, query: {} } as never, { json } as never, next);
      return { next, json };
    };
    const bad = await call({ maxTokens: 10 });
    expect(bad.next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    const good = await call({ maxPasses: 2, maxTokens: 3_000_000, maxCostUsd: 2.5, maxWallClockMs: 20 * 60_000 });
    expect(good.json.mock.calls[0][0].budget).toEqual({ maxPasses: 2, maxTokens: 3_000_000, maxCostUsd: 2.5, maxWallClockMs: 1_200_000 });
  });

  it('registers sources from the engine-prefixed completion tool name', async () => {
    const { db, vault, owner, repo, project, run } = await fixture({});
    const job = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'evidence', ordinal: 0, profileId: 'research', config: {} });
    evidenceSession(db, vault, 'evidence-session', job.id, run.id, 10, owner.id);
    await repo.updateProjectPassJob(job.id, owner.id, { status: 'done', agentSessionId: 'evidence-session', report: 'done' });
    await indexResearchSession('evidence-session');
    const indexed = (await repo.getProjectRun(run.id, owner.id))!;
    expect(indexed.sources.map((source) => source.canonical_url)).toEqual([SOURCE_URL]);
    expect(indexed.canonicalArtifact).toMatchObject({ vault_path: 'Areas/Research/General/Reports/evidence.md' });
  });

  it('registers a source once per run when several passes cite it, and hides legacy per-pass duplicates', async () => {
    const { db, vault, owner, repo, project, run } = await fixture({});
    for (const [ordinal, sessionId] of ['evidence-a', 'evidence-b'].entries()) {
      const job = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'evidence', ordinal, profileId: 'research', config: {} });
      evidenceSession(db, vault, sessionId, job.id, run.id, 10, owner.id);
      await repo.updateProjectPassJob(job.id, owner.id, { status: 'done', agentSessionId: sessionId, report: 'done' });
      await indexResearchSession(sessionId);
      await indexResearchSession(sessionId);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_research_curated_sources WHERE project_run_id=?').get(run.id)).toEqual({ n: 1 });
    db.prepare(`INSERT INTO agent_research_curated_sources (id,project_id,project_run_id,canonical_url,capture_status) VALUES ('legacy-dup',?,?,?,'complete')`).run(project.id, run.id, SOURCE_URL);
    const hydrated = (await repo.getProjectRun(run.id, owner.id))!;
    expect(hydrated.sources.map((source) => source.canonical_url)).toEqual([SOURCE_URL]);
    expect(hydrated.progress.sourceCount).toBe(1);
  });

  it('budget exhaustion after an evidence pass still writes the synthesis, skipping the critic', async () => {
    const { db, vault, owner, repo, run } = await fixture({ maxPasses: 1, maxTokens: 50_000, maxCostUsd: 5, maxWallClockMs: 60_000 });
    const runner = { run: vi.fn(async (options: { prompt: string; onSessionCreated?: (id: string) => Promise<void> }) => {
      if (/pass 1: evidence/.test(options.prompt)) {
        const jobId = /Job ID: (\S+)/.exec(options.prompt)![1];
        evidenceSession(db, vault, 'pass-1', jobId, run.id, 1_404_500, owner.id);
        return { status: 'done', sessionId: 'pass-1', result: 'Evidence pass completed and registered.' };
      }
      return { status: 'done', sessionId: 'synth-1', result: '# Synthesis\nAdd Juwan Johnson.' };
    }) };
    const result = await new ResearchProjectOrchestrator(repo, runner as never).start(run.id, owner.id);
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(runner.run.mock.calls.some((call) => /Code-owned critic stage/.test(call[0].prompt))).toBe(false);
    const synthesisPrompt = runner.run.mock.calls[1][0].prompt;
    expect(synthesisPrompt).toContain('Evidence pass completed and registered.');
    expect(synthesisPrompt).toContain(SOURCE_URL);
    expect(synthesisPrompt).toMatch(/critic stage was skipped/);
    expect(result.status).toBe('degraded');
    expect(result.diagnostics).toMatchObject({ budgetExhausted: true, reasons: ['tokens'], finishedWithCurrentEvidence: true });
    expect((result.progress.stages as Array<Record<string, unknown>>).find((stage) => stage.role === 'synthesis')).toMatchObject({ status: 'done' });
    expect(result.sources).toHaveLength(1);
  });

  it('recovers an already budget_exhausted run: explains the 409, then finishes on demand', async () => {
    const { db, vault, owner, repo, project, run } = await fixture({ maxPasses: 1, maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 });
    // The user's stuck shape: evidence done, never indexed, run marked budget_exhausted.
    const job = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: 'q', role: 'evidence', ordinal: 0, profileId: 'research', config: {} });
    evidenceSession(db, vault, 'old-evidence', job.id, run.id, 1_404_500, owner.id);
    await repo.updateProjectPassJob(job.id, owner.id, { status: 'done', agentSessionId: 'old-evidence', report: 'Evidence report' });
    await repo.updateProjectRunState(run.id, owner.id, { status: 'budget_exhausted', completedAt: new Date().toISOString(), diagnostics: { budgetExhausted: true, reasons: ['tokens', 'wall_clock'] } });

    const discussion = new ResearchDiscussionService(repo, vi.fn() as never, async () => '');
    await expect(discussion.start(project.id, run.id, owner.id, [])).rejects.toMatchObject({
      statusCode: 409, code: 'SYNTHESIS_UNAVAILABLE', message: expect.stringMatching(/Finish with current evidence/),
    });

    await repo.updateProject(project.id, owner.id, { budget: { ...DEFAULT_RESEARCH_BUDGET } });
    await repo.updateProjectRunBudget(run.id, owner.id, { ...DEFAULT_RESEARCH_BUDGET });
    const runner = { run: vi.fn().mockResolvedValue({ status: 'done', sessionId: 'synth-2', result: '# Final\nFrom current evidence.' }) };
    const finished = await new ResearchProjectOrchestrator(repo, runner).finishWithCurrentEvidence(run.id, owner.id);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(finished.status).toBe('degraded');
    expect(finished.diagnostics).toMatchObject({ budgetExhausted: true, reasons: ['tokens', 'wall_clock'], finishedWithCurrentEvidence: true });
    expect(finished.sources.map((source) => source.canonical_url)).toEqual([SOURCE_URL]);
    const session = vi.fn(async (options: { onSessionCreated?: (id: string) => Promise<void> }) => {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO agent_sessions (id,name,agent_kind,status,cwd,created_at,updated_at) VALUES ('discuss','d','claude-code','idle','.',?,?)`).run(now, now);
      await options.onSessionCreated?.('discuss');
      return { sessionId: 'discuss', result: 'Ready.', status: 'done' };
    });
    await expect(new ResearchDiscussionService(repo, session as never, async () => '').start(project.id, run.id, owner.id, []))
      .resolves.toMatchObject({ sessionId: 'discuss' });
  });

  it('keeps budget_exhausted without a synthesis when no evidence pass finished', async () => {
    const { db, vault, owner, repo, run } = await fixture({ maxPasses: 1, maxTokens: 50_000, maxCostUsd: 5, maxWallClockMs: 60_000 });
    const runner = { run: vi.fn(async (options: { prompt: string }) => {
      evidenceSession(db, vault, 'pass-err', /Job ID: (\S+)/.exec(options.prompt)![1], run.id, 60_000, owner.id);
      return { status: 'error', sessionId: 'pass-err', result: '', error: 'provider failed' };
    }) };
    const result = await new ResearchProjectOrchestrator(repo, runner as never).start(run.id, owner.id);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('budget_exhausted');
    expect(result.diagnostics).toMatchObject({ budgetExhausted: true, reasons: ['tokens'] });
  });
});
