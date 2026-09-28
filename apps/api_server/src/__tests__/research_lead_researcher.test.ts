import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { DEFAULT_RESEARCH_BUDGET } from '../controllers/agentResearchController';
import { AgentResearchRepository } from '../repositories/agent_research_repository';
import { UsersRepository } from '../repositories/users_repository';
import { MAX_PARALLEL_RESEARCHERS, ResearchProjectOrchestrator, parseResearchAngles } from '../services/research_project_orchestrator';
import { defaultResearchModels, normalizeModelPolicy, type CatalogRowLike } from '../services/research_model_policy';

const row = (provider: string, modelId: string, extra: Partial<CatalogRowLike> = {}): CatalogRowLike =>
  ({ provider, modelId, authorized: true, available: 'unknown', visible: true, ...extra });
const CATALOG = [
  row('anthropic', 'claude-opus-4-5-20251101'), row('anthropic', 'claude-opus-5-5'), row('anthropic', 'claude-opus-5-5-fast'),
  row('anthropic', 'claude-haiku-4-5'), row('openai', 'gpt-5.6-sol'), row('openai', 'gpt-5.6-luna'),
];
const OPUS = { providerId: 'anthropic', modelId: 'claude-opus-5-5' };
const HAIKU = { providerId: 'anthropic', modelId: 'claude-haiku-4-5' };

async function fixture(budget: Record<string, unknown>, modelPolicy: Record<string, unknown> = { lead: OPUS, researcher: HAIKU }) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db); setDb(db);
  const vault = mkdtempSync(path.join(tmpdir(), 'rhythm-research-split-'));
  mkdirSync(path.join(vault, '.obsidian'));
  mkdirSync(path.join(vault, 'AGENT-MEMORY'));
  process.env.MEMORY_VAULT_PATH = path.join(vault, 'AGENT-MEMORY');
  const owner = new UsersRepository().create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  const repo = new AgentResearchRepository();
  const project = await repo.createProject(owner.id, {
    name: 'Week 4', question: 'Who to add?', goals: ['Stats'], domain: 'fantasy', profileId: 'research',
    passConfig: [{ role: 'evidence', profileId: 'research' }], modelPolicy,
    criticConfig: { enabled: true }, synthesisConfig: { enabled: true }, scheduleRef: null,
    budget: { ...DEFAULT_RESEARCH_BUDGET, ...budget },
  });
  const run = (await repo.createProjectRun(project.id, owner.id, 'manual'))!;
  return { db, vault, owner, repo, project, run };
}

/** A finished session that reports `tokens` of usage (as the engine persists messages). */
function session(db: Database.Database, sessionId: string, ownerUserId: number, tokens: number) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO agent_sessions (id,name,agent_kind,status,cwd,owner_user_id,created_at,updated_at) VALUES (?,?,'research','idle','.',?,?,?)`)
    .run(sessionId, sessionId, ownerUserId, now, now);
  db.prepare(`INSERT INTO agent_session_messages (session_id,role,raw_text,stripped_text,parts_json,tokens_json,cost) VALUES (?,'output','ok','ok','[]',?,0)`)
    .run(sessionId, JSON.stringify({ input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }));
}

type RunCall = { prompt: string; modelOverride?: { providerID: string; modelID: string } };
const isPlan = (prompt: string) => prompt.includes('research plan stage');
const isEvidence = (prompt: string) => prompt.startsWith('Research project pass');

/** Mock runner: plan answers with `angles`; evidence passes take `delayMs` and report `tokens`. */
function mockRunner(db: Database.Database, ownerUserId: number, angles: string[], tokens = 10, delayMs = 15) {
  let inFlight = 0;
  const state = { maxInFlight: 0 };
  const run = vi.fn(async (options: RunCall) => {
    const id = `s-${randomUUID()}`;
    if (isPlan(options.prompt)) { session(db, id, ownerUserId, 5); return { status: 'done', sessionId: id, result: `Plan:\n${JSON.stringify(angles)}` }; }
    if (isEvidence(options.prompt)) {
      inFlight += 1; state.maxInFlight = Math.max(state.maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      session(db, id, ownerUserId, tokens);
      inFlight -= 1;
      return { status: 'done', sessionId: id, result: `Evidence for ${/Your research angle: (.+)/.exec(options.prompt)?.[1]}` };
    }
    session(db, id, ownerUserId, 5);
    return { status: 'done', sessionId: id, result: options.prompt.includes('critic stage') ? 'Critique' : '# Final report' };
  });
  return { run, state };
}

describe('research lead/researcher model policy', () => {
  beforeEach(() => { env.researchProjectsEnabled = true; });

  it('defaults lead to the newest non-fast Opus and researchers to Haiku, falling back to OpenAI then the profile', () => {
    expect(defaultResearchModels(CATALOG)).toEqual({ lead: OPUS, researcher: HAIKU });
    const openaiOnly = CATALOG.filter((entry) => entry.provider === 'openai');
    expect(defaultResearchModels(openaiOnly)).toEqual({
      lead: { providerId: 'openai', modelId: 'gpt-5.6-sol' }, researcher: { providerId: 'openai', modelId: 'gpt-5.6-luna' },
    });
    // Hidden / unavailable / unauthorized rows never become defaults (this Mac hides Haiku and Luna).
    const hidden = [row('anthropic', 'claude-opus-5-5'), row('anthropic', 'claude-haiku-4-5', { visible: false }), row('openai', 'gpt-5.6-luna', { available: false })];
    expect(defaultResearchModels(hidden)).toEqual({ lead: OPUS, researcher: null });
    expect(defaultResearchModels([])).toEqual({ lead: null, researcher: null });
  });

  it('validates modelPolicy against the catalog and fills omitted sides with defaults', async () => {
    const catalog = async () => CATALOG;
    await expect(normalizeModelPolicy(undefined, catalog)).resolves.toEqual({});
    await expect(normalizeModelPolicy({}, catalog)).resolves.toEqual({});
    await expect(normalizeModelPolicy({ lead: { providerId: 'openai', modelId: 'gpt-5.6-sol' } }, catalog))
      .resolves.toEqual({ lead: { providerId: 'openai', modelId: 'gpt-5.6-sol' }, researcher: HAIKU });
    await expect(normalizeModelPolicy({ lead: null, researcher: null }, catalog)).resolves.toEqual({ lead: null, researcher: null });
    await expect(normalizeModelPolicy({ lead: { providerId: 'anthropic', modelId: 'claude-nope' } }, catalog))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/modelPolicy.lead anthropic\/claude-nope is not an available model/) });
    await expect(normalizeModelPolicy({ researcher: 'haiku' }, catalog)).rejects.toMatchObject({ statusCode: 400 });
    await expect(normalizeModelPolicy([], catalog)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('parses plan angles from JSON or a list, capped at N', () => {
    expect(parseResearchAngles('Here:\n["a", "b", "b", "c"]', 2)).toEqual(['a', 'b']);
    expect(parseResearchAngles('1. stats\n2) rankings\n- blogs', 5)).toEqual(['stats', 'rankings', 'blogs']);
    expect(parseResearchAngles('nothing useful', 3)).toEqual([]);
  });

  it('plans with the lead, runs researchers in parallel (bounded) on the researcher model, then critic + synthesis on the lead', async () => {
    const { db, owner, repo, run } = await fixture({ maxPasses: 5 });
    const angles = ['Rest-of-season stats', 'Analyst rankings', 'Newsletters', 'Injury news', 'Schedule strength'];
    const { run: runner, state } = mockRunner(db, owner.id, angles);
    const result = await new ResearchProjectOrchestrator(repo, { run: runner } as never).start(run.id, owner.id);
    const calls = runner.mock.calls.map(([options]) => options as RunCall);
    const plan = calls.filter((call) => isPlan(call.prompt));
    const evidence = calls.filter((call) => isEvidence(call.prompt));
    expect(plan).toHaveLength(1);
    expect(plan[0].prompt).toContain('exactly 5 distinct');
    expect(plan[0].modelOverride).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-5-5' });
    expect(evidence).toHaveLength(5);
    expect(evidence.map((call) => /Your research angle: (.+)/.exec(call.prompt)?.[1]).sort()).toEqual([...angles].sort());
    expect(evidence.every((call) => call.modelOverride?.providerID === 'anthropic' && call.modelOverride.modelID === 'claude-haiku-4-5')).toBe(true);
    expect(state.maxInFlight).toBe(MAX_PARALLEL_RESEARCHERS);
    const downstream = calls.filter((call) => !isPlan(call.prompt) && !isEvidence(call.prompt));
    expect(downstream.map((call) => /Code-owned (\w+)/.exec(call.prompt)?.[1])).toEqual(['critic', 'synthesis']);
    expect(downstream.every((call) => call.modelOverride?.modelID === 'claude-opus-5-5')).toBe(true);
    expect(result.status).toBe('complete');
    const stages = result.progress.stages as Array<Record<string, unknown>>;
    expect(stages.find((stage) => stage.role === 'plan')).toMatchObject({ model: 'anthropic/claude-opus-5-5', status: 'done' });
    expect(stages.filter((stage) => stage.role === 'evidence')).toHaveLength(5);
    expect(stages.find((stage) => stage.angle === 'Injury news')).toMatchObject({ model: 'anthropic/claude-haiku-4-5', tokens: 10 });
    expect(stages.find((stage) => stage.role === 'synthesis')).toMatchObject({ model: 'anthropic/claude-opus-5-5' });
  });

  it('stops launching researchers once the budget is spent, then finishes with current evidence on the lead', async () => {
    const { db, owner, repo, run } = await fixture({ maxPasses: 6, maxTokens: 50_000 });
    const { run: runner } = mockRunner(db, owner.id, ['a', 'b', 'c', 'd', 'e', 'f'], 50_000);
    const result = await new ResearchProjectOrchestrator(repo, { run: runner } as never).start(run.id, owner.id);
    const calls = runner.mock.calls.map(([options]) => options as RunCall);
    // The first wave (3) launched under budget; the first pass to report 50k spends it, so nothing else launches.
    expect(calls.filter((call) => isEvidence(call.prompt))).toHaveLength(MAX_PARALLEL_RESEARCHERS);
    expect(calls.some((call) => call.prompt.includes('Code-owned critic stage'))).toBe(false);
    expect(calls.at(-1)!.prompt).toContain('Code-owned synthesis');
    expect(calls.at(-1)!.modelOverride?.modelID).toBe('claude-opus-5-5');
    expect(calls.at(-1)!.prompt).toMatch(/DEGRADED SYNTHESIS: 3 missing/);
    expect(result.status).toBe('degraded');
    expect(result.diagnostics).toMatchObject({ budgetExhausted: true, reasons: ['tokens'], finishedWithCurrentEvidence: true });
  });

  it('a profile-default (null) side creates the stage session without a model override', async () => {
    const { db, owner, repo, run } = await fixture({ maxPasses: 1 }, { lead: OPUS, researcher: null });
    const { run: runner } = mockRunner(db, owner.id, ['only angle']);
    await new ResearchProjectOrchestrator(repo, { run: runner } as never).start(run.id, owner.id);
    const evidence = runner.mock.calls.map(([options]) => options as RunCall).find((call) => isEvidence(call.prompt))!;
    expect(evidence.modelOverride).toBeUndefined();
  });

  it('legacy runs (no modelPolicy) keep one sequential pass per passConfig row and no plan stage', async () => {
    const { db, owner, repo, run } = await fixture({ maxPasses: 3 }, {});
    const { run: runner } = mockRunner(db, owner.id, []);
    const result = await new ResearchProjectOrchestrator(repo, { run: runner } as never).start(run.id, owner.id);
    const calls = runner.mock.calls.map(([options]) => options as RunCall);
    expect(calls.some((call) => isPlan(call.prompt))).toBe(false);
    expect(calls.filter((call) => isEvidence(call.prompt))).toHaveLength(1);
    expect(calls.every((call) => call.modelOverride === undefined)).toBe(true);
    expect(result.status).toBe('complete');
  });

  it('finishes an older budget_exhausted run while a newer run of the same project exists', async () => {
    const { db, owner, repo, project, run: older } = await fixture({ maxPasses: 2 });
    const plan = await repo.createProjectPassJob({ projectId: project.id, projectRunId: older.id, ownerUserId: owner.id, question: 'q', role: 'plan', ordinal: 999, profileId: 'research', config: {} });
    await repo.updateProjectPassJob(plan.id, owner.id, { status: 'done', report: '["a","b"]' });
    const job = await repo.createProjectPassJob({ projectId: project.id, projectRunId: older.id, ownerUserId: owner.id, question: 'q', role: 'evidence', ordinal: 0, profileId: 'research', config: { angle: 'a' } });
    session(db, 'older-evidence', owner.id, 10);
    await repo.updateProjectPassJob(job.id, owner.id, { status: 'done', agentSessionId: 'older-evidence', report: 'Evidence A' });
    await repo.updateProjectRunState(older.id, owner.id, { status: 'budget_exhausted', completedAt: new Date().toISOString(), diagnostics: { budgetExhausted: true, reasons: ['tokens'] } });
    const newer = (await repo.createProjectRun(project.id, owner.id, 'manual'))!;
    expect((await repo.listProjectRuns(project.id, owner.id)).map((entry) => entry.id)).toEqual([newer.id, older.id]);

    const { run: runner } = mockRunner(db, owner.id, []);
    const finished = await new ResearchProjectOrchestrator(repo, { run: runner } as never).finishWithCurrentEvidence(older.id, owner.id);
    expect(runner).toHaveBeenCalledTimes(1);
    const synthesis = runner.mock.calls[0][0] as RunCall;
    expect(synthesis.prompt).toContain('Evidence A');
    expect(synthesis.prompt).toMatch(/DEGRADED SYNTHESIS: 1 missing/);
    expect(synthesis.modelOverride?.modelID).toBe('claude-opus-5-5');
    expect(finished).toMatchObject({ id: older.id, status: 'degraded' });
    expect((await repo.getProjectRun(newer.id, owner.id))!.status).toBe('pending');
  });
});
