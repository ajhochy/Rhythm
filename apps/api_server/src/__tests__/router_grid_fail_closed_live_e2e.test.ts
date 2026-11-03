/** Real API/engine fail-closed proof: corrupt Free state holds before classifier/model/SDK dispatch. */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import defaults from '../services/decision/router_grid.default.json';
const LIVE = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_LIVE_GRID_FAIL_CLOSED === '1';
const ROOT = '/private/tmp/sdmr-grid-sandbox';
const APP = `${ROOT}/home/Library/Application Support/Rhythm`;
const STATE = `${APP}/router-free-state.json`, OVERRIDE = `${APP}/router-grid.json`;
const BASE = 'http://127.0.0.1:4398', ENGINE = 'http://127.0.0.1:4397', PROVIDER = 'http://127.0.0.1:7482';
const auth = { authorization: 'Bearer e02-synthetic-session-not-a-secret', 'content-type': 'application/json' };
let stateBefore = '', profile = '', routerBefore: Record<string, unknown> = {};
async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { ...auth, ...init.headers }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} ${r.status}`);
  const text = await r.text(); return (text ? JSON.parse(text) : undefined) as T;
}
const evidence = async () => ((await (await fetch(`${PROVIDER}/_grid/evidence`)).json()) as { captures: unknown[] }).captures.length;
(LIVE ? describe : describe.skip)('grid mode:on fails closed when Free state is corrupt', () => {
  beforeAll(async () => {
    expect(process.env.HOME).toBe(`${ROOT}/home`); expect(existsSync(OVERRIDE)).toBe(false);
    routerBefore = await api('/agent-decisions/config'); profile = `syntheticfailclosed-${randomUUID().slice(0, 8)}`;
    await api('/agent-configs', { method: 'POST', body: JSON.stringify({ id: profile, label: profile, isAgent: true, enabled: true,
      sessionSelectable: true, ocAgent: profile, modelProvider: 'openai', modelId: 'gpt-6-luna',
      corePermissionsJson: JSON.stringify({ '*': 'deny' }), systemPrompt: 'Synthetic fail-closed fixture.' }) });
    writeFileSync(OVERRIDE, JSON.stringify({ agent_auto_profiles: [profile], free_mode: { ...defaults.free_mode, enabled: true } }), { flag: 'wx', mode: 0o600 });
    await api('/agent-decisions/config', { method: 'PUT', body: JSON.stringify({ features: { model_routing: 'on' }, routing: { engine: 'grid', scope: 'first_prompt' } }) });
    await api('/system/refresh', { method: 'POST' });
    stateBefore = `${STATE}.failclosed-before-${Date.now()}`; renameSync(STATE, stateBefore);
    writeFileSync(STATE, '{corrupt', { flag: 'wx', mode: 0o600 });
  }, 120_000);
  afterAll(async () => {
    if (existsSync(STATE)) renameSync(STATE, `${STATE}.failclosed-run-${Date.now()}`);
    if (stateBefore && existsSync(stateBefore)) renameSync(stateBefore, STATE);
    if (existsSync(OVERRIDE)) renameSync(OVERRIDE, `${OVERRIDE}.failclosed-retained-${Date.now()}`);
    const keys = ['backend', 'remoteDataConsent', 'features', 'routing', 'tierOverrides', 'systemone', 'openaiDecisions', 'timeoutMs', 'excludedModels'];
    await api('/agent-decisions/config', { method: 'PUT', body: JSON.stringify(Object.fromEntries(keys.filter(k => k in routerBefore).map(k => [k, routerBefore[k]]))) }).catch(() => undefined);
  }, 60_000);
  it('returns held error and records no classifier/model/native dispatch', async () => {
    const cwd = mkdtempSync(join(process.env.TMPDIR!, 'failclosed-'));
    const s = await api<{ id: string; sdkSessionId: string }>('/agent-sessions', { method: 'POST', body: JSON.stringify({ agentId: profile, cwd, name: 'Synthetic grid fail closed', modelMode: 'auto' }) });
    const before = await evidence();
    const nativeBefore = ((await (await fetch(`${ENGINE}/session/${s.sdkSessionId}/message`)).json()) as unknown[]).length;
    const tag = randomUUID();
    const r = await fetch(`${BASE}/agent-sessions/${s.id}/prompt`, { method: 'POST', headers: auth, body: JSON.stringify({ prompt: `Synthetic harmless fixture GRID:tier3:${tag}` }) });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: { message: string } }).error.message).toBe('Routing state is unavailable. This request was not sent.');
    expect(await evidence()).toBe(before);
    expect(((await (await fetch(`${ENGINE}/session/${s.sdkSessionId}/message`)).json()) as unknown[]).length).toBe(nativeBefore);
    const db = new Database(process.env.DB_PATH!, { readonly: true, fileMustExist: true });
    try { expect((db.prepare('SELECT COUNT(*) AS n FROM agent_turn_dispatches WHERE session_id=?').get(s.id) as { n: number }).n).toBe(0); }
    finally { db.close(); }
    const ds = await api<{ recent: Array<{ sessionId: string; status: string; applied: boolean; chosen: unknown; queryPreview?: string | null; detail: Record<string, unknown> }> }>('/agent-decisions?feature=model_routing&limit=20');
    expect(ds.recent.find(x => x.sessionId === s.id)).toMatchObject({ status: 'error', applied: false, chosen: null, queryPreview: null, detail: { engine: 'grid', kind: 'router_state_unavailable' } });
    console.info(JSON.stringify({ caseId: 'GRID-FAIL-CLOSED', http502: true, providerCalls: 0, nativeMessages: 0, dispatchRows: 0, bodyFreeEvent: true }));
  }, 120_000);
});
