import Database from 'better-sqlite3';
import express from 'express';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../anthropic_accounts_service', () => ({ anthropicAccountsService: { listRedacted: () => ({ accounts: [{ id: 'a1', label: 'A', status: 'ok' }] }) } }));
vi.mock('../openai_accounts_service', () => ({ openaiAccountsService: { listRedacted: () => ({ accounts: [] }) } }));

vi.hoisted(() => {
  // Before any import reads decisionSettingsPath(): router-grid.json lands next to this file.
  const { mkdtempSync } = require('fs') as typeof import('fs');
  const dir = mkdtempSync(require('path').join(require('os').tmpdir(), 'grid-admin-'));
  process.env.RHYTHM_DECISION_ROUTER_FILE = `${dir}/decision-router.json`;
  process.env.AGENT_LOCAL = 'true';
});
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { recordDecision } from './decision_log';
import { loadRouterGridConfig, routerGridConfigPath } from './router_grid_config';
import router from '../../routes/agent_decisions_routes';

let base = ''; let server: import('http').Server; let db: Database.Database;
beforeAll(async () => {
  db = new Database(':memory:'); runMigrations(db); setDb(db);
  const app = express(); app.use('/agent-decisions', router);
  server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agent-decisions`;
});
afterAll(() => { server.close(); db.close(); });
beforeEach(() => { writeFileSync(routerGridConfigPath(), '{}'); });
const put = (body: unknown) => fetch(`${base}/grid`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

it('PUT /grid writes the file the router loader reads; reorder + effort + reserve survive a fresh load', async () => {
  const before = loadRouterGridConfig();
  const coding = { ...before.routing.coding, 4: [{ model: 'openai/gpt-6-luna', effort: 'medium', cost_per_task: 0.07 }, before.routing.coding[4][0]] };
  const res = await put({ routing: { coding }, reserve_pct: 30 });
  expect(res.status).toBe(200);
  const view = await res.json() as { source: string; aliases: Record<string, string> };
  expect(view.source).toBe('file'); expect(view.aliases.knowledge).toBe('coding');
  const loaded = loadRouterGridConfig(routerGridConfigPath(), (r) => { throw new Error(r); });
  expect(loaded.reserve_pct).toBe(30);
  expect(loaded.routing.coding[4].map((c) => `${c.model}:${c.effort}`)).toEqual(['openai/gpt-6-luna:medium', 'anthropic/claude-haiku-5-5:low']);
  expect(loaded.routing.knowledge[4]).toEqual(loaded.routing.coding[4]); // alias follows the edit
  expect(JSON.parse(readFileSync(routerGridConfigPath(), 'utf8')).reserve_pct).toBe(30);
});

it('PUT /grid rejects invalid policy and non-editable keys without touching the file', async () => {
  await put({ reserve_pct: 20 });
  const bad = await put({ routing: { coding: { 1: [{ model: 'openai/nope', effort: 'max', cost_per_task: 1 }] } } });
  expect(bad.status).toBe(400); expect(((await bad.json()) as { error: string }).error).toBe('invalid_router_grid_config');
  expect((await put({ free_mode: { enabled: true } })).status).toBe(400);
  expect(loadRouterGridConfig().reserve_pct).toBe(20);
});

it('GET /grid/last-decision returns the latest grid decision without the prompt, with the served model', async () => {
  db.prepare("INSERT INTO agent_sessions (id, agent_kind, cwd, name, status, created_at, updated_at) VALUES ('s1','opencode','/tmp','s','idle','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')").run();
  recordDecision({ feature: 'model_routing', mode: 'on', sessionId: 's1', status: 'ok', applied: true, chosen: 'openai/gpt-6-sol', query: 'secret prompt',
    detail: { engine: 'grid', category: 'coding', tier: 3, tierUsed: 3, model: 'openai/gpt-6-sol', provider: 'openai', effortRequested: 'medium',
      effortApplied: 'medium', accountId: 'o1', accountSource: 'router', reason: 'ok', kind: 'route', classifierSource: 'decisions', trace: [] } });
  db.prepare("INSERT INTO agent_served_steps (id, session_id, sdk_message_id, sdk_part_id, request_model_id, served_model_id, created_at) VALUES ('x','s1','m','p','gpt-6-sol','gpt-6-sol-2026',?)")
    .run(new Date(Date.now() + 1000).toISOString());
  const body = await (await fetch(`${base}/grid/last-decision`)).json() as { decision: unknown };
  expect(body.decision).toMatchObject({ model: 'openai/gpt-6-sol', effortApplied: 'medium', accountSource: 'router', served: { servedModelId: 'gpt-6-sol-2026' } });
  expect(JSON.stringify(body)).not.toContain('secret prompt');
});

it('a fresh install with no router-grid.json reports defaults, and the first save creates the file', async () => {
  // Live 0.18.70: a fresh fixture showed "defaults_after_invalid_file" though no file existed.
  rmSync(routerGridConfigPath(), { force: true });
  const view = await (await fetch(`${base}/grid`)).json() as { source: string; invalidReason: string | null };
  expect(view).toMatchObject({ source: 'defaults', invalidReason: null });
  const res = await put({ reserve_pct: 25 });
  expect(res.status).toBe(200);
  expect(JSON.parse(readFileSync(routerGridConfigPath(), 'utf8')).reserve_pct).toBe(25);
});
