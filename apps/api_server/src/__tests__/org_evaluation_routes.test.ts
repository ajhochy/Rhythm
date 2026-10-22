import Database from 'better-sqlite3';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestServer } from './helpers/real_server';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { env } from '../config/env';
import { OrgEvaluationRepository } from '../repositories/org_evaluation_repository';

describe('pre-review evaluation HTTP contract', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let previous: ReturnType<typeof setDb>;
  const previousAgentLocal = env.agentLocal;
  const db = new Database(':memory:');
  beforeAll(async () => {
    vi.stubEnv('AGENT_LOCAL', 'true');
    env.agentLocal = true;
    runMigrations(db);
    previous = setDb(db);
    const { default: router } = await import('../routes/org_proposals_routes');
    const { errorHandler } = await import('../middleware/error_handler');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // Only this in-process fixture injects an already-authenticated identity;
      // production authentication is exercised by its existing route suites.
      if (req.headers['x-evaluation-test-owner']) req.auth = { sessionToken: 'fixture',
        user: { id: Number(req.headers['x-evaluation-test-owner']) } as NonNullable<typeof req.auth>['user'] };
      next();
    });
    app.use('/agent-org-proposals', router);
    app.use(errorHandler);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    await close?.();
    setDb(previous ?? null);
    db.close();
    vi.unstubAllEnvs();
    env.agentLocal = previousAgentLocal;
  });

  it('org-evaluation-settings: saves one whole-run token limit and candidate count', async () => {
    const initial = await fetch(`${baseUrl}/agent-org-proposals/evaluations/settings`);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ tokenLimit: 1500000, candidateCount: 2, lookbackDays: 7 });
    const saved = await fetch(`${baseUrl}/agent-org-proposals/evaluations/settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tokenLimit: 64000, candidateCount: 3, lookbackDays: 14 }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ tokenLimit: 64000, candidateCount: 3, lookbackDays: 14 });
    const reloaded = await fetch(`${baseUrl}/agent-org-proposals/evaluations/settings`);
    expect(await reloaded.json()).toMatchObject({ tokenLimit: 64000, candidateCount: 3, lookbackDays: 14 });
  });

  it('loads a legacy two-field stored setting with the seven-day default', async () => {
    const previous = db.prepare('SELECT content FROM org_settings WHERE id=?').get('org_evaluation_settings') as { content: string };
    try {
      db.prepare('UPDATE org_settings SET content=? WHERE id=?').run(
        JSON.stringify({ tokenLimit: 64000, candidateCount: 3 }), 'org_evaluation_settings');
      const response = await fetch(`${baseUrl}/agent-org-proposals/evaluations/settings`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ tokenLimit: 64000, candidateCount: 3, lookbackDays: 7 });
      const oldClient = await fetch(`${baseUrl}/agent-org-proposals/evaluations/settings`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tokenLimit: 64000, candidateCount: 3 }),
      });
      expect(oldClient.status).toBe(200);
      expect(await oldClient.json()).toEqual({ tokenLimit: 64000, candidateCount: 3, lookbackDays: 7 });
    } finally {
      db.prepare('UPDATE org_settings SET content=? WHERE id=?').run(previous.content, 'org_evaluation_settings');
    }
  });

  it.each([
    { tokenLimit: 0, candidateCount: 2 },
    { tokenLimit: 12000.5, candidateCount: 2 },
    { tokenLimit: 64000, candidateCount: 4 },
    { tokenLimit: 64000, candidateCount: 2, lookbackDays: 0 },
    { tokenLimit: 64000, candidateCount: 2, lookbackDays: 8 },
    { tokenLimit: 64000, candidateCount: 2, lookbackDays: 15 },
    { tokenLimit: 64000, candidateCount: 2, lookbackDays: '14' },
    { tokenLimit: 64000, candidateCount: 2, unbounded: true },
  ])('org-evaluation-settings: refuses invalid or open settings %j without mutation', async input => {
    const before = await fetch(`${baseUrl}/agent-org-proposals/evaluations/settings`).then(r => r.json());
    const saved = await fetch(`${baseUrl}/agent-org-proposals/evaluations/settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    expect(saved.status).toBe(400);
    const after = await fetch(`${baseUrl}/agent-org-proposals/evaluations/settings`).then(r => r.json());
    expect(after).toEqual(before);
  });

  it('org-evaluation-activity: no evaluation is an honest empty list', async () => {
    const response = await fetch(`${baseUrl}/agent-org-proposals/evaluations`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobs: [] });
  });

  it('org-evaluation-relay: local operator bypass does not grant provider access', async () => {
    const response = await fetch(`${baseUrl}/agent-org-proposals/evaluations/provider/forged/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-6-luna', input: 'do not run' }),
    });
    expect([401, 403]).toContain(response.status);
  });

  it('org-evaluation-ownership: reads own and global work without exposing another owner frozen context', async () => {
    const repository = new OrgEvaluationRepository(db);
    const ids = ['evaluation-owner-seven', 'evaluation-owner-eight', 'evaluation-global'];
    try {
      for (const [index, ownerUserId] of [7, 8, null].entries()) await repository.createJobAsync({
        id: ids[index], ownerUserId, sourceAuditRunId: null, maxTokens: 10000, validationReserveTokens: 3000,
        originalHash: 'a'.repeat(64), targetRef: `org-review-cycle:${ids[index]}`, targetRevision: '1',
        inputJson: JSON.stringify({ privateContext: `owner-${ownerUserId}` }),
      });
      const headers = { 'x-evaluation-test-owner': '7' };
      const listed = await fetch(`${baseUrl}/agent-org-proposals/evaluations`, { headers }).then(response => response.json()) as {
        jobs: Array<{ id: string; inputJson: string }>;
      };
      expect(listed.jobs.map(job => job.id).sort()).toEqual([ids[0], ids[2]].sort());
      expect(listed.jobs.every(job => job.inputJson === '{}')).toBe(true);
      expect((await fetch(`${baseUrl}/agent-org-proposals/evaluations/${ids[1]}`, { headers })).status).toBe(404);
      const activeDetail = await fetch(`${baseUrl}/agent-org-proposals/evaluations/${ids[2]}`, { headers });
      expect(activeDetail.status).toBe(200);
      expect(await activeDetail.json()).toMatchObject({ job: { inputJson: '{}' } });
    } finally {
      for (const id of ids) db.prepare('DELETE FROM org_evaluation_jobs WHERE id=?').run(id);
    }
  });
});
