/**
 * Free Mode D1-D4 live proof on the isolated grid sandbox (real API + fork engine, fake loopback providers).
 * Opt-in: RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_FREE_DRAIN=1. Synthetic sessions only; the router-grid override is
 * renamed aside afterwards (never deleted); cooldowns, captures, ledgers and sessions are never cleared.
 * One synthetic fixture mutation: the fresh test session F gets the existing synthetic member owner (id 2).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import defaults from '../services/decision/router_grid.default.json';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_LIVE_FREE_DRAIN === '1';
const ROOT = '/private/tmp/sdmr-grid-sandbox';
const APP = `${ROOT}/home/Library/Application Support/Rhythm`;
const OVERRIDE = `${APP}/router-grid.json`, STATE = `${APP}/router-free-state.json`, ROUTER = `${APP}/decision-router.json`;
const BASE = 'http://127.0.0.1:4398', PROVIDER = 'http://127.0.0.1:7482';
const auth = { authorization: 'Bearer e02-synthetic-session-not-a-secret', 'content-type': 'application/json' };
type Capture = { turnTag?: string; accountLabel?: string; HTTPstatus?: number };
type Held = { id: string; status: string; reason: string | null; classificationSource: string | null; dispatchId: string | null };
const pause = (ms = 250) => new Promise(r => setTimeout(r, ms));
async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { ...auth, ...init.headers }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${r.status}`);
  const text = await r.text(); return (text ? JSON.parse(text) : undefined) as T;
}
async function poll<T>(read: () => Promise<T | undefined>, label: string, ms = 120_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await read(); if (v !== undefined) return v; await pause(); }
  throw new Error(`${label} timed out`);
}
const all = async () => ((await (await fetch(`${PROVIDER}/_grid/evidence`)).json()) as { captures: Capture[] }).captures;
const paid = async (tag: string) => (await all()).filter(c => c.turnTag === tag && c.accountLabel !== 'classifier' && c.HTTPstatus === 200).length;
const classified = async (tag: string) => (await all()).filter(c => c.turnTag === tag && c.accountLabel === 'classifier').length;
const control = (used: number) => fetch(`${PROVIDER}/_grid/control`, { method: 'POST', headers: { authorization: '' }, body: JSON.stringify({
  unknown: false, fail429: [], malformed: false, usage: Object.fromEntries(['openai-a', 'openai-b', 'anthropic-a', 'anthropic-b'].map(a => [a, { five: used, week: used }])) }) });
async function freshUsage() { const t = Date.now(); expect(Date.parse((await api<{ fetchedAt: string }>('/agents/usage-budget?force=true')).fetchedAt)).toBeGreaterThanOrEqual(t - 1000); }
const queue = () => existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as { queue: Array<{ reference: string }> }).queue : [];
const prompt = (id: string, tag: string) => fetch(`${BASE}/agent-sessions/${id}/prompt`, { method: 'POST', headers: auth,
  body: JSON.stringify({ prompt: `Synthetic harmless code fixture GRID:tier3:${tag}` }), signal: AbortSignal.timeout(60_000) });
const held = async (id: string) => (await api<{ heldTurns: Held[] }>(`/agent-sessions/${id}/held-turns`)).heldTurns;
const final = (s: string) => !['pending', 'claimed'].includes(s);
let profile = '', schedule = '', prior: string[] = [], router: Record<string, unknown> = {};

(LIVE ? describe : describe.skip)('Free Mode D1-D4 automatic drain live (synthetic grid sandbox)', () => {
  beforeAll(async () => {
    expect(process.env.HOME).toBe(`${ROOT}/home`);
    expect(existsSync(OVERRIDE), 'no pre-existing grid override').toBe(false);
    prior = queue().map(d => d.reference);
    router = JSON.parse(readFileSync(ROUTER, 'utf8'));
    profile = `syntheticdrain-${randomUUID().slice(0, 8)}`;
    await api('/agent-configs', { method: 'POST', body: JSON.stringify({ id: profile, label: profile, isAgent: true, enabled: true,
      sessionSelectable: true, ocAgent: profile, modelProvider: 'openai', modelId: 'gpt-6-luna',
      corePermissionsJson: JSON.stringify({ '*': 'deny' }), systemPrompt: 'Synthetic harmless fixture. No tools.' }) });
    writeFileSync(OVERRIDE, JSON.stringify({ agent_auto_profiles: [profile], free_mode: { ...defaults.free_mode, enabled: true } }), { flag: 'wx', mode: 0o600 });
    await api('/agent-decisions/config', { method: 'PUT', body: JSON.stringify({ features: { model_routing: 'on' }, routing: { engine: 'grid', scope: 'first_prompt' } }) });
    await api('/system/refresh', { method: 'POST' });
  }, 120_000);
  afterAll(async () => {
    if (schedule) await api(`/agent-schedules/${schedule}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) }).catch(() => undefined);
    const keys = ['backend', 'remoteDataConsent', 'features', 'routing', 'tierOverrides', 'systemone', 'openaiDecisions', 'timeoutMs', 'excludedModels'];
    await api('/agent-decisions/config', { method: 'PUT', body: JSON.stringify(Object.fromEntries(keys.filter(k => k in router).map(k => [k, router[k]]))) }).catch(() => undefined);
    await control(40).catch(() => undefined);
    if (existsSync(OVERRIDE)) renameSync(OVERRIDE, `${OVERRIDE}.free-drain-retained-${Date.now()}`);
  }, 60_000);

  it('drains each pending held turn exactly once on fresh paid capacity and never sends cancelled/archived/foreign/superseded/consent-revoked turns', async () => {
    const session = async () => (await api<{ id: string }>('/agent-sessions', { method: 'POST', body: JSON.stringify({ agentId: profile,
      cwd: mkdtempSync(join(process.env.TMPDIR!, 'syntheticdrain-')), name: 'Synthetic Free drain proof', modelMode: 'auto' }) })).id;
    const tag = () => randomUUID();
    // Phase 1: every account verified exhausted -> all turns held, original input kept, nothing sent.
    await control(100); await freshUsage();
    const ids: Record<string, string> = {}, tags: Record<string, string> = {};
    for (const k of ['P', 'C', 'A', 'F', 'S1']) {
      ids[k] = k === 'S1' ? await session() : await session(); tags[k] = tag();
      expect((await prompt(ids[k], tags[k])).status, `${k} held`).toBe(502);
    }
    ids.S2 = ids.S1; tags.S2 = tag(); expect((await prompt(ids.S1, tags.S2)).status).toBe(502);
    const [c] = await held(ids.C);
    expect((await api<{ cancelled: boolean }>(`/agent-sessions/${ids.C}/held-turns/${c.id}/cancel`, { method: 'POST', body: '{}' })).cancelled).toBe(true);
    await api(`/agent-sessions/${ids.A}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) });
    const db = new Database(process.env.DB_PATH!, { fileMustExist: true });
    try { expect(db.prepare('UPDATE agent_sessions SET owner_user_id=2 WHERE id=? AND owner_user_id=1 AND name=?').run(ids.F, 'Synthetic Free drain proof').changes).toBe(1); }
    finally { db.close(); }
    expect((await held(ids.S1)).map(h => h.status)).toEqual(['superseded', 'pending']);
    expect((await held(ids.P))[0]).toMatchObject({ status: 'pending', classificationSource: 'decisions' });
    const schedTag = tag();
    schedule = (await (await fetch(`${BASE}/agent-schedules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      name: `Synthetic Free drain ${schedTag.slice(0, 8)}`, scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z', agentConfigId: profile,
      prompt: `Synthetic harmless code fixture GRID:tier3:${schedTag}` }) })).json() as { id: string }).id;
    await api(`/agent-schedules/${schedule}/trigger-now`, { method: 'POST', body: '{}' });
    await poll(async () => { const t = await api<{ lastRunStatus: string | null; nextRunAt: string | null }>(`/agent-schedules/${schedule}`);
      return t.lastRunStatus === 'queued' && Date.parse(t.nextRunAt ?? '') - Date.now() > 13 * 60_000 ? true : undefined; }, 'scheduled hold', 150_000);
    for (const k of ['P', 'C', 'A', 'F', 'S1', 'S2']) expect(await paid(tags[k]), `${k} not sent while held`).toBe(0);

    // Phase 2: fresh positive capacity; two concurrent turns observe recovery (single-flight + atomic claim).
    await control(40); await freshUsage();
    const [t1, t2] = [await session(), await session()];
    expect((await Promise.all([prompt(t1, tag()), prompt(t2, tag())])).map(r => r.status)).toEqual([202, 202]);
    await poll(async () => queue().every(d => prior.includes(d.reference)) ? true : undefined, 'Free queue drained');
    // F is now foreign to the synthetic admin: the API correctly 404s its held turns, so read F read-only.
    const status = async (k: string): Promise<Held> => {
      if (k !== 'F') return (await held(ids[k])).at(-1)!;
      const ro = new Database(process.env.DB_PATH!, { readonly: true, fileMustExist: true });
      try { return ro.prepare('SELECT id, status, reason, dispatch_id AS dispatchId FROM agent_held_turns WHERE session_id=? ORDER BY created_at DESC LIMIT 1').get(ids.F) as Held; }
      finally { ro.close(); }
    };
    expect((await fetch(`${BASE}/agent-sessions/${ids.F}/held-turns`, { headers: auth })).status).toBe(404);
    await poll(async () => (await Promise.all(['P', 'A', 'F', 'S2'].map(status))).every(h => final(h.status)) ? true : undefined, 'held turns settled');
    expect(await status('P')).toMatchObject({ status: 'dispatched' }); expect((await status('P')).dispatchId).toBeTruthy();
    expect(await status('S2')).toMatchObject({ status: 'dispatched' });
    expect(await status('C')).toMatchObject({ status: 'cancelled' });
    // Archived / foreign entries are dropped by the owner/target recheck, then resolved by the drain's own rechecks.
    expect(await status('A')).toMatchObject({ status: 'rejected', reason: 'session_unavailable' });
    expect(await status('F')).toMatchObject({ status: 'rejected', reason: 'owner_changed' });
    await poll(async () => await paid(tags.P) >= 1 && await paid(tags.S2) >= 1 ? true : undefined, 'drained turns reached the paid provider');
    expect(await classified(tags.P)).toBe(1); // classification from the hold was reused, not repeated
    // Scheduled: still-enabled task brought forward and re-run fresh by the scheduler (not a native replay).
    await poll(async () => await paid(schedTag) >= 1 ? true : undefined, 'scheduled re-run', 150_000);
    // Exactly once, even after another recovery observation.
    expect((await prompt(await session(), tag())).status).toBe(202); await pause(5000);
    for (const k of ['P', 'S2']) expect(await paid(tags[k]), `${k} exactly once`).toBe(1);
    for (const k of ['C', 'A', 'F', 'S1']) expect(await paid(tags[k]), `${k} never sent`).toBe(0);

    // Phase 3: remote-classified held turn is not sent after remote-data consent is revoked.
    await control(100); await freshUsage();
    const k = await session(), kTag = tag();
    expect((await prompt(k, kTag)).status).toBe(502);
    expect((await held(k))[0]).toMatchObject({ status: 'pending', classificationSource: 'decisions' });
    await api('/agent-decisions/config', { method: 'PUT', body: JSON.stringify({ backend: 'local', remoteDataConsent: false }) });
    await control(40); await freshUsage();
    expect((await prompt(await session(), tag())).status).toBe(202);
    await poll(async () => final((await held(k))[0].status) ? true : undefined, 'consent case settled');
    expect((await held(k))[0]).toMatchObject({ status: 'rejected', reason: 'consent_revoked' });
    await pause(3000); expect(await paid(kTag)).toBe(0);
    console.info(JSON.stringify({ caseId: 'FREE-D1-D4', heldWithInput: true, drainedExactlyOnce: true, classificationReused: true,
      cancelledNotSent: true, archivedNotSent: true, foreignNotSent: true, supersededNotSent: true, consentRevokedNotSent: true, scheduledReRun: true }));
  }, 600_000);
});
