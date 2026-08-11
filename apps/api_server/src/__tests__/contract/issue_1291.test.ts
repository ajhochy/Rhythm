import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { env } from '../../config/env';
import { AgentResearchController } from '../../controllers/agentResearchController';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentResearchRepository } from '../../repositories/agent_research_repository';
import { UsersRepository } from '../../repositories/users_repository';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  const users = new UsersRepository();
  const owner = users.create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  const stranger = users.create({ name: 'Stranger', email: `${randomUUID()}@example.com` });
  return { db, owner, stranger, repo: new AgentResearchRepository() };
}

const projectInput = {
  name: 'Future of small-group formation',
  question: 'Which practices lead to durable participation?',
  goals: ['Compare primary evidence', 'Identify uncertainty'],
  domain: 'ministry',
  profileId: 'research',
  passConfig: [{ role: 'practice', profileId: 'research', model: 'openai/gpt-5.6-terra' }],
  modelPolicy: { default: 'openai/gpt-5.6-terra' },
  criticConfig: { enabled: true },
  synthesisConfig: { enabled: true },
  scheduleRef: null,
  budget: { maxTokens: 50000, maxCostUsd: 10, timeoutMs: 3600000 },
};

async function createThroughController(ownerId: number, body: Record<string, unknown>) {
  const result: { status: number; body?: unknown; error?: unknown } = { status: 200 };
  const response = {
    status(code: number) { result.status = code; return this; },
    json(payload: unknown) { result.body = payload; return this; },
  } as unknown as Response;
  const request = { auth: { user: { id: ownerId } }, body } as unknown as Request;
  const next: NextFunction = (error?: unknown) => { result.error = error; };
  await new AgentResearchController().createProject(request, response, next);
  return result;
}

describe('issue #1291 acceptance contract', () => {
  beforeEach(() => {
    (env as typeof env & { researchProjectsEnabled: boolean }).researchProjectsEnabled = true;
  });

  it('issue-1291-c1: creates updates lists and archives an owner-scoped project', async () => {
    // Regression caught: project CRUD bypasses owner predicates or archive state.
    const { owner, stranger, repo } = setup();
    const create = (repo as any).createProject;
    expect(create).toBeTypeOf('function');
    const project = await create.call(repo, owner.id, projectInput);
    expect(project).toMatchObject({ ownerUserId: owner.id, name: projectInput.name, archivedAt: null });
    expect(await (repo as any).listProjects(owner.id)).toHaveLength(1);
    expect(await (repo as any).listProjects(stranger.id)).toEqual([]);

    const updated = await (repo as any).updateProject(project.id, owner.id, {
      name: 'Updated formation study',
      budget: { maxTokens: 25000 },
    });
    expect(updated).toMatchObject({ name: 'Updated formation study', budget: { maxTokens: 25000 } });
    const archived = await (repo as any).archiveProject(project.id, owner.id);
    expect(archived.archivedAt).toMatch(/Z$/);
    expect(await (repo as any).listProjects(owner.id)).toEqual([]);

    const invalid = await createThroughController(owner.id, { ...projectInput, name: ' ' });
    expect(invalid.error).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
  });

  it("issue-1291-c2: freezes the complete project configuration in each run", async () => {
    // Regression caught: run reads the mutable project row instead of its snapshot.
    const { owner, repo } = setup();
    const project = await (repo as any).createProject(owner.id, projectInput);
    const run = await (repo as any).createProjectRun(project.id, owner.id, 'manual');
    await (repo as any).updateProject(project.id, owner.id, {
      question: 'A different future question',
      passConfig: [{ role: 'replacement' }],
    });
    const stored = await (repo as any).getProjectRun(run.id, owner.id);
    expect(stored.configSnapshot).toMatchObject({
      question: projectInput.question,
      passConfig: projectInput.passConfig,
      triggerType: 'manual',
    });
  });

  it('issue-1291-c3: keeps legacy jobs available and project methods unavailable with the flag off', async () => {
    // Regression caught: mounting the project layer changes the established job API.
    const { owner, repo } = setup();
    await repo.insert({
      id: randomUUID(), query: 'Legacy query', status: 'pending', sourcesJson: '[]',
      report: null, error: null, agentSessionId: null, researchType: 'generic',
      title: 'Legacy query', agentProfileId: 'research', origin: 'page', vaultPath: null,
      canRetry: false, requestedByUserId: owner.id,
    });
    (env as typeof env & { researchProjectsEnabled: boolean }).researchProjectsEnabled = false;
    expect(await repo.listVisible(owner.id)).toHaveLength(1);
    await expect((repo as any).createProject(owner.id, projectInput)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('issue-1291-c4: owner-scoped lookups conceal project run and artifact rows', async () => {
    // Regression caught: child IDs become an authorization oracle across owners.
    const { db, owner, stranger, repo } = setup();
    const project = await (repo as any).createProject(owner.id, projectInput);
    const run = await (repo as any).createProjectRun(project.id, owner.id, 'manual');
    db.prepare(`INSERT INTO agent_research_artifacts
      (id, project_id, project_run_id, artifact_role, vault_path, created_at)
      VALUES ('artifact-owned', ?, ?, 'canonical', 'Reports/report.md', ?)`).run(
      project.id,
      run.id,
      new Date().toISOString(),
    );
    expect(await (repo as any).getProject(project.id, stranger.id)).toBeNull();
    expect(await (repo as any).getProjectRun(run.id, stranger.id)).toBeNull();
    expect(await (repo as any).getArtifact('artifact-owned', stranger.id)).toBeNull();
  });

  it('issue-1291-c5: exposes stable progress diagnostics artifact source and usage references', async () => {
    // Regression caught: API consumers must scrape mutable rows because the run
    // contract omits the stable references needed by MCP and Flutter.
    const { owner, repo } = setup();
    const project = await (repo as any).createProject(owner.id, projectInput);
    const run = await (repo as any).createProjectRun(project.id, owner.id, 'follow-up');
    expect(run).toMatchObject({
      status: 'pending',
      progress: {},
      diagnostics: {},
      canonicalArtifact: null,
      artifacts: [],
      sources: [],
      usage: { tokens: 0, costUsd: 0 },
    });
    expect(['manual', 'scheduled', 'follow-up']).toContain(run.triggerType);
  });
});
