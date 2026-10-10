/**
 * F3 structured-extraction through the REAL API (running sandbox API + engine, transport guard preloaded):
 * POST /agent-free/extractions -> server-side registry/opt-in/Free Mode gates -> API fetch through the guard to the
 * fake loopback scripted provider (127.0.0.1:7481, public synthetic bearer) -> independent verifier -> response.
 * Opt-in: RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_FREE_EXTRACTION_API=1. Synthetic test-owned public sources only.
 * Operator files are created exclusively and renamed aside afterwards (never deleted).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import defaults from '../services/decision/router_grid.default.json';
import { FREE_EXTRACTION_SYSTEM } from '../services/decision/router_free_extraction';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_LIVE_FREE_EXTRACTION_API === '1';
const ROOT = '/private/tmp/sdmr-grid-sandbox';
const APP = `${ROOT}/home/Library/Application Support/Rhythm`;
const OVERRIDE = `${APP}/router-grid.json`, OPERATOR = `${APP}/router-free-extraction.json`, STATE = `${APP}/router-free-state.json`;
const BASE = 'http://127.0.0.1:4398', GRID = 'http://127.0.0.1:7482', PROVIDER = 'http://127.0.0.1:7481';
const MODEL = 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free';
const auth = { authorization: 'Bearer e02-synthetic-session-not-a-secret', 'content-type': 'application/json' };
const FIELDS = [{ name: 'event', type: 'string', required: true }, { name: 'price', type: 'number', required: true }];
const text = (tag: string) => `SDMRX:${tag} Harvest Fair on Saturday. Admission is $12 for adults.`;
const span = (src: string, s: string) => ({ start: src.indexOf(s), end: src.indexOf(s) + s.length });
const pause = (ms = 250) => new Promise(r => setTimeout(r, ms));
let provider: ChildProcess | undefined;
const post = (body: unknown) => fetch(`${BASE}/agent-free/extractions`, { method: 'POST', headers: auth, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
const extract = async (body: unknown) => { const r = await post(body); expect(r.status).toBe(200); return r.json() as Promise<Record<string, unknown>>; };
const calls = async (tag: string) => ((await (await fetch(`${PROVIDER}/_sdmr/requests`)).json()) as Array<{ lastUserText: string; systemText: string; messageCount: number; body: { model: string; stream: boolean } }>)
  .filter(r => r.lastUserText.includes(`SDMRX:${tag}`));
const register = (tag: string, content: string) => fetch(`${PROVIDER}/_sdmr/reply/${tag}`, { method: 'POST', body: JSON.stringify({ content }) });
const usage = (used: number) => fetch(`${GRID}/_grid/control`, { method: 'POST', headers: { authorization: '' }, body: JSON.stringify({ unknown: false, fail429: [], malformed: false,
  usage: Object.fromEntries(['openai-a', 'openai-b', 'anthropic-a', 'anthropic-b'].map(a => [a, { five: used, week: used }])) }) });
async function freshUsage() { const t = Date.now(); const r = await (await fetch(`${BASE}/agents/usage-budget?force=true`, { headers: auth })).json() as { fetchedAt: string }; expect(Date.parse(r.fetchedAt)).toBeGreaterThanOrEqual(t - 1000); }
const optIn = (enabled: boolean) => fetch(`${BASE}/agent-free/extraction/opt-in`, { method: 'PUT', headers: auth, body: JSON.stringify({ enabled }) });
const daily = () => (JSON.parse(readFileSync(STATE, 'utf8')) as { dailyCount: number }).dailyCount;
const sessions = () => { const db = new Database(process.env.DB_PATH!, { readonly: true, fileMustExist: true }); try { return (db.prepare('SELECT COUNT(*) AS n FROM agent_sessions').get() as { n: number }).n; } finally { db.close(); } };
const tags = { good: 'apigood', bad: 'apibad', self: 'apiself', leaky: 'apileaky' };

(LIVE ? describe : describe.skip)('F3 Free structured extraction through the real API', () => {
  beforeAll(async () => {
    expect(process.env.HOME).toBe(`${ROOT}/home`);
    expect(existsSync(OVERRIDE) || existsSync(OPERATOR), 'no pre-existing operator files').toBe(false);
    provider = spawn(process.execPath, [join(__dirname, 'fixtures/scripted_openai_provider_sdmr.mjs')], { env: { ...process.env, RHYTHM_SDMR_PROVIDER_PORT: '7481' }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { if (await fetch(`${PROVIDER}/health`).then(r => r.ok, () => false)) return; await pause(200); }
    throw new Error('provider not ready');
  }, 30_000);
  afterAll(async () => {
    await optIn(false).catch(() => undefined);
    await usage(40).catch(() => undefined);
    for (const f of [OVERRIDE, OPERATOR]) if (existsSync(f)) renameSync(f, `${f}.free-extraction-api-retained-${Date.now()}`);
    provider?.kill('SIGTERM');
  }, 60_000);

  it('server-side provenance gates, independent verifier release/rejection, zero calls when held', async () => {
    const sessionsBefore = sessions();
    // Default product state: Free disabled, no operator registry.
    expect(await extract({ publicSourceId: 'fair_good', fields: FIELDS })).toEqual({ kind: 'held', reason: 'disabled' });
    writeFileSync(OVERRIDE, JSON.stringify({ free_mode: { ...defaults.free_mode, enabled: true } }), { flag: 'wx', mode: 0o600 });
    writeFileSync(OPERATOR, JSON.stringify({ version: 1, endpoint: { baseUrl: `${PROVIDER}/v1`, authProvider: 'sdmr' }, qualifiedFreeModels: [MODEL],
      publicSources: [{ id: 'fair_good', label: 'Synthetic public flyer', text: text(tags.good) }, { id: 'fair_bad', label: 'Synthetic public flyer', text: text(tags.bad) },
        { id: 'fair_self', label: 'Synthetic public flyer', text: text(tags.self) },
        { id: 'leaky', label: 'Operator mistake', text: `SDMRX:${tags.leaky} Contact jane.synthetic@example.test about the fair.` }] }), { flag: 'wx', mode: 0o600 });
    expect(((await (await fetch(`${BASE}/agent-free/extraction/sources`, { headers: auth })).json()) as { sources: Array<{ id: string }> }).sources.map(s => s.id))
      .toEqual(['fair_good', 'fair_bad', 'fair_self', 'leaky']);
    // No stored owner opt-in -> privacy hold even with a trusted registry source.
    expect((await (await optIn(false)).json())).toEqual({ enabled: false });
    expect(await extract({ publicSourceId: 'fair_good', fields: FIELDS })).toEqual({ kind: 'held', reason: 'privacy' });
    expect((await optIn(true)).status).toBe(200);
    // Paid capacity available (fresh positive usage) -> no Free call.
    await usage(40); await freshUsage();
    expect(await extract({ publicSourceId: 'fair_good', fields: FIELDS })).toEqual({ kind: 'held', reason: 'paid_capacity_available' });
    // Free Mode active: all four synthetic subscription accounts verified exhausted.
    await usage(100); await freshUsage();
    for (const extra of [{ sourceText: 'x' }, { ownerOptIn: true }, { publicSource: { trusted: true, label: 'x' } }, { context: {} }]) {
      const r = await post({ publicSourceId: 'fair_good', fields: FIELDS, ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await extract({ publicSourceId: 'not_registered', fields: FIELDS })).toEqual({ kind: 'held', reason: 'unknown_public_source' });
    expect(await extract({ publicSourceId: 'leaky', fields: FIELDS })).toEqual({ kind: 'held', reason: 'privacy' });
    expect(await extract({ publicSourceId: 'fair_good', fields: [{ name: 'admin@example.invalid', type: 'string', required: true }] })).toEqual({ kind: 'held', reason: 'privacy' });
    expect(await extract({ publicSourceId: 'fair_good', fields: 'event' })).toEqual({ kind: 'held', reason: 'privacy' });
    expect((await calls(tags.good)).length + (await calls(tags.leaky)).length).toBe(0);
    const before = daily();
    // Verified output released.
    const good = text(tags.good);
    await register(tags.good, JSON.stringify({ event: { value: 'Harvest Fair', ...span(good, 'Harvest Fair') }, price: { value: 12, ...span(good, '$12') } }));
    expect(await extract({ publicSourceId: 'fair_good', fields: FIELDS })).toMatchObject({ kind: 'released', model: MODEL, values: { event: 'Harvest Fair', price: 12 } });
    const [req] = await calls(tags.good);
    expect(req).toMatchObject({ systemText: FREE_EXTRACTION_SYSTEM, messageCount: 2, body: { stream: false, model: 'nvidia/nemotron-3-ultra-550b-a55b:free' } });
    expect(req.lastUserText).toBe(`Fields: event (string, required); price (number, required)\nSource:\n${good}`);
    // Wrong value and a self-reported PASS are rejected; nothing is released.
    const bad = text(tags.bad);
    await register(tags.bad, JSON.stringify({ event: { value: 'Spring Gala', ...span(bad, 'Harvest Fair') }, price: { value: 12, ...span(bad, '$12') } }));
    const rejected = await extract({ publicSourceId: 'fair_bad', fields: FIELDS });
    expect(rejected).toMatchObject({ kind: 'rejected', checks: expect.arrayContaining(['value_mismatch:event']) }); expect(rejected).not.toHaveProperty('values');
    await register(tags.self, 'PASS - verified by model');
    expect(await extract({ publicSourceId: 'fair_self', fields: FIELDS })).toMatchObject({ kind: 'rejected', checks: ['output_not_json'] });
    expect(daily() - before).toBe(3); // exactly the three attempted Free calls were counted
    expect(sessions()).toBe(sessionsBefore); // no agent/engine session was created for Free extraction
    console.info(JSON.stringify({ caseId: 'FREE-F3-API', defaultDisabled: true, optInRequired: true, paidCapacityHolds: true, clientProvenanceRejected: true,
      privateHeldZeroCalls: true, verifiedReleased: true, wrongRejected: true, selfReportRejected: true, countedCalls: 3, engineSessionsCreated: 0 }));
  }, 180_000);
});
