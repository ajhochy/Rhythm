import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { HttpRerankClient } from './decision_client';

interface Fake {
  url: string;
  requests: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

/** Loopback stand-in for a rerank backend: POST /v1/rerank. */
function startFake(
  handler: (res: http.ServerResponse) => void,
): Promise<Fake> {
  const requests: Fake['requests'] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ url: req.url, ...JSON.parse(body) });
      handler(res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

const json = (res: http.ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

let fake: Fake | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

describe('HttpRerankClient', () => {
  it('parses {results:[{index, relevance_score}]} and maps to input order', async () => {
    fake = await startFake((res) => json(res, {
      results: [
        { index: 2, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.1 },
        { index: 1, relevance_score: 0.5 },
      ],
    }));
    const client = new HttpRerankClient({ baseUrl: fake.url, model: 'm' });
    const r = await client.rerank('q', ['a', 'b', 'c']);
    expect(r).toMatchObject({ status: 'ok', scores: [0.1, 0.5, 0.9], model: 'm' });
    expect(fake.requests[0]).toMatchObject({
      url: '/v1/rerank', model: 'm', query: 'q', documents: ['a', 'b', 'c'],
      top_n: 3, return_documents: false,
    });
  });

  it('parses {data:[{index, score}]}', async () => {
    fake = await startFake((res) => json(res, {
      data: [{ index: 1, score: 0.7 }, { index: 0, score: 0.2 }],
    }));
    const r = await new HttpRerankClient({ baseUrl: fake.url }).rerank('q', ['a', 'b']);
    expect(r).toMatchObject({ status: 'ok', scores: [0.2, 0.7] });
  });

  it('parses TEI top-level array', async () => {
    fake = await startFake((res) => json(res, [{ index: 0, score: 0.4 }, { index: 1, score: 0.6 }]));
    const r = await new HttpRerankClient({ baseUrl: fake.url }).rerank('q', ['a', 'b']);
    expect(r).toMatchObject({ status: 'ok', scores: [0.4, 0.6] });
  });

  it('applies sigmoid when any raw score is outside [0,1]', async () => {
    fake = await startFake((res) => json(res, {
      results: [{ index: 0, relevance_score: 0 }, { index: 1, relevance_score: 4 }],
    }));
    const r = await new HttpRerankClient({ baseUrl: fake.url }).rerank('q', ['a', 'b']);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.scores[0]).toBeCloseTo(0.5, 5);
    expect(r.scores[1]).toBeCloseTo(1 / (1 + Math.exp(-4)), 5);
  });

  it('returns ok [] for empty documents without a request', async () => {
    const r = await new HttpRerankClient({ baseUrl: 'http://127.0.0.1:1' }).rerank('q', []);
    expect(r).toMatchObject({ status: 'ok', scores: [] });
  });

  it('times out', async () => {
    fake = await startFake((res) => {
      setTimeout(() => json(res, { results: [{ index: 0, score: 1 }] }), 1_000);
    });
    const r = await new HttpRerankClient({ baseUrl: fake.url, timeoutMs: 50 }).rerank('q', ['a']);
    expect(r.status).toBe('timeout');
  });

  it('reports http 500 as error', async () => {
    fake = await startFake((res) => json(res, { error: 'x' }, 500));
    const r = await new HttpRerankClient({ baseUrl: fake.url }).rerank('q', ['a']);
    expect(r).toMatchObject({ status: 'error', reason: 'http_500' });
  });

  it('reports malformed JSON as error', async () => {
    fake = await startFake((res) => { res.writeHead(200); res.end('not json'); });
    const r = await new HttpRerankClient({ baseUrl: fake.url }).rerank('q', ['a']);
    expect(r).toMatchObject({ status: 'error', reason: 'malformed_json' });
  });

  it('errors on missing indices and out-of-range indices', async () => {
    fake = await startFake((res) => json(res, { results: [{ index: 0, score: 0.5 }] }));
    const missing = await new HttpRerankClient({ baseUrl: fake.url }).rerank('q', ['a', 'b']);
    expect(missing.status).toBe('error');
    await fake.close();
    fake = await startFake((res) => json(res, { results: [{ index: 5, score: 0.5 }] }));
    const oob = await new HttpRerankClient({ baseUrl: fake.url }).rerank('q', ['a']);
    expect(oob.status).toBe('error');
  });

  it('errors (does not follow) on redirects', async () => {
    fake = await startFake((res) => { res.writeHead(302, { location: 'http://example.com/' }); res.end(); });
    const r = await new HttpRerankClient({ baseUrl: fake.url }).rerank('q', ['a']);
    expect(r.status).toBe('error');
  });

  it('refuses non-loopback hosts without calling fetch', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return new Response('{}'); };
    for (const baseUrl of ['http://example.com:8012', 'http://10.0.0.5:8012', 'http://127.0.0.1.evil.com', 'not a url']) {
      const r = await new HttpRerankClient({ baseUrl, fetchImpl }).rerank('q', ['a']);
      expect(r.status).toBe('disabled');
    }
    expect(called).toBe(false);
  });

  it('allows localhost, 127.x and ::1', async () => {
    const fetchImpl = async () => new Response(JSON.stringify([{ index: 0, score: 0.3 }]));
    for (const baseUrl of ['http://localhost:1', 'http://127.1.2.3:1', 'http://[::1]:1']) {
      const r = await new HttpRerankClient({ baseUrl, fetchImpl }).rerank('q', ['a']);
      expect(r.status).toBe('ok');
    }
  });

  it('rejects oversized responses', async () => {
    const big = 'x'.repeat(1_100_000);
    const fetchImpl = async () => new Response(JSON.stringify({ pad: big }));
    const r = await new HttpRerankClient({ baseUrl: 'http://127.0.0.1:1', fetchImpl }).rerank('q', ['a']);
    expect(r).toMatchObject({ status: 'error', reason: 'response_too_large' });
  });

  it('never throws when fetch rejects', async () => {
    const fetchImpl = async () => { throw new Error('boom'); };
    const r = await new HttpRerankClient({ baseUrl: 'http://127.0.0.1:1', fetchImpl }).rerank('q', ['a']);
    expect(r.status).toBe('error');
  });
});
