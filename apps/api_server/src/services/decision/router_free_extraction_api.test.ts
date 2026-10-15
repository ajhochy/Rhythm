import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { defaultRouterGridConfig } from './router_grid_config';
import { resetFreeStoreForTests } from './router_free_runtime';
import { FREE_EXTRACTION_SYSTEM } from './router_free_extraction';
import { FreeOptInRepository, loadFreeExtractionOperatorConfig, runFreeExtractionRequest, type FreeExtractionApiDeps } from './router_free_extraction_api';

// Test-owned synthetic public sources only.
const TEXT = 'Harvest Fair on Saturday. Admission is $12 for adults.';
const MODEL = 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free';
const at = (s: string) => ({ start: TEXT.indexOf(s), end: TEXT.indexOf(s) + s.length });
const GOOD = JSON.stringify({ event: { value: 'Harvest Fair', ...at('Harvest Fair') }, price: { value: 12, ...at('$12') } });
const FIELDS = [{ name: 'event', type: 'string', required: true }, { name: 'price', type: 'number', required: true }];
let db: Database.Database, prev: Database.Database | null, dir: string, saved: string | undefined;
const enabled = () => { const c = defaultRouterGridConfig(); c.free_mode = { ...c.free_mode, enabled: true }; return c; };
function operator(over: Record<string, unknown> = {}) {
  const path = join(dir, 'router-free-extraction.json');
  writeFileSync(path, JSON.stringify({ version: 1, endpoint: { baseUrl: 'http://127.0.0.1:1/v1', authProvider: 'synthetic' },
    qualifiedFreeModels: [MODEL], publicSources: [{ id: 'fair', label: 'Synthetic public flyer', text: TEXT },
      { id: 'leaky', label: 'Operator mistake', text: 'Contact jane.synthetic@example.test about the fair.' }], ...over }));
  return path;
}
const reply = (content: string) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
function deps(over: Partial<FreeExtractionApiDeps> = {}): FreeExtractionApiDeps & { fetchImpl: ReturnType<typeof reply> } {
  return { loadConfig: enabled, operatorPath: 'operatorPath' in over ? over.operatorPath : operator(), optIns: { get: async () => true }, freeMode: async () => ({ enabled: true, active: true, recovered: false, trace: [] }),
    apiKey: () => 'synthetic', fetchImpl: reply(GOOD), ...over } as FreeExtractionApiDeps & { fetchImpl: ReturnType<typeof reply> };
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'free-api-')); saved = process.env.RHYTHM_DECISION_ROUTER_FILE;
  process.env.RHYTHM_DECISION_ROUTER_FILE = join(dir, 'decision-router.json'); resetFreeStoreForTests();
  db = new Database(':memory:'); runMigrations(db); prev = setDb(db);
});
afterEach(() => { setDb(prev); db.close(); if (saved === undefined) delete process.env.RHYTHM_DECISION_ROUTER_FILE; else process.env.RHYTHM_DECISION_ROUTER_FILE = saved; resetFreeStoreForTests(); });

describe('Free structured-extraction entry point: server-side provenance', () => {
  it('releases only verified values from the registry source; request is public-only', async () => {
    const d = deps();
    expect(await runFreeExtractionRequest(1, { publicSourceId: 'fair', fields: FIELDS }, d)).toMatchObject({ kind: 'released', model: MODEL, values: { event: 'Harvest Fair', price: 12 } });
    const body = JSON.parse((d.fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages).toEqual([{ role: 'system', content: FREE_EXTRACTION_SYSTEM },
      { role: 'user', content: `Fields: event (string, required); price (number, required)\nSource:\n${TEXT}` }]);
  });
  it.each([
    ['client sourceText', { publicSourceId: 'fair', fields: FIELDS, sourceText: 'x' }, 'client_field_not_accepted:sourceText'],
    ['client opt-in boolean', { publicSourceId: 'fair', fields: FIELDS, ownerOptIn: true }, 'client_field_not_accepted:ownerOptIn'],
    ['client public flag', { publicSourceId: 'fair', fields: FIELDS, publicSource: { trusted: true, label: 'x' } }, 'client_field_not_accepted:publicSource'],
    ['client context', { publicSourceId: 'fair', fields: FIELDS, context: {} }, 'client_field_not_accepted:context'],
    ['bad source id', { publicSourceId: '../x', fields: FIELDS }, 'invalid_public_source_id'],
    ['not an object', 'fair', 'body_not_object'],
  ])('%s is rejected before anything else', async (_l, body, reason) => {
    const d = deps();
    expect(await runFreeExtractionRequest(1, body, d)).toEqual({ kind: 'invalid_request', reason });
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    ['default config (disabled)', { loadConfig: defaultRouterGridConfig }, 'disabled'],
    ['no operator registry', { operatorPath: join(mkdtempSync(join(tmpdir(), 'none-')), 'absent.json') }, 'not_configured'],
    ['operator http non-loopback endpoint', { operatorPath: '' }, 'operator_config_invalid'],
    ['unknown registry id', {}, 'unknown_public_source', 'missing'],
    ['no stored owner opt-in', { optIns: { get: async () => false } }, 'privacy'],
    ['registry text with an email', {}, 'privacy', 'leaky'],
    ['email as field name', {}, 'privacy', 'fair', [{ name: 'admin@example.invalid', type: 'string', required: true }]],
    ['malformed fields', {}, 'privacy', 'fair', 'event'],
    ['paid capacity still available', { freeMode: async () => ({ enabled: true, active: false, recovered: false, trace: [] }) }, 'paid_capacity_available'],
    ['no credential', { apiKey: () => null }, 'no_credential'],
    ['no qualified free model', { operatorPath: '' }, 'no_available_model'],
  ] as const)('%s: held with zero provider calls', async (label, over, reason, id = 'fair', fields: unknown = FIELDS) => {
    const o: Partial<FreeExtractionApiDeps> = { ...over };
    if (label === 'operator http non-loopback endpoint') o.operatorPath = operator({ endpoint: { baseUrl: 'http://example.test/v1', authProvider: 'synthetic' } });
    if (label === 'no qualified free model') o.operatorPath = operator({ qualifiedFreeModels: [] });
    const d = deps(o);
    expect(await runFreeExtractionRequest(1, { publicSourceId: id, fields }, d)).toMatchObject({ kind: 'held', reason });
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });
  it('wrong and self-reported outputs are rejected and never released', async () => {
    for (const content of [JSON.stringify({ event: { value: 'Spring Gala', ...at('Harvest Fair') }, price: { value: 12, ...at('$12') } }), 'PASS: verified']) {
      const r = await runFreeExtractionRequest(1, { publicSourceId: 'fair', fields: FIELDS }, deps({ fetchImpl: reply(content) }));
      expect(r.kind).toBe('rejected'); expect(r).not.toHaveProperty('values');
    }
  });
  it('operator registry fails closed on unknown models, bad ids and extra keys', () => {
    for (const over of [{ qualifiedFreeModels: ['openrouter/made-up:free'] }, { publicSources: [{ id: 'Bad Id', label: 'x', text: 'y' }] },
      { publicSources: [{ id: 'a', label: 'x', text: 'y', private: false }] }, { trustedByClient: true }]) {
      expect(loadFreeExtractionOperatorConfig(enabled(), operator(over)).kind).toBe('invalid');
    }
  });
  it('owner opt-in is stored per authenticated owner and defaults to off', async () => {
    const repo = new FreeOptInRepository();
    expect(await repo.get(1)).toBe(false);
    await repo.set(1, true); expect(await repo.get(1)).toBe(true); expect(await repo.get(2)).toBe(false);
    await repo.set(1, false); expect(await repo.get(1)).toBe(false);
  });
});
