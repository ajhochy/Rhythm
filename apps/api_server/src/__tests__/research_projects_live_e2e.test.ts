/**
 * #1300 disposable real-engine gate. This suite intentionally costs model tokens.
 * It is skipped unless RHYTHM_LIVE_E2E=1 and fails closed unless the standard
 * isolation guard proves DB_PATH is a disposable copy.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { AgentResearchRepository } from '../repositories/agent_research_repository';
import { dispatchScheduledResearchProject } from '../services/agentSchedulerService';
import { ResearchProjectReconciler } from '../services/research_project_reconciler';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe : describe.skip;
const base = process.env.RHYTHM_LIVE_API_URL ?? 'http://127.0.0.1:4098';
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? process.env.DB_PATH;
const vaultPath = process.env.RHYTHM_LIVE_VAULT_PATH;
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR;
const root = path.resolve(__dirname, '../../../..');
const prefix = `issue-1300-${randomUUID()}`;

type Stage = {
  id: string; role: string; status: string; agentSessionId?: string | null;
  report?: string | null; error?: string | null;
};
type Run = {
  id: string; projectId: string; status: string;
  progress: Record<string, unknown> & { stages?: Stage[] };
  diagnostics: Record<string, unknown>;
  usage: { tokens: number; costUsd: number };
  artifacts: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
};
type Project = { id: string; name: string };

let db: Database.Database;
let ownerId: number;
let foreignId: number;
let token: string;
let foreignToken: string;
let headers: Record<string, string>;
let foreignHeaders: Record<string, string>;
const projectIds: string[] = [];
const sessionIds: string[] = [];

async function api(pathname: string, init: RequestInit = {}, auth = headers): Promise<Response> {
  return fetch(`${base}${pathname}`, {
    ...init,
    headers: { ...auth, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
}

async function json<T>(pathname: string, init: RequestInit = {}, auth = headers): Promise<T> {
  const response = await api(pathname, init, auth);
  const body = await response.text();
  if (!response.ok) throw new Error(`${pathname} -> ${response.status}: ${body}`);
  return body ? JSON.parse(body) as T : undefined as T;
}

async function poll<T>(label: string, read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 1_800_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let latest: T | undefined;
  while (Date.now() < deadline) {
    latest = await read();
    if (accept(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${label} timed out; latest=${JSON.stringify(latest)}`);
}

function createUser(label: string): { id: number; token: string } {
  const email = `${prefix}-${label}@example.test`;
  const id = Number(db.prepare('INSERT INTO users (name,email) VALUES (?,?)').run(`${prefix}-${label}`, email).lastInsertRowid);
  const authToken = randomUUID();
  db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(authToken, id);
  return { id, token: authToken };
}

async function createProject(overrides: Record<string, unknown> = {}): Promise<Project> {
  const project = await json<Project>('/agent-research/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: `${prefix} <img src=x onerror=alert(1)>`,
      question: 'Compare authoritative guidance for operating a safe local-first service. Preserve uncertainty and cite sources.',
      goals: ['Independent evidence', 'Operational recommendations'],
      domain: 'general', profileId: 'research',
      passConfig: [
        { role: 'technical', profileId: 'AI-Trend-Researcher' },
        { role: 'historical', profileId: 'Theological-Researcher' },
        { role: 'risk', profileId: 'research' },
      ],
      modelPolicy: {}, criticConfig: { enabled: true, profileId: 'research' },
      synthesisConfig: { enabled: true, profileId: 'research' }, scheduleRef: null,
      budget: { maxPasses: 3, maxTokens: 250000, maxCostUsd: 25, maxWallClockMs: 1_500_000 },
      ...overrides,
    }),
  });
  projectIds.push(project.id);
  return project;
}

async function startRun(project: Project): Promise<Run> {
  return json(`/agent-research/projects/${project.id}/runs`, {
    method: 'POST', body: JSON.stringify({ triggerType: 'manual' }),
  });
}

async function getRun(projectId: string, runId: string): Promise<Run> {
  return json(`/agent-research/projects/${projectId}/runs/${runId}`);
}

function terminal(run: Run): boolean {
  return ['complete', 'passes_complete', 'degraded', 'budget_exhausted', 'cancelled'].includes(run.status);
}

function vaultDigest(rootPath: string): string {
  const entries: string[] = [];
  const visit = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const relative = path.relative(rootPath, absolute);
      if (statSync(absolute).isDirectory()) visit(absolute);
      else entries.push(`${relative}\0${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`);
    }
  };
  visit(rootPath);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

async function sendDiscussionQuestion(sessionId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(base.replace(/^http/, 'ws') + '/ws/agents');
    const timer = setTimeout(() => { socket.close(); reject(new Error('discussion websocket timed out')); }, 15_000);
    socket.once('open', () => {
      socket.send(JSON.stringify({
        v: 1, type: 'session.input', id: sessionId,
        data: 'What is the verified launch date for a lunar city? If the frozen evidence does not say, follow the grounding rules.',
      }));
      clearTimeout(timer); socket.close(); resolve();
    });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

describeLive.sequential('issue #1300 Research Projects live gate', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (!dbPath || !vaultPath || !sandboxDir) throw new Error('DB, vault, and sandbox paths are required');
    if (new URL(base).hostname !== '127.0.0.1' || new URL(base).port !== '4098') {
      throw new Error('Research Projects live E2E requires isolated API http://127.0.0.1:4098');
    }
    for (const candidate of [dbPath, vaultPath]) {
      if (!path.resolve(candidate).startsWith(`${path.resolve(sandboxDir)}${path.sep}`)) {
        throw new Error(`${candidate} is outside RHYTHM_SANDBOX_DIR`);
      }
    }
    const health = await json<{ status: string; features: { researchProjectsEnabled: boolean } }>('/health', {}, {});
    expect(health).toMatchObject({ status: 'ok', features: { researchProjectsEnabled: true } });
    expect((await json<{ status: string }>('/opencode/health', {}, {})).status).toBe('ready');
    db = new Database(dbPath);
    const owner = createUser('owner'); const foreign = createUser('foreign');
    ownerId = owner.id; foreignId = foreign.id; token = owner.token; foreignToken = foreign.token;
    headers = { Authorization: `Bearer ${token}` };
    foreignHeaders = { Authorization: `Bearer ${foreignToken}` };
  });

  afterAll(async () => {
    for (const id of sessionIds) {
      await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
    }
    if (db) {
      db.prepare('DELETE FROM sessions WHERE user_id IN (?,?)').run(ownerId, foreignId);
      db.prepare('DELETE FROM users WHERE id IN (?,?)').run(ownerId, foreignId);
      db.close();
    }
  });

  it('three distinct pass sessions produce a canonical synthesis with factual totals', async () => {
    const project = await createProject();
    const started = await startRun(project);
    const run = await poll('canonical project run', () => getRun(project.id, started.id), terminal);
    const stages = run.progress.stages ?? [];
    const passes = stages.filter((stage) => ['technical', 'historical', 'risk'].includes(stage.role));
    expect(passes).toHaveLength(3);
    expect(new Set(passes.map((stage) => stage.agentSessionId).filter(Boolean)).size).toBe(3);
    expect(stages.find((stage) => stage.role === 'critic')?.agentSessionId).toBeTruthy();
    expect(stages.find((stage) => stage.role === 'synthesis')).toMatchObject({ status: 'done' });
    expect(run.artifacts.filter((artifact) => artifact.artifact_role === 'canonical')).toHaveLength(1);
    expect(run.sources.length).toBeGreaterThan(0);
    expect(run.usage.tokens).toBeGreaterThan(0);
    expect(run.usage.costUsd).toBeGreaterThanOrEqual(0);
    expect(run.progress).toMatchObject({ totalPasses: 3, completedPasses: 3 });

    // ownership isolation: a second authenticated owner receives a concealed 404.
    const foreign = await api(`/agent-research/projects/${project.id}/runs/${run.id}`, {}, foreignHeaders);
    expect(foreign.status).toBe(404);

    // magazine security + deterministic export
    const htmlA = await api(`/agent-research/projects/${project.id}/runs/${run.id}/export?format=html`);
    const htmlB = await api(`/agent-research/projects/${project.id}/runs/${run.id}/export?format=html`);
    expect(htmlA.status).toBe(200);
    expect(htmlA.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await htmlA.text()).toBe(await htmlB.text());
    const markdownA = await (await api(`/agent-research/projects/${project.id}/runs/${run.id}/export?format=markdown`)).text();
    const markdownB = await (await api(`/agent-research/projects/${project.id}/runs/${run.id}/export?format=markdown`)).text();
    expect(markdownA).toBe(markdownB);
    expect(markdownA).not.toContain('onerror=');

    // grounded discussion: frozen owner/run context, normal resumable session
    const discussion = await json<{ sessionId: string; contextHash: string }>(
      `/agent-research/projects/${project.id}/runs/${run.id}/discussions`,
      { method: 'POST', body: JSON.stringify({ selectedArtifactIds: [] }) },
    );
    sessionIds.push(discussion.sessionId);
    const link = db.prepare('SELECT * FROM agent_research_qa_links WHERE agent_session_id=?').get(discussion.sessionId) as Record<string, unknown>;
    expect(link.owner_user_id).toBe(ownerId);
    expect(link.project_run_id).toBe(run.id);
    expect(link.context_hash).toBe(discussion.contextHash);
    const frozen = String(link.context_snapshot_json);
    db.prepare(`INSERT INTO agent_research_curated_sources
      (id,project_id,project_run_id,canonical_url,capture_status,created_at)
      VALUES (?,?,?,?,?,datetime('now'))`).run(`${prefix}-late`, project.id, run.id, 'https://late.example.test', 'complete');
    expect((db.prepare('SELECT context_snapshot_json FROM agent_research_qa_links WHERE agent_session_id=?').get(discussion.sessionId) as { context_snapshot_json: string }).context_snapshot_json).toBe(frozen);
    await sendDiscussionQuestion(discussion.sessionId);
    const messages = await poll(
      'grounded discussion response',
      () => json<{ messages: Array<{ role: string; strippedText?: string; rawText?: string }> }>(`/agent-sessions/${discussion.sessionId}/messages`),
      (value) => value.messages.some((message) => message.role === 'output' && /evidence|follow-up research/i.test(message.strippedText ?? message.rawText ?? '')),
      300_000,
    );
    expect(JSON.stringify(messages)).toMatch(/evidence|follow-up research/i);
    expect(JSON.stringify(messages)).not.toContain('late.example.test');
  }, 2_100_000);

  it('cancel and selective retry preserve completed work', async () => {
    const cancelProject = await createProject({ criticConfig: {}, synthesisConfig: {} });
    const active = await startRun(cancelProject);
    const observed = await poll('active cancellable pass', () => getRun(cancelProject.id, active.id),
      (run) => (run.progress.stages ?? []).some((stage) => Boolean(stage.agentSessionId) && !['done', 'error', 'cancelled'].includes(stage.status)), 300_000);
    const beforeArtifacts = observed.artifacts.length;
    expect((await json<Run>(`/agent-research/projects/${cancelProject.id}/runs/${active.id}/cancel`, { method: 'POST' })).status).toBe('cancelled');
    expect((await json<Run>(`/agent-research/projects/${cancelProject.id}/runs/${active.id}/cancel`, { method: 'POST' })).status).toBe('cancelled');
    expect((await getRun(cancelProject.id, active.id)).artifacts.length).toBeGreaterThanOrEqual(beforeArtifacts);

    const project = await createProject(); const started = await startRun(project);
    const complete = await poll('retry seed run', () => getRun(project.id, started.id), terminal);
    const stages = complete.progress.stages ?? [];
    const target = stages.find((stage) => stage.role === 'historical')!;
    const untouched = stages.find((stage) => stage.role === 'technical')!;
    db.prepare("UPDATE agent_research_jobs SET status='error',error='live selective retry probe' WHERE id=?").run(target.id);
    const retried = await json<Stage>(`/agent-research/projects/${project.id}/runs/${complete.id}/passes/${target.id}/retry`, { method: 'POST' });
    expect(retried.id).toBe(target.id);
    const rerun = await poll('selective retry', () => getRun(project.id, complete.id),
      (run) => terminal(run) && (run.progress.stages ?? []).find((stage) => stage.id === target.id)?.status === 'done');
    expect((rerun.progress.stages ?? []).find((stage) => stage.id === untouched.id)?.agentSessionId).toBe(untouched.agentSessionId);
    expect((rerun.progress.stages ?? []).find((stage) => stage.id === target.id)?.agentSessionId).not.toBe(target.agentSessionId);
  }, 2_100_000);

  it('restart resume preserves completed passes and resumes unfinished stages', async () => {
    const project = await createProject(); const started = await startRun(project);
    const before = await poll('restart checkpoint', () => getRun(project.id, started.id), (run) => {
      const stages = run.progress.stages ?? [];
      return stages.some((stage) => stage.status === 'done') && stages.some((stage) => Boolean(stage.agentSessionId) && stage.status !== 'done');
    }, 900_000);
    const preserved = new Map((before.progress.stages ?? []).filter((stage) => stage.status === 'done').map((stage) => [stage.id, stage.agentSessionId]));
    execFileSync(path.join(root, 'tools/dev/sandbox.sh'), ['restart'], {
      cwd: root, env: process.env, stdio: 'inherit', timeout: 180_000,
    });
    const resumed = await poll('restart resume', () => getRun(project.id, started.id), terminal);
    for (const [id, sessionId] of preserved) {
      expect((resumed.progress.stages ?? []).find((stage) => stage.id === id)?.agentSessionId).toBe(sessionId);
    }
  }, 2_100_000);

  it('budget exhaustion and same-day aggregation are persisted', async () => {
    const budgetProject = await createProject({ budget: { maxPasses: 0 } });
    const budgetRun = await startRun(budgetProject);
    const exhausted = await poll('budget exhaustion', () => getRun(budgetProject.id, budgetRun.id), terminal, 60_000);
    expect(exhausted.status).toBe('budget_exhausted');
    expect(exhausted.diagnostics).toMatchObject({ budgetExhausted: true });
    expect(exhausted.progress.stages ?? []).toHaveLength(0);

    setDb(db);
    const repo = new AgentResearchRepository();
    const scheduleId = `${prefix}-schedule`;
    const scheduledProject = await repo.createProject(ownerId, {
      name: `${prefix}-daily`, question: 'Daily aggregation?', goals: [], domain: 'general', profileId: 'research',
      passConfig: [], modelPolicy: {}, criticConfig: {}, synthesisConfig: {}, scheduleRef: scheduleId, budget: {},
    });
    projectIds.push(scheduledProject.id);
    const orchestrator = { start: async (runId: string, userId: number) => (await repo.getProjectRun(runId, userId))! };
    const schedule = { id: scheduleId, timezone: 'America/Los_Angeles', createdByUserId: ownerId };
    const first = await dispatchScheduledResearchProject(schedule, new Date('2026-08-11T16:00:00Z'), repo, orchestrator);
    const second = await dispatchScheduledResearchProject(schedule, new Date('2026-08-12T01:00:00Z'), repo, orchestrator);
    expect(first?.id).toBe(second?.id);
    expect((await repo.listProjectRuns(scheduledProject.id, ownerId))).toHaveLength(1);
  });

  it('backfill preserves the vault byte-for-byte and is idempotent', async () => {
    setDb(db);
    const before = vaultDigest(vaultPath!);
    const reconciler = new ResearchProjectReconciler(new AgentResearchRepository());
    const rowsBefore = Number((db.prepare('SELECT COUNT(*) count FROM agent_research_projects').get() as { count: number }).count);
    const dry = await reconciler.reconcile('dry-run');
    expect(Number((db.prepare('SELECT COUNT(*) count FROM agent_research_projects').get() as { count: number }).count)).toBe(rowsBefore);
    const first = await reconciler.reconcile('apply');
    const counts = ['agent_research_projects', 'agent_research_project_runs', 'agent_research_artifacts'].map(
      (table) => Number((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count),
    );
    const second = await reconciler.reconcile('apply');
    const repeated = ['agent_research_projects', 'agent_research_project_runs', 'agent_research_artifacts'].map(
      (table) => Number((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count),
    );
    expect(first.rerunCount).toBe(0); expect(second.rerunCount).toBe(0);
    expect(first.scanned).toBe(dry.scanned); expect(repeated).toEqual(counts);
    expect(vaultDigest(vaultPath!)).toBe(before);
  }, 120_000);
});
