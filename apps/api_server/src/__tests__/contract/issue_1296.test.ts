import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentResearchRepository } from '../../repositories/agent_research_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { ResearchProjectReconciler } from '../../services/research_project_reconciler';

function seedJob(db: Database.Database, input: { id: string; owner: number | null; type: string; status: string; vault?: string | null; day?: string }) {
  const at = `${input.day ?? '2026-07-27'}T12:00:00.000Z`;
  db.prepare(`INSERT INTO agent_research_jobs (id,query,status,sources_json,report,error,research_type,title,origin,vault_path,requested_by_user_id,created_at,updated_at) VALUES (?,?,?,'[]',?,?,?,?,'specialist-run',?,?,?,?)`).run(input.id, input.id, input.status, input.status === 'done' ? 'report' : null, input.status === 'error' ? 'retained error' : null, input.type, input.id, input.vault ?? null, input.owner, at, at);
}

function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db); setDb(db);
  const owner = new UsersRepository().create({ name: 'Owner', email: `${randomUUID()}@example.com` });
  return { db, owner, reconciler: new ResearchProjectReconciler(new AgentResearchRepository()) };
}

describe('issue #1296 acceptance contract', () => {
  beforeEach(() => { env.researchProjectsEnabled = true; });

  it('issue-1296-c1: classifies the known 28-job baseline without reruns', async () => {
    const { db, owner, reconciler } = fixture();
    for (let i = 0; i < 20; i++) seedJob(db, { id: `specialist-${i}`, owner: owner.id, type: i < 10 ? 'theological' : 'ai-trends', status: 'done', vault: `Research/${i}.md` });
    for (let i = 0; i < 3; i++) seedJob(db, { id: `generic-${i}`, owner: owner.id, type: 'generic', status: 'done', vault: `Research/generic-${i}.md` });
    for (let i = 0; i < 5; i++) seedJob(db, { id: `error-${i}`, owner: owner.id, type: 'generic', status: 'error' });
    const result = await reconciler.reconcile('apply');
    expect(result).toMatchObject({ scanned: 28, verified: 23, excluded: 5, unresolved: 0, rerunCount: 0 });
    expect(db.prepare(`SELECT COUNT(*) count FROM agent_research_jobs WHERE error='retained error'`).get()).toMatchObject({ count: 5 });
  });

  it('issue-1296-c2: repeated apply is idempotent', async () => {
    const { db, owner, reconciler } = fixture(); seedJob(db, { id: 'one', owner: owner.id, type: 'theological', status: 'done', vault: 'Research/day.md' });
    await reconciler.reconcile('apply'); const before = ['agent_research_projects','agent_research_project_runs','agent_research_artifacts'].map((table) => (db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as any).count);
    await reconciler.reconcile('apply'); const after = ['agent_research_projects','agent_research_project_runs','agent_research_artifacts'].map((table) => (db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as any).count);
    expect(after).toEqual(before);
  });

  it('issue-1296-c3: dry-run reports exact changes and writes nothing', async () => {
    const { db, owner, reconciler } = fixture(); seedJob(db, { id: 'known', owner: owner.id, type: 'generic', status: 'done', vault: 'Research/known.md' }); seedJob(db, { id: 'unknown', owner: null, type: 'generic', status: 'done' });
    const result = await reconciler.reconcile('dry-run');
    expect(result).toMatchObject({ scanned: 2, verified: 1, unresolved: 1, plannedProjects: 1, plannedRuns: 1, plannedArtifacts: 1 });
    expect(db.prepare('SELECT COUNT(*) count FROM agent_research_projects').get()).toMatchObject({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) count FROM agent_research_jobs WHERE classification_json IS NOT NULL`).get()).toMatchObject({ count: 0 });
  });

  it('issue-1296-c4: has no vault filesystem write surface', () => {
    const source = readFileSync(join(__dirname, '../../services/research_project_reconciler.ts'), 'utf8');
    expect(source).not.toMatch(/writeFile|rename\(|unlink\(|rmSync|obsidian_put_file|writeCompletedResearchNote/);
  });

  it('issue-1296-c5: preserves existing artifact and source evidence', async () => {
    const { db, owner, reconciler } = fixture(); seedJob(db, { id: 'preserve', owner: owner.id, type: 'theological', status: 'done', vault: 'Research/day.md' });
    const created = '2026-07-27T12:34:56.000Z';
    db.prepare(`INSERT INTO agent_research_artifacts (id,job_id,artifact_role,vault_path,content_hash,metadata_json,created_at) VALUES ('artifact','preserve','canonical','Research/day.md','hash','{}',?)`).run(created);
    db.prepare(`INSERT INTO agent_research_curated_sources (id,job_id,canonical_url,capture_status,content_hash,metadata_json,created_at) VALUES ('source','preserve','https://example.com','complete','source-hash','{}',?)`).run(created);
    await reconciler.reconcile('apply');
    expect(db.prepare(`SELECT vault_path,content_hash,created_at FROM agent_research_artifacts WHERE id='artifact'`).get()).toEqual({ vault_path: 'Research/day.md', content_hash: 'hash', created_at: created });
    expect(db.prepare(`SELECT capture_status,content_hash,created_at FROM agent_research_curated_sources WHERE id='source'`).get()).toEqual({ capture_status: 'complete', content_hash: 'source-hash', created_at: created });
  });

  it('keeps reconciliation unavailable when the feature flag is off', async () => {
    const { reconciler } = fixture(); env.researchProjectsEnabled = false;
    await expect(reconciler.reconcile('dry-run')).rejects.toMatchObject({ statusCode: 404 });
  });
});
