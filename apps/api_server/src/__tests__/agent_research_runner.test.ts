import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const { runAgent } = vi.hoisted(() => ({ runAgent: vi.fn() }));

vi.mock('../services/agent_runner', () => ({ run: runAgent }));

import { createApp } from '../app';
import { startTestServer } from './helpers/real_server';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { recoverStaleResearchJobs } from '../controllers/agentResearchController';
import { env } from '../config/env';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

describe('Deep Research direct AgentRunner execution', () => {
  let db: Database.Database;
  let baseUrl: string;
  let close: () => Promise<void>;
  let vault: string;
  let authHeaders: Record<string, string>;
  let userId: number;
  const researchModel = env.researchModel;

  beforeEach(async () => {
    vault = mkdtempSync(path.join(tmpdir(), 'research-runner-vault-'));
    process.env.MEMORY_VAULT_PATH = vault;
    env.researchModel = null;
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const user = new UsersRepository().create({ name: 'Researcher', email: 'researcher@example.com' });
    userId = user.id;
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}` };
    runAgent.mockResolvedValue({ sessionId: 'research-session-1', status: 'done', result: '# Research report\n\nUseful findings.' });
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
    rmSync(vault, { recursive: true, force: true });
    delete process.env.MEMORY_VAULT_PATH;
    env.researchModel = researchModel;
    vi.clearAllMocks();
  });

  it('preserves the prompt, runs the research profile, persists its session and writes report/vault output without a trigger row', async () => {
    const query = 'Compare contemplative prayer and lectio divina';
    const response = await fetch(`${baseUrl}/agent-research`, {
      method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string; status: string };
    expect(created.status).toBe('pending');
    const listed = await (await fetch(`${baseUrl}/agent-research`, { headers: authHeaders })).json() as Array<{ id: string }>;
    expect(listed.map((entry) => entry.id)).toContain(created.id);

    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      const job = db.prepare('SELECT status, report, agent_session_id, vault_path FROM agent_research_jobs WHERE id = ?').get(created.id) as Record<string, string>;
      expect(job.status).toBe('done');
      expect(job.report).toContain('Useful findings.');
      expect(job.agent_session_id).toBe('research-session-1');
      expect(job.vault_path).toContain(vault);
      expect(existsSync(job.vault_path)).toBe(true);
    });
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentConfigId: 'research', agentKind: 'research', cwd: process.cwd(), prompt: expect.stringContaining(query),
    }));
    expect(runAgent.mock.calls[0][0].prompt).toContain('Areas/Research/General/Reports/<date>-<slug>.md');
    expect(runAgent.mock.calls[0][0].prompt).not.toMatch(/theolog/i);
    expect(runAgent.mock.calls[0][0]).not.toHaveProperty('modelOverride');
    expect(db.prepare('SELECT COUNT(*) AS count FROM pending_claude_triggers').get()).toEqual({ count: 0 });
    await vi.waitFor(() => expect(existsSync(path.join(vault, 'Areas', 'Research', 'General', 'Reports'))).toBe(true));
  });

  it('forwards the configured research model override to the runner', async () => {
    env.researchModel = { providerID: 'openrouter', modelID: 'openrouter/free' };
    const response = await fetch(`${baseUrl}/agent-research`, {
      method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'Override case' }),
    });
    expect(response.status).toBe(201);
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledOnce());
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentConfigId: 'research',
      modelOverride: { providerID: 'openrouter', modelID: 'openrouter/free' },
    }));
  });

  it('marks runner failures retryable and the retry endpoint dispatches the same direct runner path', async () => {
    runAgent.mockResolvedValueOnce({ sessionId: 'failed-session', status: 'error', result: '', error: 'provider unavailable' });
    const create = await fetch(`${baseUrl}/agent-research`, {
      method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'Failure case' }),
    });
    const job = await create.json() as { id: string };
    await vi.waitFor(() => expect(db.prepare('SELECT status FROM agent_research_jobs WHERE id = ?').get(job.id)).toEqual({ status: 'error' }));
    expect(db.prepare('SELECT error FROM agent_research_jobs WHERE id = ?').get(job.id)).toEqual({ error: 'provider unavailable' });

    runAgent.mockResolvedValueOnce({ sessionId: 'retry-session', status: 'done', result: 'Recovered report.' });
    const retry = await fetch(`${baseUrl}/agent-research/${job.id}/retry`, { method: 'POST', headers: authHeaders });
    expect(retry.status).toBe(202);
    await vi.waitFor(() => expect(db.prepare('SELECT status FROM agent_research_jobs WHERE id = ?').get(job.id)).toEqual({ status: 'done' }));
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it('recovers active jobs after boot as failed and retryable', async () => {
    db.prepare(`INSERT INTO agent_research_jobs (id, query, status, sources_json, created_at, updated_at) VALUES ('stale', 'Interrupted', 'reading', '[]', ?, ?)`)
      .run(new Date().toISOString(), new Date().toISOString());
    expect(await recoverStaleResearchJobs()).toBe(1);
    expect(db.prepare('SELECT status, error FROM agent_research_jobs WHERE id = ?').get('stale')).toEqual({
      status: 'error', error: 'Research interrupted by server restart. Retry this job to run it again.',
    });
  });

  it('does not retry specialist-origin failures', async () => {
    db.prepare(`INSERT INTO agent_research_jobs
      (id, query, status, sources_json, research_type, title, agent_profile_id, origin, requested_by_user_id, created_at, updated_at)
      VALUES ('specialist', 'Daily trends', 'error', '[]', 'ai-trends', 'Daily trends', 'AI-Trend-Researcher', 'specialist-run', ?, ?, ?)`)
      .run(userId, new Date().toISOString(), new Date().toISOString());
    const retry = await fetch(`${baseUrl}/agent-research/specialist/retry`, { method: 'POST', headers: authHeaders });
    expect(retry.status).toBe(400);
  });
});
