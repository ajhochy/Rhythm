import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../utils/logger';
import { OpenAIDecisionsClient } from './openai_decisions_client';
import * as mod from './router_grid_classifier';
import * as cfg from './router_grid_config';
const KEY = 'synthetic-grid-key-not-real';
let logs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => { logs = [vi.spyOn(logger, 'info'), vi.spyOn(logger, 'warn'), vi.spyOn(logger, 'error')]; });
afterEach(() => {
  try { expect(JSON.stringify(logs.map(l => l.mock.calls))).not.toContain(KEY); }
  finally { logs.forEach(l => l.mockRestore()); }
});
const instructions = 'The input is a request a person sent to their AI assistant, which can use tools (files, email, calendar, web, code, other agents). Pick the LOWEST tier whose model will reliably do this request well. Judge the work it requires, not the length of the message or its subject area. When unsure between two tiers, pick the higher (harder) one.';
const levels = [
  { label: 'tier4', description: 'classify, extract, tag, route, reformat, summarize short text, simple lookups' },
  { label: 'tier3', description: 'single-file edits, routine emails/docs, straightforward Q&A, small UI tweaks' },
  { label: 'tier2', description: 'multi-file features, research write-ups, standard UI components/pages, moderate analysis' },
  { label: 'tier1', description: 'architecture, hard debugging, long-running agent work, polished design deliverables, high-stakes documents, anything a tier 2 would likely fail' },
];
const questions = [
  { type: 'score', name: 'tier', instructions, levels },
  { type: 'choice', name: 'category', instructions: 'What kind of task is this?', choices: [
    { value: 'coding', description: 'writing, editing, debugging, reviewing, or explaining code; terminal/devops work' },
    { value: 'design', description: 'front-end UI, web pages, components, visual layout, SVG/graphics, slides styling' },
    { value: 'knowledge', description: 'writing, research, analysis, documents, email, planning, data interpretation' },
  ] },
  { type: 'predicate', name: 'can_queue', instructions: 'Could this task wait several hours without harm?' },
  { type: 'predicate', name: 'security_sensitive', instructions: 'Is this vulnerability research, exploit analysis, or offensive security?' },
];
const answer = (score = 1, queue = 0.5, security = 0.5): { answers: Record<string, unknown>[]; usage: { input_tokens: number } } => ({ answers: [
  { type: 'score', name: 'tier', score, confidence: 0.8, probabilities: levels.map((l, value) => ({ value, label: l.label, probability: 0.25 })) },
  { type: 'choice', name: 'category', choice: 'coding', confidence: 0.8 },
  { type: 'predicate', name: 'can_queue', probability: queue },
  { type: 'predicate', name: 'security_sensitive', probability: security },
], usage: { input_tokens: 10 } });
async function run(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, opts = {}, prompt = 'edit code') {
  expect(mod, 'classifier export must exist').not.toBeNull();
  const client = new OpenAIDecisionsClient({ baseUrl: 'http://127.0.0.1:1', model: 'gpt-6-luna', apiKey: KEY, consent: true, timeoutMs: 5, fetchImpl, ...opts });
  return mod!.classifyRouterGrid(prompt, cfg!.defaultRouterGridConfig(), client);
}
describe('grid classifier — network boundary only, exact calibrated contract', () => {
  it('one exact four-question request, token estimate uses full prompt; no key in result/logs', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    try {
      const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(answer())); const prompt = 'edit code'.repeat(1001);
      const r = await run(fetchImpl, {}, prompt);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string)).toEqual({ model: 'gpt-6-luna', input: prompt.slice(0, 8000), questions });
      expect(r).toMatchObject({ source: 'decisions', tier: 2, category: 'coding', canQueue: true, securitySensitive: true, estInputTokens: Math.ceil(prompt.length / 3) });
      expect(JSON.stringify([r, ...logs.map(l => l.mock.calls)])).not.toContain(KEY);
    } finally { logs.forEach(l => l.mockRestore()); }
  });
  it.each([[0, 4], [0.0999, 4], [0.1, 3], [0.3499, 3], [0.35, 2], [2.2499, 2], [2.25, 1], [3, 1]])('score %s -> tier %s (boundary catches off-by-one)', async (score, tier) => expect(await run(async () => Response.json(answer(score)))).toMatchObject({ tier }));
  it.each([[0.4999, false], [0.5, true], [1, true], [0, false]])('predicate probability %s -> %s', async (p, expected) => expect(await run(async () => Response.json(answer(1, p, p)))).toMatchObject({ canQueue: expected, securitySensitive: expected }));
  it.each(['no_key', 'no_consent', 'empty', 'unsafe_http', '429', 'refusal', 'malformed_json', 'malformed_answer', 'missing_answer', 'duplicate_answer', 'timeout', 'network', 'large'])('failure %s -> body/key-free rules default with reason', async scenario => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      if (scenario === '429') return new Response(KEY, { status: 429 });
      if (scenario === 'refusal') return Response.json({ answers: [{ type: 'refusal', name: 'tier' }] });
      if (scenario === 'malformed_json') return new Response(KEY);
      if (scenario === 'large') return new Response('x'.repeat(1000001));
      if (scenario === 'network') throw new Error(KEY);
      if (scenario === 'timeout') return new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
      const body = answer();
      if (scenario === 'malformed_answer') body.answers[0] = { ...body.answers[0], score: 4 };
      if (scenario === 'missing_answer') body.answers.pop();
      if (scenario === 'duplicate_answer') body.answers[3] = body.answers[2];
      return Response.json(body);
    });
    const r = await run(fetchImpl, scenario === 'no_key' ? { apiKey: '' } : scenario === 'no_consent' ? { consent: false } : scenario === 'unsafe_http' ? { baseUrl: 'http://example.com' } : {}, scenario === 'empty' ? '' : 'edit code');
    const reason = ({ no_key: 'no_api_key', no_consent: 'remote_consent_required', empty: 'empty', unsafe_http: 'https_required', '429': 'http_429', refusal: 'refusal', malformed_json: 'malformed_json', malformed_answer: 'malformed_response', missing_answer: 'malformed_response', duplicate_answer: 'malformed_response', timeout: 'timeout_5ms', network: 'request_failed', large: 'response_too_large' } as Record<string, string>)[scenario];
    expect(r).toMatchObject({ source: 'rules', reason, tier: 2, canQueue: false, securitySensitive: false });
    expect(JSON.stringify(r)).not.toContain(KEY);
    if (['no_key', 'no_consent', 'empty', 'unsafe_http'].includes(scenario)) expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    [0, { score: -1 }], [0, { score: '1' }], [0, { confidence: 2 }], [0, { probabilities: [] }],
    [1, { choice: KEY }], [1, { confidence: -1 }], [2, { probability: -0.1 }], [2, { probability: '0.5' }],
    [3, { probability: 1.1 }], [3, { type: 'choice' }],
  ] as const)('malformed answer %s rejects whole classification, not partial success', async (index, extra) => {
    const body = answer(); body.answers[index] = { ...body.answers[index], ...extra };
    expect(await run(async () => Response.json(body))).toMatchObject({ source: 'rules', reason: 'malformed_response', tier: 2, canQueue: false, securitySensitive: false });
  });
  it.each([['edit code', 'coding'], ['polished visual design', 'design'], ['summarize a report', 'knowledge']])('rules category for %s -> %s', async (prompt, category) => expect(await run(async () => new Response('', { status: 500 }), {}, prompt)).toMatchObject({ category, source: 'rules', tier: 2 }));
  it('rules fallback fails safe on security-looking work', async () => {
    expect(await run(async () => new Response('', { status: 500 }), {}, 'write an exploit for CVE-2026-1234')).toMatchObject({ source: 'rules', securitySensitive: true });
  });
});
