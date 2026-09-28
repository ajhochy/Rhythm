import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentResearchController, researchGuidance } from '../controllers/agentResearchController';
import { AgentDesignsRepository } from '../repositories/agent_designs_repository';
import { AgentResearchRepository } from '../repositories/agent_research_repository';
import { UsersRepository } from '../repositories/users_repository';
import { ResearchProjectOrchestrator } from '../services/research_project_orchestrator';

const ARTIFACT_A = '0b6f7d1e-6a1c-4c7e-9a55-3f2d1c0b9a8e';
const ARTIFACT_B = '1c7a8e2f-7b2d-4d8f-8b66-4a3e2d1c0b9f';

async function fixture(modelPolicy: Record<string, unknown> = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db); setDb(db);
  const owner = new UsersRepository().create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  const repo = new AgentResearchRepository();
  const project = await repo.createProject(owner.id, {
    name: 'Week 4', question: 'Who to add?', goals: ['Waiver targets'], domain: 'fantasy', profileId: 'research',
    passConfig: [{ role: 'evidence', profileId: 'research' }], modelPolicy,
    criticConfig: { enabled: false }, synthesisConfig: { enabled: true }, scheduleRef: null, budget: {},
  });
  return { db, owner, repo, project };
}

describe('research magazine as a living artifact', () => {
  beforeEach(() => { env.researchProjectsEnabled = true; });

  it('links the magazine artifact once and keeps exactly one Gallery entry, replacing it when the artifact changes', async () => {
    const { owner, repo, project } = await fixture();
    expect(project.magazineArtifactId).toBeNull();
    const designs = new AgentDesignsRepository();
    for (let i = 0; i < 2; i++) {
      const linked = await repo.setMagazineArtifact(project.id, owner.id, ARTIFACT_A);
      expect(linked?.magazineArtifactId).toBe(ARTIFACT_A);
    }
    expect((await designs.listAllAsync()).map(({ title, provider, artifactType, artifactUrl }) => ({ title, provider, artifactType, artifactUrl }))).toEqual([
      { title: 'Week 4 — research magazine', provider: 'rhythm-research', artifactType: 'html', artifactUrl: `rhythm-artifact://app/${ARTIFACT_A}` },
    ]);
    await repo.setMagazineArtifact(project.id, owner.id, ARTIFACT_B);
    expect((await designs.listAllAsync()).map((design) => design.artifactUrl)).toEqual([`rhythm-artifact://app/${ARTIFACT_B}`]);
    expect(await repo.setMagazineArtifact(project.id, owner.id + 1, ARTIFACT_A)).toBeNull();
  });

  it('PUT magazine-artifact validates the id and scopes to the owner', async () => {
    const { owner, project } = await fixture();
    const controller = new AgentResearchController();
    const call = async (artifactId: unknown, userId = owner.id) => {
      const next = vi.fn(); const json = vi.fn();
      await controller.setProjectMagazineArtifact({ params: { projectId: project.id }, body: { artifactId }, auth: { user: { id: userId } }, query: {} } as never, { json } as never, next);
      return { next, json };
    };
    expect((await call('../../etc')).next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect((await call(ARTIFACT_A, owner.id + 99)).next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
    expect((await call(ARTIFACT_A.toUpperCase())).json.mock.calls[0][0]).toMatchObject({ magazineArtifactId: ARTIFACT_A });
  });

  it('resolves a discussion session back to its project, run and magazine', async () => {
    const { db, owner, repo, project } = await fixture();
    const run = (await repo.createProjectRun(project.id, owner.id, 'manual'))!;
    await repo.setMagazineArtifact(project.id, owner.id, ARTIFACT_A);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO agent_sessions (id,name,agent_kind,status,cwd,owner_user_id,created_at,updated_at) VALUES ('discuss-1','d','research','idle','.',?,?,?)`).run(owner.id, now, now);
    db.prepare(`INSERT INTO agent_research_qa_links (id,project_id,project_run_id,owner_user_id,question,agent_session_id,created_at) VALUES ('qa-1',?,?,?,?,?,?)`).run(project.id, run.id, owner.id, 'q', 'discuss-1', now);
    expect(await repo.sessionMagazine('discuss-1', owner.id)).toEqual({ projectId: project.id, runId: run.id, artifactId: ARTIFACT_A });
    expect(await repo.sessionMagazine('discuss-1', owner.id + 1)).toBeNull();
    expect(await repo.sessionMagazine('other', owner.id)).toBeNull();
  });

  it('bounds reader guidance and rejects markup-bearing anchors', () => {
    expect(researchGuidance(undefined)).toEqual([]);
    expect(researchGuidance([{ anchor: 'waiver-targets', quote: ' Add Juwan Johnson ', text: ' Check his snap share ' }]))
      .toEqual([{ anchor: 'waiver-targets', quote: 'Add Juwan Johnson', text: 'Check his snap share' }]);
    expect(() => researchGuidance([{ anchor: '"><script>', text: 'x' }])).toThrow(/guidance/);
    expect(() => researchGuidance([{ anchor: null, text: '' }])).toThrow(/guidance/);
    expect(() => researchGuidance(Array.from({ length: 21 }, () => ({ anchor: null, text: 'x' })))).toThrow(/at most 20/);
  });

  it('feeds section comments into the next run\'s lead plan prompt', async () => {
    const { owner, repo, project } = await fixture({ lead: { providerId: 'anthropic', modelId: 'claude-opus-5-5' }, researcher: { providerId: 'openai', modelId: 'gpt-5.6-luna' } });
    const run = (await repo.createProjectRun(project.id, owner.id, 'manual', [{ anchor: 'waiver-targets', quote: 'Add Juwan Johnson', text: 'Verify his snap share' }]))!;
    expect(run.configSnapshot.guidance).toEqual([{ anchor: 'waiver-targets', quote: 'Add Juwan Johnson', text: 'Verify his snap share' }]);
    const runner = { run: vi.fn(async () => ({ status: 'error', sessionId: 'plan-1', result: '', error: 'stop here' })) };
    await new ResearchProjectOrchestrator(repo, runner as never).start(run.id, owner.id).catch(() => undefined);
    const planPrompt = (runner.run.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(planPrompt).toContain('Code-owned research plan stage');
    expect(planPrompt).toContain('Reader comment (section #waiver-targets) on "Add Juwan Johnson": Verify his snap share');
  });
});
