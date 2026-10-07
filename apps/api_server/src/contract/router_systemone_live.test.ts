import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/auth_middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import agentDecisionsRouter from '../routes/agent_decisions_routes';
import { resetDecisionSettingsCacheForTests } from '../services/decision/decision_settings';
import { routeTurnForSession } from '../services/decision/turn_routing';

/**
 * Live: the real System One path against a RUNNING Kev (default http://127.0.0.1:8009).
 *   uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009
 *   RHYTHM_LIVE_E2E=1 npx vitest run src/contract/router_systemone_live.test.ts
 * Configures the backend through PUT /agent-decisions/config (shadow), tests it via
 * POST /config/test, routes an Auto session's first prompt through routeTurnForSession
 * (the ws_gateway / mobile proxy entry point) and reads the decision back from
 * GET /agent-decisions.
 */
const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const KEV = process.env.RHYTHM_KEV_URL ?? 'http://127.0.0.1:8009';
const TIERS = ['cheap', 'standard', 'frontier'];

/**
 * Kev answers in ~100-350 ms warm but takes ~3-4 s for its first calls after other
 * heavy work on the machine (including this vitest run starting). Warm it first so the
 * assertions measure the routing path, and report the cold latency.
 */
async function warmKev(): Promise<number[]> {
  const body = JSON.stringify({
    model: 'kev-latest', state: 'warm up',
    questions: { q: { type: 'choice', instructions: 'Which?', criteria: { a: 'a', b: 'b' } } },
  });
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    const t = performance.now();
    await (await fetch(`${KEV}/v1/systemone`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).json();
    seen.push(Math.round(performance.now() - t));
    if (seen.length >= 2 && seen.slice(-2).every((ms) => ms < 500)) break;
  }
  return seen;
}

describe.skipIf(!LIVE)('live: systemone model routing against Kev', () => {
  let dir: string;
  let db: Database.Database;
  let prevDb: Database.Database | null;
  let http: Server;
  let base: string;
  const envBefore = { ...process.env };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'router-systemone-live-'));
    for (const k of Object.keys(process.env)) if (k.startsWith('AGENT_DECISION_')) delete process.env[k];
    process.env.RHYTHM_DECISION_ROUTER_FILE = join(dir, 'decision-router.json');
    resetDecisionSettingsCacheForTests();
    db = new Database(':memory:');
    runMigrations(db);
    prevDb = setDb(db);
    const app = express();
    app.use('/agent-decisions', agentDecisionsRouter);
    http = createServer(app);
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/agent-decisions`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => http.close(() => r()));
    setDb(prevDb);
    db.close();
    process.env = envBefore;
    resetDecisionSettingsCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it('PUT systemone (shadow), POST /config/test classifies with Kev, first prompt is logged with probabilities', async () => {
    console.log('[live] Kev warm-up latencies (ms):', (await warmKev()).join(' '));
    const put = await fetch(`${base}/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'systemone', systemone: { baseUrl: KEV }, features: { model_routing: 'shadow' } }),
    });
    expect(put.status).toBe(200);
    const view = (await put.json()) as any;
    expect(view).toMatchObject({ backend: 'systemone', timeoutMs: 1000, systemone: { baseUrl: KEV, hasApiKey: false } });
    expect(view.effective.routing).toMatchObject({ lowConfidenceTier: 'standard', minConfidence: 0.55 });

    // Also warms Kev (the test endpoint allows at least 3000 ms).
    const tested = (await (await fetch(`${base}/config/test`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()) as any;
    console.log('[live] /config/test', JSON.stringify(tested));
    expect(tested.ok).toBe(true);
    expect(TIERS).toContain(tested.tier);
    const sum = TIERS.reduce((a, t) => a + tested.probabilities[t], 0);
    expect(sum).toBeCloseTo(1, 5);

    const routed = await routeTurnForSession({
      sessionRow: { id: 'live-s1', modelMode: 'auto', routerDecidedAt: null, providerId: null, modelId: null },
      sessionId: 'live-s1',
      prompt: 'Design how offline edits in the Flutter app should merge with the production Postgres API when two staff edit the same task, including conflict rules and a migration plan.',
      agentId: 'claude-code',
      requestedSource: 'auto',
      baseRoute: undefined,
      sessionAuto: true,
    });
    // Shadow never changes the route.
    expect(routed.source).not.toBe('router');

    const log = (await (await fetch(`${base}?feature=model_routing`)).json()) as any;
    const row = log.recent.find((r: any) => r.sessionId === 'live-s1');
    console.log('[live] decision row', JSON.stringify(row));
    expect(row).toBeTruthy();
    expect(row).toMatchObject({ feature: 'model_routing', mode: 'shadow', status: 'ok', applied: false });
    expect(TIERS).toContain(row.chosen);
    expect(Object.keys(row.detail.scores).sort()).toEqual([...TIERS].sort());
    expect(row.confidence).toBeCloseTo(Math.max(...TIERS.map((t) => row.detail.scores[t])), 5);
    expect(row.latencyMs).toBeGreaterThan(0);
    expect(row.latencyMs).toBeLessThan(1000);
  }, 90_000);
});
