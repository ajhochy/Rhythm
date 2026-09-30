import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetRemoteEndpointCacheForTests } from './decision_client';
import { SystemOneClient } from './systemone_client';

const question = {
  instructions: 'Which tier?',
  options: { cheap: 'easy', standard: 'normal', frontier: 'hard' },
};

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return respond();
  });
  return { calls, fetchImpl };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const answer = (a: Record<string, unknown>, model = 'kev-4b') => ok({ model, answers: { q: { type: 'choice', ...a } } });

const client = (fetchImpl: ReturnType<typeof fakeFetch>['fetchImpl'], extra: Partial<ConstructorParameters<typeof SystemOneClient>[0]> = {}) =>
  new SystemOneClient({ baseUrl: 'http://127.0.0.1:8009', model: 'kev-latest', consent: false, fetchImpl, ...extra });

afterEach(() => resetRemoteEndpointCacheForTests());

describe('SystemOneClient', () => {
  it('sends one choice question in the Jev request shape, no bearer without a key', async () => {
    const f = fakeFetch(() => answer({ choice: 'standard', probabilities: { cheap: 0.2, standard: 0.6, frontier: 0.2 } }));
    const r = await client(f.fetchImpl).choose('rename foo', question);
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0];
    expect(url).toBe('http://127.0.0.1:8009/v1/systemone');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'kev-latest',
      state: 'rename foo',
      questions: { q: { type: 'choice', instructions: 'Which tier?', criteria: question.options } },
    });
    expect(r).toMatchObject({ status: 'ok', choice: 'standard', confidence: 0.6, model: 'kev-4b' });
  });

  it('sends the bearer key only when one is set', async () => {
    const f = fakeFetch(() => answer({ choice: 'cheap', probabilities: { cheap: 1, standard: 0, frontier: 0 } }));
    await client(f.fetchImpl, { apiKey: 'sk-1' }).choose('x', question);
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-1');
  });

  it('normalises probabilities and picks the top one', async () => {
    const f = fakeFetch(() => answer({ choice: 'cheap', probabilities: { cheap: 1, standard: 1, frontier: 2 } }));
    const r = await client(f.fetchImpl).choose('x', question);
    expect(r).toMatchObject({
      status: 'ok', choice: 'frontier', confidence: 0.5,
      probabilities: { cheap: 0.25, standard: 0.25, frontier: 0.5 },
    });
  });

  it('falls back to choice at probability 1 only when probabilities are missing', async () => {
    const missing = await client(fakeFetch(() => answer({ choice: 'frontier' })).fetchImpl).choose('x', question);
    expect(missing).toMatchObject({ status: 'ok', choice: 'frontier', confidence: 1, probabilities: { cheap: 0, standard: 0, frontier: 1 } });
    const partial = await client(fakeFetch(() => answer({ choice: 'frontier', probabilities: { frontier: 0.9 } })).fetchImpl).choose('x', question);
    expect(partial).toMatchObject({ status: 'error', reason: 'malformed_response' });
    const nan = await client(fakeFetch(() => ok({ answers: { q: { choice: 'cheap', probabilities: { cheap: 'x', standard: 0, frontier: 0 } } } })).fetchImpl).choose('x', question);
    expect(nan).toMatchObject({ status: 'error', reason: 'malformed_response' });
    const unknownChoice = await client(fakeFetch(() => answer({ choice: 'huge' })).fetchImpl).choose('x', question);
    expect(unknownChoice).toMatchObject({ status: 'error', reason: 'malformed_response' });
  });

  it('maps HTTP errors, malformed JSON, missing answers and oversized bodies', async () => {
    const http = await client(fakeFetch(() => new Response('no', { status: 503 })).fetchImpl).choose('x', question);
    expect(http).toMatchObject({ status: 'error', reason: 'http_503' });
    const bad = await client(fakeFetch(() => new Response('{nope', { status: 200 })).fetchImpl).choose('x', question);
    expect(bad).toMatchObject({ status: 'error', reason: 'malformed_json' });
    const none = await client(fakeFetch(() => ok({ answers: {} })).fetchImpl).choose('x', question);
    expect(none).toMatchObject({ status: 'error', reason: 'missing_answer' });
    const big = await client(fakeFetch(() => new Response('x'.repeat(1_000_001), { status: 200 })).fetchImpl).choose('x', question);
    expect(big).toMatchObject({ status: 'error', reason: 'response_too_large' });
  });

  it('does not follow redirects (a 3xx is an error)', async () => {
    const f = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'http://evil.example/' } }));
    const r = await client(f.fetchImpl).choose('x', question);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].init.redirect).toBe('manual');
    expect(r).toMatchObject({ status: 'error', reason: 'http_302' });
  });

  it('times out without throwing', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('t'), { name: 'TimeoutError' })));
    }));
    const r = await new SystemOneClient({ baseUrl: 'http://127.0.0.1:8009', model: 'm', consent: false, fetchImpl, timeoutMs: 20 })
      .choose('x', question);
    expect(r).toMatchObject({ status: 'timeout', reason: 'timeout_20ms' });
    const thrown = await client(vi.fn(async () => { throw new Error('boom'); })).choose('x', question);
    expect(thrown).toMatchObject({ status: 'error', reason: 'request_failed' });
  });

  it('allows loopback http without consent; a remote URL needs https and consent', async () => {
    const f = fakeFetch(() => answer({ choice: 'cheap' }));
    expect((await client(f.fetchImpl, { baseUrl: 'http://localhost:8009' }).choose('x', question)).status).toBe('ok');
    expect(await client(f.fetchImpl, { baseUrl: 'https://api.typesafe.ai' }).choose('x', question))
      .toMatchObject({ status: 'disabled', reason: 'consent_required' });
    expect(await client(f.fetchImpl, { baseUrl: 'http://api.typesafe.ai', consent: true }).choose('x', question))
      .toMatchObject({ status: 'disabled', reason: 'https_required' });
    expect(await client(f.fetchImpl, { baseUrl: 'http://192.168.1.5:8009', consent: true }).choose('x', question))
      .toMatchObject({ status: 'disabled', reason: 'https_required' });
    expect(f.calls).toHaveLength(1);
  });
});
