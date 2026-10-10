import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { adaptRouterFreeConfig } from './router_free_config';
import { RouterFreeStateStore } from './router_free_state';
import { defaultRouterGridConfig } from './router_grid_config';
import { executeFreeExtraction, freeExecutionAllowed, FREE_EXTRACTION_SYSTEM, publicContextPreflight, verifyExtraction, type ExtractionTask } from './router_free_extraction';

// Test-owned labelled synthetic examples only (no real corpus, users or contacts).
const SOURCE = 'Harvest Fair on Saturday. Doors open at 9am. Admission is $12 for adults.';
const task = (over: Partial<ExtractionTask> = {}): ExtractionTask => ({ kind: 'structured_extraction', taskId: 'synthetic-1', sourceText: SOURCE,
  fields: [{ name: 'event', type: 'string', required: true }, { name: 'price', type: 'number', required: true }],
  publicSource: { trusted: true, label: 'synthetic public flyer' }, ownerOptIn: true, attachments: [],
  context: { memory: false, dayflow: false, history: false, profilePrompt: false }, ...over });
const at = (s: string) => ({ start: SOURCE.indexOf(s), end: SOURCE.indexOf(s) + s.length });
const GOOD = JSON.stringify({ event: { value: 'Harvest Fair', ...at('Harvest Fair') }, price: { value: 12, ...at('$12') } });
const enabled = () => { const c = defaultRouterGridConfig(); c.free_mode = { ...c.free_mode, enabled: true }; return c; };
const MODEL = 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free';
function store(config = enabled()) {
  return new RouterFreeStateStore({ statePath: join(mkdtempSync(join(tmpdir(), 'free-x-')), 'state.json'), clock: Date.now, config: adaptRouterFreeConfig(config).state });
}
const reply = (content: string, status = 200) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));

describe('F3 public-context preflight (labelled synthetic examples)', () => {
  it.each([
    ['trusted public + opt-in + no context', {}, false],
    ['scanner silence without trusted source stays unknown', { publicSource: null }, 'unknown'],
    ['no owner opt-in', { ownerOptIn: false }, 'unknown'],
    ['uninspected attachment', { attachments: [{ type: 'file' }] }, 'unknown'],
    ['memory context', { context: { memory: true, dayflow: false, history: false, profilePrompt: false } }, 'unknown'],
    ['Dayflow context', { context: { memory: false, dayflow: true, history: false, profilePrompt: false } }, 'unknown'],
    ['private history', { context: { memory: false, dayflow: false, history: true, profilePrompt: false } }, 'unknown'],
    ['user-bearing profile prompt', { context: { memory: false, dayflow: false, history: false, profilePrompt: true } }, 'unknown'],
    ['email even with trusted source', { sourceText: 'Contact jane.synthetic@example.test about the fair.' }, true],
    ['phone', { sourceText: 'Call (555) 010-4477 for tickets.' }, true],
    ['secret token', { sourceText: 'Use key sk-synthetic0123456789abcdef to sign in.' }, true],
    ['private key header', { sourceText: '-----BEGIN RSA PRIVATE KEY-----' }, true],
    ['home path', { sourceText: 'Saved at /Users/someone/notes.txt' }, true],
  ] as const)('%s', (_l, over, expected) => {
    expect(publicContextPreflight(task(over as Partial<ExtractionTask>)).privacy).toBe(expected);
  });
});

// Every outbound surface and malformed/unknown shapes (independent probe finding: field names were not scanned).
const PROBE = (fieldName: string): ExtractionTask => task({ sourceText: 'Public fixture item costs 42.', fields: [{ name: fieldName, type: 'string', required: true }] });
const ctx = { memory: false, dayflow: false, history: false, profilePrompt: false };
const negatives: Array<[string, unknown, true | 'unknown']> = [
  ['probe: synthetic email as field name', PROBE('admin@example.invalid'), true],
  ['secret token as field name', PROBE('sk-synthetic0123456789abcdef'), true],
  ['home path as field name', PROBE('/Users/someone/notes'), true],
  ['phone as field type text', task({ fields: [{ name: 'event', type: '(555) 010-4477' as never, required: true }] }), true],
  ['free-text field name (untrusted schema)', PROBE('Customer Name'), 'unknown'],
  ['field name too long', PROBE('a'.repeat(41)), 'unknown'],
  ['duplicate field names', task({ fields: [{ name: 'event', type: 'string', required: true }, { name: 'event', type: 'string', required: false }] }), 'unknown'],
  ['unsupported field type', task({ fields: [{ name: 'event', type: 'date' as never, required: true }] }), 'unknown'],
  ['extra field key carrying text', task({ fields: [{ name: 'event', type: 'string', required: true, description: 'anything' } as never] }), 'unknown'],
  ['empty fields', task({ fields: [] }), 'unknown'],
  ['fields not an array', { ...task(), fields: 'event' }, 'unknown'],
  ['omitted context', { ...task(), context: undefined }, 'unknown'],
  ['null context', { ...task(), context: null }, 'unknown'],
  ['context missing a key', { ...task(), context: { memory: false, dayflow: false, history: false } }, 'unknown'],
  ['context with unknown key', { ...task(), context: { ...ctx, pcoContacts: false } }, 'unknown'],
  ['context value not boolean false', { ...task(), context: { ...ctx, memory: 'false' } }, 'unknown'],
  ['attachments not an array', { ...task(), attachments: undefined }, 'unknown'],
  ['malformed public source', { ...task(), publicSource: { trusted: 'yes', label: 'x' } }, 'unknown'],
  ['owner opt-in not literally true', { ...task(), ownerOptIn: 'true' }, 'unknown'],
  ['unknown task kind', { ...task(), kind: 'open_ended_writing' }, 'unknown'],
  ['empty source', task({ sourceText: '   ' }), 'unknown'],
  ['oversized source', task({ sourceText: 'a'.repeat(20_001) }), 'unknown'],
  ['not an object', null, 'unknown'],
];
describe('F3 preflight scans every outbound surface and fails closed on malformed tasks', () => {
  it.each(negatives)('%s', (_l, value, expected) => {
    expect(publicContextPreflight(value as ExtractionTask).privacy).toBe(expected);
  });
  it('every negative is held for privacy with zero provider calls and nothing reserved or counted', async () => {
    const f = reply(GOOD), s = store();
    for (const [label, value] of negatives) {
      expect(await executeFreeExtraction(value as ExtractionTask, { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'synthetic',
        verifiedFreeModels: new Set([MODEL]), config: enabled(), store: s, fetchImpl: f }), label).toEqual({ kind: 'held', reason: 'privacy' });
    }
    expect(f).not.toHaveBeenCalled();
    expect(s.usage()).toMatchObject({ dailyCount: 0, reservedCalls: 0 });
  });
});

describe('F3 structured-extraction verifier (independent recomputation)', () => {
  it('passes only exact source offsets and values', () => {
    expect(verifyExtraction(task(), GOOD)).toMatchObject({ pass: true, values: { event: 'Harvest Fair', price: 12 } });
  });
  it.each([
    ['hallucinated value not in source', JSON.stringify({ event: { value: 'Spring Gala', ...at('Harvest Fair') }, price: { value: 12, ...at('$12') } }), 'value_mismatch:event'],
    ['right value, wrong offsets', JSON.stringify({ event: { value: 'Harvest Fair', start: 1, end: 13 }, price: { value: 12, ...at('$12') } }), 'value_mismatch:event'],
    ['wrong number', JSON.stringify({ event: { value: 'Harvest Fair', ...at('Harvest Fair') }, price: { value: 15, ...at('$12') } }), 'number_mismatch:price'],
    ['number span is not a number', JSON.stringify({ event: { value: 'Harvest Fair', ...at('Harvest Fair') }, price: { value: 12, ...at('adults') } }), 'number_mismatch:price'],
    ['missing required field', JSON.stringify({ event: { value: 'Harvest Fair', ...at('Harvest Fair') } }), 'missing:price'],
    ['extra field', JSON.stringify({ event: { value: 'Harvest Fair', ...at('Harvest Fair') }, price: { value: 12, ...at('$12') }, note: 'x' }), 'unexpected_field:note'],
    ['out of bounds', JSON.stringify({ event: { value: 'x', start: 0, end: 9999 }, price: { value: 12, ...at('$12') } }), 'bounds:event'],
    ['not JSON / self-reported PASS', 'PASS: verified', 'output_not_json'],
  ])('%s is rejected', (_l, output, check) => {
    const r = verifyExtraction(task(), output); expect(r.pass).toBe(false); expect(r.checks).toContain(check);
  });
  it('registry gate: only provably public tasks of a registered kind', () => {
    const c = { tier: 3 as const, category: 'knowledge' as const, canQueue: false };
    expect(freeExecutionAllowed({ ...c, containsPrivateData: false }, 'structured_extraction')).toBe(true);
    expect(freeExecutionAllowed({ ...c, containsPrivateData: 'unknown' }, 'structured_extraction')).toBe(false);
    expect(freeExecutionAllowed({ ...c, containsPrivateData: false }, 'open_ended_writing')).toBe(false);
  });
});

describe('F3 Free extraction executor (stubbed transport; no network)', () => {
  const base = { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'synthetic', verifiedFreeModels: new Set([MODEL]) };
  it('disabled config, unknown privacy, or no verified model: held, zero calls', async () => {
    const f = reply(GOOD);
    expect(await executeFreeExtraction(task(), { ...base, config: defaultRouterGridConfig(), store: store(), fetchImpl: f })).toEqual({ kind: 'held', reason: 'disabled' });
    expect(await executeFreeExtraction(task({ ownerOptIn: false }), { ...base, config: enabled(), store: store(), fetchImpl: f })).toEqual({ kind: 'held', reason: 'privacy' });
    expect(await executeFreeExtraction(task(), { ...base, verifiedFreeModels: new Set(), config: enabled(), store: store(), fetchImpl: f })).toMatchObject({ kind: 'held' });
    expect(f).not.toHaveBeenCalled();
  });
  it('verified output is released; public-only request; one counted call; lease released', async () => {
    const f = reply(GOOD); const s = store();
    const r = await executeFreeExtraction(task(), { ...base, config: enabled(), store: s, fetchImpl: f });
    expect(r).toMatchObject({ kind: 'released', model: MODEL, values: { event: 'Harvest Fair', price: 12 } });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages).toHaveLength(2); expect(body.messages[0].content).toBe(FREE_EXTRACTION_SYSTEM);
    expect(body.stream).toBe(false); expect(body.model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
    expect(s.usage()).toMatchObject({ dailyCount: 1, reservedCalls: 0 });
  });
  it('wrong output is rejected and never released; provider failure opens circuit accounting', async () => {
    const bad = JSON.stringify({ event: { value: 'Spring Gala', ...at('Harvest Fair') }, price: { value: 12, ...at('$12') } });
    const r = await executeFreeExtraction(task(), { ...base, config: enabled(), store: store(), fetchImpl: reply(bad) });
    expect(r.kind).toBe('rejected'); expect(r).not.toHaveProperty('values');
    const s = store();
    for (let i = 0; i < 3; i++) await executeFreeExtraction(task(), { ...base, config: enabled(), store: s, fetchImpl: reply('', 503) });
    expect(s.openCircuits().has(MODEL)).toBe(true);
  });
});
