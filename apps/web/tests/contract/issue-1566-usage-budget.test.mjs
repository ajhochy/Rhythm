import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = (url) => ts.transpileModule(readFileSync(url, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const usage = await import(dataModule(compile(new URL('../../src/gateway/usage-budget.ts', import.meta.url))));
const timestamps = await import(dataModule(compile(new URL('../../src/timestamps.ts', import.meta.url))));

const sample = {
  providers: [
    { provider: 'anthropic', label: 'Anthropic — Team', kind: 'window', accountId: 'team', items: [{ label: '5h limit', remainingFraction: 0.66, resetAt: '2026-09-21T22:10:00.000Z', detail: 'allowed' }] },
    { provider: 'anthropic', label: 'Anthropic — Personal', kind: 'window', accountId: 'personal', items: [{ label: 'weekly', remainingFraction: 0.3, resetAt: '2026-09-24T02:00:00.000Z', detail: 'allowed' }] },
    { provider: 'openrouter', label: 'OpenRouter', kind: 'credits', items: [{ label: 'credits', remainingFraction: 1, detail: '$0.00 / $20.00' }] },
    { provider: 'gemini', label: 'Gemini', kind: 'unavailable', items: [], reason: 'quota fetch 401' },
    { provider: 'openai', label: 'OpenAI', kind: 'unavailable', items: [], reason: 'No usage API for the ChatGPT-plan token (standard API returns 401; Codex usage backend is undocumented).' },
  ],
  fetchedAt: '2026-09-21T20:35:43.470Z',
};

test('1566:usage-budget-gateway-and-reset-formatter:1 gateway preserves provider shapes and force requests', async () => {
  const calls = [];
  const gateway = usage.createLiveUsageBudgetGateway('http://127.0.0.1:7200', 'fixture-token', async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(sample), { status: 200 });
  });
  const ordinary = await gateway.get();
  const forced = await gateway.get({ force: true });
  assert.equal(ordinary.providers.length, 5);
  assert.equal(forced.providers.length, 5);
  assert.equal(calls[0].url, 'http://127.0.0.1:7200/agents/usage-budget');
  assert.equal(calls[1].url, 'http://127.0.0.1:7200/agents/usage-budget?force=true');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer fixture-token');
  assert.deepEqual(ordinary.providers.filter(provider => provider.provider === 'anthropic').map(provider => provider.accountId), ['team', 'personal']);
  assert.equal(ordinary.providers.find(provider => provider.provider === 'openrouter').items[0].detail, '$0.00 / $20.00');
  assert.equal(ordinary.providers.find(provider => provider.provider === 'gemini').reason, 'quota fetch 401');
  assert.equal(ordinary.providers.find(provider => provider.provider === 'openai').reason, sample.providers[4].reason);
});

test('1566:usage-budget-gateway-and-reset-formatter:2 malformed top-level payloads reject readably', async () => {
  for (const body of [null, [], 'wrong', {}, { providers: {} }]) {
    const gateway = usage.createLiveUsageBudgetGateway('http://127.0.0.1:7200', 'fixture-token', async () => new Response(JSON.stringify(body), { status: 200 }));
    await assert.rejects(() => gateway.get(), /usage budget response/i);
  }
});

test('1566:usage-budget-gateway-and-reset-formatter:3 reset labels are bounded relative durations', () => {
  const now = new Date('2026-09-21T20:00:00.000Z');
  assert.equal(timestamps.formatResetIn('2026-09-21T21:10:00.000Z', { now }), 'resets 1h');
  assert.equal(timestamps.formatResetIn('2026-09-21T20:38:00.000Z', { now }), 'resets 38m');
  assert.equal(timestamps.formatResetIn('2026-09-23T23:00:00.000Z', { now }), 'resets 2d');
  assert.equal(timestamps.formatResetIn('2026-09-21T19:59:00.000Z', { now }), 'resets now');
  assert.equal(timestamps.formatResetIn('2026-09-21T21:10:00', { now }), 'resets 1h');
  assert.equal(timestamps.formatResetIn('not-a-time', { now }), null);
  assert.equal(timestamps.formatResetIn(undefined, { now }), null);
});
