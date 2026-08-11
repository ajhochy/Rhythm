import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentResearchRepository } from '../../repositories/agent_research_repository';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { ResearchDiscussionService, buildResearchDiscussionPrompt, type ResearchDiscussionRunner } from '../../services/research_discussion_service';

const projectInput = {
  name: 'Owned report', question: 'What changed?', goals: [], domain: 'theology', profileId: 'research',
  passConfig: [], modelPolicy: {}, criticConfig: { enabled: true }, synthesisConfig: { enabled: true }, scheduleRef: null,
  budget: { maxTokens: 1000, maxCostUsd: 5 },
};

async function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db); setDb(db);
  const users = new UsersRepository();
  const owner = users.create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  const stranger = users.create({ name: 'Stranger', email: `${randomUUID()}@example.com` });
  const repo = new AgentResearchRepository();
  const project = await repo.createProject(owner.id, projectInput);
  const run = (await repo.createProjectRun(project.id, owner.id, 'manual'))!;
  const critic = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: project.question, role: 'critic', ordinal: 1000, profileId: 'research', config: {} });
  const synthesis = await repo.createProjectPassJob({ projectId: project.id, projectRunId: run.id, ownerUserId: owner.id, question: project.question, role: 'synthesis', ordinal: 1001, profileId: 'research', config: {} });
  await repo.updateProjectPassJob(critic.id, owner.id, { status: 'done', report: 'Minority interpretation [S1].' });
  await repo.updateProjectPassJob(synthesis.id, owner.id, { status: 'done', report: '# Finding\nEvidence is qualified [S1].' });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_research_artifacts (id,project_id,project_run_id,artifact_role,vault_path,metadata_json,created_at) VALUES ('full-1',?,?, 'supporting','Research/source.md','{"kind":"full-text"}',?)`).run(project.id, run.id, now);
  db.prepare(`INSERT INTO agent_research_curated_sources (id,project_id,project_run_id,canonical_url,capture_status,created_at) VALUES ('source-1',?,?, 'https://example.com/a','complete',?)`).run(project.id, run.id, now);
  return { db, owner, stranger, repo, project, run };
}

function runnerWithSession(ownerId: number): { runner: ResearchDiscussionRunner; prompts: string[]; runs: Parameters<ResearchDiscussionRunner>[0][] } {
  const prompts: string[] = [];
  const runs: Parameters<ResearchDiscussionRunner>[0][] = [];
  return {
    prompts,
    runs,
    runner: async (options) => {
      prompts.push(options.prompt);
      runs.push(options);
      const session = new AgentSessionsRepository().insert({ agentKind: 'claude-code', profileId: null, taskId: null, taskTitle: options.taskTitle ?? null, cwd: process.cwd(), name: 'Discuss research', projectId: null, ownerUserId: ownerId });
      await options.onSessionCreated?.(session.id);
      return { sessionId: session.id, result: 'Ready for questions.', status: 'done' };
    },
  };
}

const artifactLoader = async () => 'Frozen full-text evidence [A1].';

describe('issue #1299 acceptance contract', () => {
  beforeEach(() => { (env as typeof env & { researchProjectsEnabled: boolean }).researchProjectsEnabled = true; });

  it('issue-1299-c1: persists linkage to a resumable existing agent session', async () => {
    const { db, owner, repo, project, run } = await fixture(); const fake = runnerWithSession(owner.id);
    const result = await new ResearchDiscussionService(repo, fake.runner, artifactLoader).start(project.id, run.id, owner.id, ['full-1']);
    expect(new AgentSessionsRepository().findById(result.sessionId)).toMatchObject({
      id: result.sessionId, ownerUserId: owner.id,
      taskTitle: `research:${project.id}:${run.id}:${result.contextHash}`,
    });
    expect(db.prepare('SELECT * FROM agent_research_qa_links WHERE agent_session_id=?').get(result.sessionId)).toMatchObject({
      owner_user_id: owner.id, project_id: project.id, project_run_id: run.id, context_hash: result.contextHash,
    });
    expect(fake.runs[0]).toMatchObject({ allowedMcpsJson: '{}', allowedSkillsJson: '[]', ownerUserId: owner.id });
  });

  it('issue-1299-c2: freezes cited grounding and missing-evidence behavior', async () => {
    const prompt = buildResearchDiscussionPrompt({ projectName: 'Report', question: 'Q?', synthesis: 'Finding [S1]', critic: 'Disagreement', sources: [{ id: 'S1', url: 'https://example.com/a', status: 'complete' }], artifacts: [{ id: 'A1', path: 'Research/source.md', kind: 'full-text' }] });
    expect(prompt).toContain('Finding [S1]'); expect(prompt).toContain('https://example.com/a'); expect(prompt).toContain('Research/source.md');
    expect(prompt).toMatch(/cite.*eligible/i); expect(prompt).toMatch(/evidence does not answer/i); expect(prompt).toMatch(/follow-up research run/i);
  });

  it('issue-1299-c3: rejects foreign scope and keeps a later-artifact out of the frozen snapshot', async () => {
    const { db, owner, stranger, repo, project, run } = await fixture(); const fake = runnerWithSession(owner.id);
    await expect(new ResearchDiscussionService(repo, fake.runner, artifactLoader).start(project.id, run.id, stranger.id, [])).rejects.toMatchObject({ statusCode: 404 });
    const result = await new ResearchDiscussionService(repo, fake.runner, artifactLoader).start(project.id, run.id, owner.id, ['full-1']);
    db.prepare(`INSERT INTO agent_research_artifacts (id,project_id,project_run_id,artifact_role,vault_path,metadata_json,created_at) VALUES ('later',?,?, 'supporting','Research/later.md','{"kind":"full-text"}',?)`).run(project.id, run.id, new Date().toISOString());
    const discussion = db.prepare('SELECT * FROM agent_research_qa_links WHERE agent_session_id=?').get(result.sessionId) as any;
    expect(discussion.owner_user_id).toBe(owner.id);
    expect(discussion.project_id).toBe(project.id);
    expect(discussion.project_run_id).toBe(run.id);
    expect(discussion.context_snapshot_json).toContain('Research/source.md');
    expect(discussion.context_snapshot_json).not.toContain('Research/later.md');
    db.prepare(`INSERT INTO agent_research_artifacts (id,project_id,project_run_id,artifact_role,vault_path,metadata_json,created_at) VALUES ('escape',?,?, 'supporting','../secret.md','{"kind":"full-text"}',?)`).run(project.id, run.id, new Date().toISOString());
    await expect(new ResearchDiscussionService(repo, fake.runner).start(project.id, run.id, owner.id, ['escape']))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('issue-1299-c5: enforces the frozen project budget and reports diagnostics', async () => {
    const { db, owner, repo, project, run } = await fixture(); const fake = runnerWithSession(owner.id);
    db.prepare('UPDATE agent_research_project_runs SET config_snapshot_json=? WHERE id=?')
      .run(JSON.stringify({ ...run.configSnapshot, budget: { maxTokens: 0, maxCostUsd: 0 } }), run.id);
    await expect(new ResearchDiscussionService(repo, fake.runner, artifactLoader).start(project.id, run.id, owner.id, [])).rejects.toMatchObject({ statusCode: 409 });
    db.prepare('UPDATE agent_research_project_runs SET config_snapshot_json=? WHERE id=?')
      .run(JSON.stringify({ ...run.configSnapshot, budget: { maxTokens: 1000, maxCostUsd: 5 } }), run.id);
    const result = await new ResearchDiscussionService(repo, fake.runner, artifactLoader).start(project.id, run.id, owner.id, []);
    expect(result.diagnostics).toEqual(expect.any(Object));
    (env as typeof env & { researchProjectsEnabled: boolean }).researchProjectsEnabled = false;
    await expect(new ResearchDiscussionService(repo, fake.runner, artifactLoader).start(project.id, run.id, owner.id, []))
      .rejects.toMatchObject({ statusCode: 404 });
    const sqlite = readFileSync(join(__dirname, '../../database/migrations.ts'), 'utf8');
    const postgres = readFileSync(join(__dirname, '../../database/postgres_bootstrap.ts'), 'utf8');
    for (const column of ['agent_session_id', 'context_snapshot_json', 'context_hash', 'model_usage_json', 'diagnostics_json']) {
      expect(sqlite).toContain(column); expect(postgres).toContain(column);
    }
    const mcp = readFileSync(join(__dirname, '../../../../mcp_server/src/tools/agentResearch.ts'), 'utf8');
    expect(mcp).toContain('rhythm_discuss_research_report');
    expect(mcp).toContain('/discussions');
  });
});
