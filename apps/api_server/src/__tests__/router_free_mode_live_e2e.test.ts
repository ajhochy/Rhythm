/**
 * Free Mode F1/F2 live proof on the isolated grid sandbox (real API + fork engine, fake loopback
 * providers behind the grid transport guard). Opt-in: RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_FREE_MODE=1.
 * Writes only synthetic sandbox state: a router-grid.json override (renamed aside afterwards, never
 * deleted) and fake usage controls. Never clears cooldowns, captures, ledgers or sessions.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import defaults from '../services/decision/router_grid.default.json';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_LIVE_FREE_MODE === '1';
const ROOT = '/private/tmp/sdmr-grid-sandbox';
const APP = `${ROOT}/home/Library/Application Support/Rhythm`;
const OVERRIDE = `${APP}/router-grid.json`, STATE = `${APP}/router-free-state.json`;
const BASE = 'http://127.0.0.1:4398', PROVIDER = 'http://127.0.0.1:7482';
const auth = { authorization: 'Bearer e02-synthetic-session-not-a-secret', 'content-type': 'application/json' };
const HOLD = 'Paid model capacity is exhausted. This request was not sent; it is held until paid capacity returns.';
type Capture = { turnTag?: string; accountLabel?: string; HTTPstatus?: number };
const pause = (ms = 250) => new Promise(r => setTimeout(r, ms));
async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { ...auth, ...init.headers }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${r.status}`);
  const text = await r.text(); return (text ? JSON.parse(text) : undefined) as T;
}
async function poll<T>(read: () => Promise<T | undefined>, label: string, ms = 90_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await read(); if (v !== undefined) return v; await pause(); }
  throw new Error(`${label} timed out`);
}
const captures = async (tag: string) => ((await (await fetch(`${PROVIDER}/_grid/evidence`)).json()) as { captures: Capture[] }).captures.filter(c => c.turnTag === tag);
// usage = fake provider used_percent (100 = known zero headroom).
const control = (usage: number) => fetch(`${PROVIDER}/_grid/control`, { method: 'POST', headers: { authorization: '' }, body: JSON.stringify({
  unknown: false, fail429: [], malformed: false,
  usage: Object.fromEntries(['openai-a', 'openai-b', 'anthropic-a', 'anthropic-b'].map(a => [a, { five: usage, week: usage }])) }) });
async function freshUsage() {
  const started = Date.now();
  const usage = await api<{ fetchedAt: string }>('/agents/usage-budget?force=true');
  expect(Date.parse(usage.fetchedAt)).toBeGreaterThanOrEqual(started - 1000);
}
const queue = () => existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as { queue: Array<{ taskId: string; ownerUserId: string; reference: string; classification: Record<string, unknown> }> }).queue : [];
const prompt = (id: string, text: string) => fetch(`${BASE}/agent-sessions/${id}/prompt`, { method: 'POST', headers: auth, body: JSON.stringify({ prompt: text }), signal: AbortSignal.timeout(60_000) });
let profile = '', schedule = '', priorFeatures: Record<string, string> = {}, prior: string[] = [];
const added = () => queue().filter(d => !prior.includes(d.reference));

(LIVE ? describe : describe.skip)('Free Mode F1/F2 live (synthetic grid sandbox)', () => {
  beforeAll(async () => {
    expect(process.env.HOME).toBe(`${ROOT}/home`); expect(process.env.TMPDIR).toBe(`${ROOT}/tmp`);
    expect(existsSync(OVERRIDE), 'no pre-existing grid override').toBe(false);
    // Held descriptors retained from earlier synthetic runs stay queued; this run asserts only its own.
    prior = queue().map(d => d.reference);
    expect(prior.every(r => r.startsWith('session:')), 'only retained synthetic session holds').toBe(true);
    priorFeatures = (await api<{ features: Record<string, string> }>('/agent-decisions/config')).features;
    profile = `syntheticfree-${randomUUID().slice(0, 8)}`;
    await api('/agent-configs', { method: 'POST', body: JSON.stringify({ id: profile, label: profile, isAgent: true, enabled: true,
      sessionSelectable: true, ocAgent: profile, modelProvider: 'openai', modelId: 'gpt-6-luna',
      corePermissionsJson: JSON.stringify({ '*': 'deny' }), systemPrompt: 'Synthetic harmless fixture. No tools.' }) });
    writeFileSync(OVERRIDE, JSON.stringify({ agent_auto_profiles: [profile], free_mode: { ...defaults.free_mode, enabled: true } }), { flag: 'wx', mode: 0o600 });
    await api('/agent-decisions/config', { method: 'PUT', body: JSON.stringify({ features: { model_routing: 'on' }, routing: { engine: 'grid', scope: 'first_prompt' } }) });
    await api('/system/refresh', { method: 'POST' });
  }, 120_000);
  afterAll(async () => {
    if (schedule) await api(`/agent-schedules/${schedule}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) }).catch(() => undefined);
    await api('/agent-decisions/config', { method: 'PUT', body: JSON.stringify({ features: priorFeatures }) }).catch(() => undefined);
    await control(40).catch(() => undefined);
    if (existsSync(OVERRIDE)) renameSync(OVERRIDE, `${OVERRIDE}.free-live-retained-${Date.now()}`);
  }, 60_000);

  it('holds desktop and scheduled work with zero model calls, then releases on fresh positive capacity and reuses the classification', async () => {
    const dailyBefore = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as { dailyCount: number }).dailyCount : 0;
    await control(100); await freshUsage();
    const session = async () => (await api<{ id: string }>('/agent-sessions', { method: 'POST', body: JSON.stringify({ agentId: profile,
      cwd: mkdtempSync(join(process.env.TMPDIR!, 'syntheticfree-')), name: 'Synthetic Free proof', modelMode: 'auto' }) })).id;
    // F1 desktop path (REST prompt -> ws_gateway): refused before dispatch, only the paid classifier ran.
    const heldId = await session(), heldTag = randomUUID();
    const refused = await prompt(heldId, `Synthetic harmless code fixture GRID:tier3:${heldTag}`);
    expect(refused.status).toBe(502);
    expect(((await refused.json()) as { error?: { message?: string } }).error?.message).toBe(HOLD);
    await pause(1500);
    const heldCaptures = await captures(heldTag);
    expect(heldCaptures.length).toBe(1); expect(heldCaptures[0].accountLabel).toBe('classifier');
    expect(added()).toEqual([expect.objectContaining({ taskId: `session:${heldId}`, reference: `session:${heldId}`,
      classification: expect.objectContaining({ containsPrivateData: 'unknown' }) })]);
    expect(readFileSync(STATE, 'utf8')).not.toContain(heldTag);
    // Holding commits no Free call (other suites may have counted genuine Free calls earlier today).
    expect(JSON.parse(readFileSync(STATE, 'utf8')).dailyCount).toBe(dailyBefore);
    // F1 scheduled path: capacity deferral (queued, ~15 min), no run-history row, no model request.
    const schedTag = randomUUID();
    schedule = (await (await fetch(`${BASE}/agent-schedules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      name: `Synthetic Free ${schedTag.slice(0, 8)}`, scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z', agentConfigId: profile,
      prompt: `Synthetic harmless code fixture GRID:tier3:${schedTag}` }) })).json() as { id: string }).id;
    await api(`/agent-schedules/${schedule}/trigger-now`, { method: 'POST', body: '{}' });
    const task = await poll(async () => { const t = await api<{ lastRunStatus: string | null; nextRunAt: string | null }>(`/agent-schedules/${schedule}`);
      // trigger-now itself stamps 'queued' for the immediate run; wait for the runner's 15-minute deferral.
      return t.lastRunStatus === 'queued' && Date.parse(t.nextRunAt ?? '') - Date.now() > 13 * 60_000 ? t : undefined; }, 'scheduled capacity deferral', 150_000);
    expect(Date.parse(task.nextRunAt!) - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    expect(await api<unknown[]>(`/agent-schedules/${schedule}/runs`)).toEqual([]);
    expect((await captures(schedTag)).every(c => c.accountLabel === 'classifier')).toBe(true);
    expect(added().map(d => d.reference).sort()).toEqual([`scheduled:${schedule}`, `session:${heldId}`].sort());
    // F2 idle recovery: fresh positive usage event releases/drains with NO new routed turn.
    const capturesBeforeRecovery = (await (await fetch(`${PROVIDER}/_grid/evidence`)).json() as { captures: Capture[] }).captures.length;
    await control(40); await freshUsage();
    await poll(async () => queue().length === 0 ? true : undefined, 'Free queue released from fresh usage event');
    // D3 (supersedes the r10 notify-and-resend release): the held turn itself drains automatically, once,
    // reusing the hold-time classification.
    await poll(async () => (await captures(heldTag)).some(c => c.accountLabel !== 'classifier' && c.HTTPstatus === 200) ? true : undefined, 'held turn drained');
    expect((await captures(heldTag)).filter(c => c.accountLabel === 'classifier')).toHaveLength(1);
    const capturesAfterRecovery = ((await (await fetch(`${PROVIDER}/_grid/evidence`)).json()) as { captures: Capture[] }).captures.length;
    expect(capturesAfterRecovery).toBeGreaterThan(capturesBeforeRecovery); // drained held/scheduled work, no trigger turn
    // A later turn in the drained session still dispatches normally on paid capacity.
    const resendTag = randomUUID();
    expect((await prompt(heldId, `Synthetic harmless code fixture GRID:tier3:${resendTag}`)).status).toBe(202);
    await poll(async () => (await captures(resendTag)).some(c => c.accountLabel !== 'classifier' && c.HTTPstatus === 200) ? true : undefined, 'resend dispatched');
    // After D3 the held turn consumed its stored classification; a resend is a new turn (classified only if no route was applied).
    console.info(JSON.stringify({ caseId: 'FREE-F1F2', desktopHeld: true, scheduledDeferred: true, zeroModelCalls: true,
      bodyFreeDescriptor: true, releasedOnFreshCapacity: true, classificationReused: true }));
  }, 300_000);
});
