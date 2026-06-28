/**
 * #755 — Separate agent-execution from the production API role.
 *
 * A deployment-role flag (RHYTHM_ROLE = all | cloud | local; default 'all')
 * gates the agent-EXECUTION surfaces so a hosted production API ('cloud') runs
 * without the agent runtime, while the local/embedded server keeps it.
 *
 * Surfaces gated (cloud role omits them):
 *   • agent route registration            — apps/api_server/src/app.ts
 *   • AgentScheduler startup               — server.ts
 *   • opencode / managed-Chrome / WS init  — server.ts
 *   • agent session/config table DDL       — postgres_bootstrap.ts
 *
 * Prod-owned surfaces that MUST stay in every role:
 *   • /claude-triggers + pending_claude_triggers (trigger queue)
 *   • agent_scheduled_tasks (cloud enqueues scheduled triggers)
 *
 * Test strategy mirrors the repo's existing conventions:
 *   • env + route registration are exercised at RUNTIME (fresh module graph
 *     per role via vi.resetModules + vi.stubEnv, then real HTTP requests) —
 *     same harness as agent_local_auth_bypass.test.ts.
 *   • server.ts runs main() at import (opens DB/HTTP/WS), so its startup
 *     gating is locked by SOURCE-INSPECTION contracts — same style as
 *     server_shutdown_signal_contract.test.ts.
 *   • postgres_bootstrap.ts gating is likewise source-inspected (a live
 *     postgres is not available in CI; the SQLite suite never runs it).
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Agent-execution routes that must NOT exist in the cloud role.
// Restricted to routes that return a concrete 200 under AGENT_LOCAL=true when
// registered, so "registered" vs "not registered" is an unambiguous 200-vs-404
// distinction. (Routers with no `GET /` handler — e.g. /agent-delegation,
// /sync — return 404 even when mounted, and /notifications/agent is shadowed
// by the always-on /notifications prefix; those are exercised via the server.ts
// / app.ts source contracts instead.)
const AGENT_EXECUTION_ROUTES = [
  '/agents/capabilities',
  '/agents/usage-budget',
  '/agents/models',
  '/agent-configs',
  '/agent-skills',
  '/agent-schedules',
  '/agent-memory',
  '/agent-webhooks',
  '/agent-research',
  '/agent-cookbook',
  '/agent-designs',
  '/agent-sessions',
  '/agent-models/visibility',
  '/opencode/health',
  '/opencode/models',
];

// Core + prod-owned routes that must exist in EVERY role.
const ALWAYS_ON_ROUTES = [
  '/health',
  '/tasks',
  '/claude-triggers',
];

async function makeApp(role: string | null): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  vi.resetModules();
  // RHYTHM_ROLE controls registration; AGENT_LOCAL=true keeps agent routes
  // reachable without a bearer token so a 200/!=404 cleanly distinguishes
  // "registered" from "not registered" (404).
  vi.stubEnv('RHYTHM_ROLE', role ?? '');
  vi.stubEnv('AGENT_LOCAL', 'true');

  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);

  const { createApp } = await import('../app');
  const server = createApp().listen(0);
  server.maxRequestsPerSocket = 1;
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((res, rej) =>
        server.close((e) => (e ? rej(e) : res())),
      ),
  };
}

// ───────────────────────── env config ─────────────────────────

describe('#755 env — RHYTHM_ROLE flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to role="all" with agent execution enabled when unset', async () => {
    vi.stubEnv('RHYTHM_ROLE', '');
    const { env } = await import('../config/env');
    expect(env.role).toBe('all');
    expect(env.agentExecutionEnabled).toBe(true);
  });

  it('role="local" enables agent execution', async () => {
    vi.stubEnv('RHYTHM_ROLE', 'local');
    const { env } = await import('../config/env');
    expect(env.role).toBe('local');
    expect(env.agentExecutionEnabled).toBe(true);
  });

  it('role="cloud" DISABLES agent execution', async () => {
    vi.stubEnv('RHYTHM_ROLE', 'cloud');
    const { env } = await import('../config/env');
    expect(env.role).toBe('cloud');
    expect(env.agentExecutionEnabled).toBe(false);
  });

  it('is case-insensitive and trims', async () => {
    vi.stubEnv('RHYTHM_ROLE', '  CLOUD ');
    const { env } = await import('../config/env');
    expect(env.role).toBe('cloud');
    expect(env.agentExecutionEnabled).toBe(false);
  });

  it('throws on an unknown role (typo cannot silently change behavior)', async () => {
    vi.stubEnv('RHYTHM_ROLE', 'prod');
    await expect(import('../config/env')).rejects.toThrow(/Unsupported RHYTHM_ROLE/);
  });
});

// ───────────────────── route registration ─────────────────────

describe('#755 app.ts — agent route registration is role-gated', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('cloud role: agent-execution routes are NOT registered (404)', async () => {
    const app = await makeApp('cloud');
    close = app.close;
    for (const route of AGENT_EXECUTION_ROUTES) {
      const res = await fetch(`${app.baseUrl}${route}`);
      expect(
        res.status,
        `${route} must be unregistered (404) in the cloud role (got ${res.status})`,
      ).toBe(404);
    }
  });

  it('cloud role: core + prod-owned routes ARE still registered (not 404)', async () => {
    const app = await makeApp('cloud');
    close = app.close;
    for (const route of ALWAYS_ON_ROUTES) {
      const res = await fetch(`${app.baseUrl}${route}`);
      expect(
        res.status,
        `${route} must stay registered in the cloud role (got ${res.status})`,
      ).not.toBe(404);
    }
  });

  it('default role (unset): agent-execution routes ARE registered (not 404)', async () => {
    const app = await makeApp(null);
    close = app.close;
    for (const route of AGENT_EXECUTION_ROUTES) {
      const res = await fetch(`${app.baseUrl}${route}`);
      expect(
        res.status,
        `${route} must be registered by default (got ${res.status})`,
      ).not.toBe(404);
    }
  });

  it('local role: agent-execution routes ARE registered (not 404)', async () => {
    const app = await makeApp('local');
    close = app.close;
    for (const route of AGENT_EXECUTION_ROUTES) {
      const res = await fetch(`${app.baseUrl}${route}`);
      expect(
        res.status,
        `${route} must be registered in the local role (got ${res.status})`,
      ).not.toBe(404);
    }
  });
});

// ───── app.ts registration gating for non-probeable routes (source) ─────

describe('#755 app.ts — non-probeable agent routes live behind the gate', () => {
  const APP_TS = path.join(__dirname, '..', 'app.ts');
  const source = readFileSync(APP_TS, 'utf8');
  // The MAIN agent-execution gate (the big block) is anchored by the
  // agent-configs mount; the earlier mini-gate only holds /notifications/agent.
  const gateIdx = source.indexOf("app.use('/agent-configs'");

  it('declares the env.agentExecutionEnabled gate', () => {
    expect(
      source.indexOf('if (env.agentExecutionEnabled)'),
      'app.ts must gate on env.agentExecutionEnabled',
    ).toBeGreaterThan(-1);
    expect(gateIdx, 'main gated block must exist').toBeGreaterThan(-1);
  });

  it('agent-only routes that have no GET / handler are still inside the main gate', () => {
    const gated = source.slice(gateIdx);
    for (const needle of [
      "app.use('/agent-delegation'",
      "app.use(ptyRouter)",
      "app.use('/sync'",
      "app.use('/opencode/auth'",
      "app.use('/opencode/mcp'",
    ]) {
      expect(gated.includes(needle), `${needle} must be inside the gate`).toBe(true);
    }
  });

  it('/notifications/agent is gated AND mounted before the always-on /notifications prefix', () => {
    const agentMount = source.indexOf("app.use('/notifications/agent'");
    const baseMount = source.indexOf("app.use('/notifications', notificationsRouter)");
    expect(agentMount, '/notifications/agent must be registered').toBeGreaterThan(-1);
    expect(baseMount, '/notifications must be registered').toBeGreaterThan(-1);
    // Express matches the /notifications prefix against /notifications/agent, so
    // the specific agent mount must come first.
    expect(
      agentMount,
      '/notifications/agent must be mounted before /notifications',
    ).toBeLessThan(baseMount);
    // …and it must sit inside an agentExecutionEnabled gate.
    const firstGate = source.indexOf('if (env.agentExecutionEnabled)');
    expect(firstGate).toBeLessThan(agentMount);
  });

  it('core + prod-owned routes are registered BEFORE the gate (every role)', () => {
    const beforeGate = source.slice(0, gateIdx);
    for (const needle of [
      "app.use('/health'",
      "app.use('/tasks'",
      "app.use('/claude-triggers'",
      "app.use('/notifications', notificationsRouter)",
    ]) {
      expect(beforeGate.includes(needle), `${needle} must be registered before the gate`).toBe(true);
    }
  });
});

// ─────────────── server.ts startup gating (source contract) ───────────────

describe('#755 server.ts — agent-execution startup is role-gated', () => {
  const SERVER_TS = path.join(__dirname, '..', 'server.ts');
  const source = readFileSync(SERVER_TS, 'utf8');

  it('gates startup on env.agentExecutionEnabled', () => {
    expect(source).toMatch(/if\s*\(\s*env\.agentExecutionEnabled\s*\)/);
  });

  it('the scheduler, opencode init, managed Chrome, and WS gateway live behind the gate', () => {
    const gateIdx = source.indexOf('if (env.agentExecutionEnabled)');
    expect(gateIdx, 'agent-execution gate must exist').toBeGreaterThan(-1);
    const gated = source.slice(gateIdx);
    for (const needle of [
      'startAgentSchedulerJob()',
      'opencodeClient',
      'managedChromeService.ensureReady()',
      'attachWsGateway',
    ]) {
      expect(
        gated.includes(needle),
        `${needle} must appear after the agent-execution gate`,
      ).toBe(true);
    }
  });

  it('the scheduler is NOT started before the gate (no unconditional tick)', () => {
    const gateIdx = source.indexOf('if (env.agentExecutionEnabled)');
    const beforeGate = source.slice(0, gateIdx);
    expect(
      beforeGate.includes('startAgentSchedulerJob()'),
      'startAgentSchedulerJob() must not be called unconditionally before the gate',
    ).toBe(false);
  });

  it('the shutdown handler still tolerates a disabled scheduler (optional-chained stop)', () => {
    expect(source).toMatch(/agentSchedulerJob\?\.stop\(\)/);
  });
});

// ───────── postgres_bootstrap.ts DDL gating (source contract) ─────────

describe('#755 postgres_bootstrap.ts — agent-execution DDL is role-gated', () => {
  const BOOTSTRAP_TS = path.join(__dirname, '..', 'database', 'postgres_bootstrap.ts');
  const source = readFileSync(BOOTSTRAP_TS, 'utf8');

  it('returns early when agent execution is disabled, before agent_memory et al.', () => {
    const guardIdx = source.indexOf('if (!env.agentExecutionEnabled)');
    expect(guardIdx, 'early-return guard must exist').toBeGreaterThan(-1);
    // The guard must come before the agent-execution table creates.
    const memoryIdx = source.indexOf('CREATE TABLE IF NOT EXISTS agent_memory');
    expect(memoryIdx, 'agent_memory create must exist').toBeGreaterThan(-1);
    expect(
      guardIdx,
      'the role guard must precede agent_memory (so cloud skips it)',
    ).toBeLessThan(memoryIdx);
  });

  it('prod-owned trigger/scheduler DDL stays BEFORE the guard (created in every role)', () => {
    const guardIdx = source.indexOf('if (!env.agentExecutionEnabled)');
    const beforeGuard = source.slice(0, guardIdx);
    for (const needle of [
      'CREATE TABLE IF NOT EXISTS pending_claude_triggers',
      'CREATE TABLE IF NOT EXISTS agent_scheduled_tasks',
      'ALTER TABLE pending_claude_triggers ADD COLUMN IF NOT EXISTS scheduled_task_id',
    ]) {
      expect(
        beforeGuard.includes(needle),
        `prod-owned DDL "${needle}" must be created before the role guard`,
      ).toBe(true);
    }
  });

  it('agent session/config/skill tables stay AFTER the guard (cloud skips them)', () => {
    const guardIdx = source.indexOf('if (!env.agentExecutionEnabled)');
    const afterGuard = source.slice(guardIdx);
    for (const needle of [
      'CREATE TABLE IF NOT EXISTS agent_memory',
      'CREATE TABLE IF NOT EXISTS agent_skills',
      'ALTER TABLE agent_configs ADD COLUMN',
      'ALTER TABLE agent_sessions ADD COLUMN',
    ]) {
      expect(
        afterGuard.includes(needle),
        `agent-execution DDL "${needle}" must be gated behind the role guard`,
      ).toBe(true);
    }
  });
});
