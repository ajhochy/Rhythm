/**
 * F3 isolated proof: the real Free extraction executor -> real HTTP to the fake loopback scripted provider
 * (127.0.0.1:7481, public synthetic bearer) -> independent verifier -> release or rejection.
 * Opt-in: RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_FREE_EXTRACTION=1. Zero external calls; synthetic text only.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adaptRouterFreeConfig } from '../services/decision/router_free_config';
import { RouterFreeStateStore } from '../services/decision/router_free_state';
import { defaultRouterGridConfig } from '../services/decision/router_grid_config';
import { executeFreeExtraction, FREE_EXTRACTION_SYSTEM, type ExtractionTask } from '../services/decision/router_free_extraction';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_LIVE_FREE_EXTRACTION === '1';
const PROVIDER = 'http://127.0.0.1:7481';
const MODEL = 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free';
let provider: ChildProcess | undefined;
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const config = () => { const c = defaultRouterGridConfig(); c.free_mode = { ...c.free_mode, enabled: true }; return c; };
const store = () => new RouterFreeStateStore({ statePath: join(mkdtempSync(join(process.env.TMPDIR!, 'free-x-live-')), 'state.json'),
  clock: Date.now, config: adaptRouterFreeConfig(config()).state });
function task(tag: string): ExtractionTask {
  return { kind: 'structured_extraction', taskId: `synthetic-${tag}`,
    sourceText: `SDMRX:${tag} Harvest Fair on Saturday. Admission is $12 for adults.`,
    fields: [{ name: 'event', type: 'string', required: true }, { name: 'price', type: 'number', required: true }],
    publicSource: { trusted: true, label: 'synthetic public flyer' }, ownerOptIn: true, attachments: [],
    context: { memory: false, dayflow: false, history: false, profilePrompt: false } };
}
const span = (src: string, s: string) => ({ start: src.indexOf(s), end: src.indexOf(s) + s.length });
const register = (tag: string, content: string) => fetch(`${PROVIDER}/_sdmr/reply/${tag}`, { method: 'POST', body: JSON.stringify({ content }) });
const captured = async (tag: string) => ((await (await fetch(`${PROVIDER}/_sdmr/requests`)).json()) as Array<{ lastUserText: string; systemText: string; messageCount: number; body: { model: string; stream: boolean } }>)
  .filter(r => r.lastUserText.includes(`SDMRX:${tag}`));
const deps = (s = store()) => ({ config: config(), store: s, verifiedFreeModels: new Set([MODEL]), baseUrl: `${PROVIDER}/v1`, apiKey: 'sdmr-synthetic-only' });

(LIVE ? describe : describe.skip)('F3 Free extraction through a real loopback provider', () => {
  beforeAll(async () => {
    provider = spawn(process.execPath, [join(__dirname, 'fixtures/scripted_openai_provider_sdmr.mjs')], { env: { ...process.env, RHYTHM_SDMR_PROVIDER_PORT: '7481' }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { if (await fetch(`${PROVIDER}/health`).then(r => r.ok, () => false)) return; await pause(200); }
    throw new Error('provider not ready');
  }, 30_000);
  afterAll(() => { provider?.kill('SIGTERM'); });

  it('verified answer is released; wrong answers are rejected; private/unknown never calls the provider', async () => {
    const good = task('good'), s = store();
    await register('good', JSON.stringify({ event: { value: 'Harvest Fair', ...span(good.sourceText, 'Harvest Fair') }, price: { value: 12, ...span(good.sourceText, '$12') } }));
    expect(await executeFreeExtraction(good, deps(s))).toMatchObject({ kind: 'released', model: MODEL, values: { event: 'Harvest Fair', price: 12 } });
    const [req] = await captured('good');
    expect(req).toMatchObject({ systemText: FREE_EXTRACTION_SYSTEM, messageCount: 2, body: { stream: false, model: 'nvidia/nemotron-3-ultra-550b-a55b:free' } });
    expect(s.usage()).toMatchObject({ dailyCount: 1, reservedCalls: 0 });

    const bad = task('bad');
    await register('bad', JSON.stringify({ event: { value: 'Spring Gala', ...span(bad.sourceText, 'Harvest Fair') }, price: { value: 12, ...span(bad.sourceText, '$12') } }));
    const rejected = await executeFreeExtraction(bad, deps());
    expect(rejected).toMatchObject({ kind: 'rejected' }); expect(rejected).not.toHaveProperty('values');

    const selfReport = task('selfreport'); await register('selfreport', 'PASS - verified by model');
    expect(await executeFreeExtraction(selfReport, deps())).toMatchObject({ kind: 'rejected', checks: ['output_not_json'] });

    const privateTask = { ...task('private'), sourceText: 'SDMRX:private Email jane.synthetic@example.test about the fair.' };
    const unknownTask = { ...task('unknown'), publicSource: null };
    expect(await executeFreeExtraction(privateTask, deps())).toEqual({ kind: 'held', reason: 'privacy' });
    expect(await executeFreeExtraction(unknownTask, deps())).toEqual({ kind: 'held', reason: 'privacy' });
    expect((await captured('private')).length + (await captured('unknown')).length).toBe(0);
    console.info(JSON.stringify({ caseId: 'FREE-F3-EXTRACTION', released: true, rejectedWrong: true, rejectedSelfReport: true, heldPrivate: true, heldUnknown: true, publicOnlyRequest: true }));
  }, 60_000);
});
