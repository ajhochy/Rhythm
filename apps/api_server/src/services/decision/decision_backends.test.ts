import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/auth_middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import agentDecisionsRouter from '../../routes/agent_decisions_routes';
import { HttpRerankClient, JevRerankClient, getDefaultRerankClient, resetRemoteEndpointCacheForTests } from './decision_client';
import { mergeConfig, resolveConfig, DecisionConfigError } from './decision_config_service';
import {
  defaultDecisionSettings,
  effectiveLowConfidenceTier,
  loadDecisionSettings,
  resetDecisionSettingsCacheForTests,
} from './decision_settings';

const ENV = ['RHYTHM_DECISION_ROUTER_FILE', 'AGENT_DECISION_BASE_URL', 'AGENT_DECISION_MODEL', 'AGENT_DECISION_TIMEOUT_MS'];
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'decision-backends-'));
  for (const k of ENV) delete process.env[k];
  process.env.RHYTHM_DECISION_ROUTER_FILE = join(dir, 'decision-router.json');
  resetDecisionSettingsCacheForTests();
  resetRemoteEndpointCacheForTests();
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
  resetDecisionSettingsCacheForTests();
  rmSync(dir, { recursive: true, force: true });
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof DecisionConfigError) return e.code;
    throw e;
  }
  return 'none';
}

describe('validation', () => {
  const base = defaultDecisionSettings();
  it('rejects bad values', () => {
    expect(code(() => mergeConfig(base, { backend: 'nope' }))).toBe('invalid_backend');
    expect(code(() => mergeConfig(base, { features: { model_routing: 'maybe' } }))).toBe('invalid_mode');
    expect(code(() => mergeConfig(base, { custom: { baseUrl: 'not a url' } }))).toBe('invalid_url');
    expect(code(() => mergeConfig(base, { custom: { baseUrl: 'http://example.com' } }))).toBe('invalid_url');
    expect(code(() => mergeConfig(base, { custom: { baseUrl: 'http://169.254.169.254' } }))).toBe('invalid_url');
    expect(code(() => mergeConfig(base, { custom: { baseUrl: 'https://169.254.169.254' } }))).toBe('invalid_url');
    expect(code(() => mergeConfig(base, { local: { baseUrl: 'http://192.168.1.20:8012' } }))).toBe('invalid_url');
    expect(code(() => mergeConfig(base, { jev: { baseUrl: 'http://127.0.0.1:1' } }))).toBe('invalid_url');
    expect(code(() => mergeConfig(base, { timeoutMs: 5 }))).toBe('invalid_timeout');
  });
  it('requires consent for jev and non-loopback custom, not for loopback custom', () => {
    expect(code(() => mergeConfig(base, { backend: 'jev' }))).toBe('consent_required');
    expect(code(() => mergeConfig(base, { backend: 'custom', custom: { baseUrl: 'http://192.168.1.20:8012' } }))).toBe('consent_required');
    expect(code(() => mergeConfig(base, { backend: 'custom', custom: { baseUrl: 'http://127.0.0.1:9000' } }))).toBe('none');
    expect(code(() => mergeConfig(base, {
      backend: 'custom', remoteDataConsent: true, custom: { baseUrl: 'http://192.168.1.20:8012' },
    }))).toBe('none');
  });
});

describe('HttpRerankClient remote (custom backend)', () => {
  const okFetch = () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.9 }, { index: 1, relevance_score: 0.1 }] }));
    };
    return { calls, fetchImpl };
  };

  it('is loopback-only without remote options', async () => {
    const { fetchImpl, calls } = okFetch();
    const r = await new HttpRerankClient({ baseUrl: 'http://192.168.1.20:8012', fetchImpl }).rerank('q', ['a', 'b']);
    expect(r).toMatchObject({ status: 'disabled', reason: 'non_loopback_base_url' });
    expect(calls).toHaveLength(0);
  });

  it('requires consent for LAN, then sends the bearer key', async () => {
    const { fetchImpl, calls } = okFetch();
    const denied = await new HttpRerankClient({
      baseUrl: 'http://192.168.1.20:8012', fetchImpl, remote: { consent: false, apiKey: 'k' },
    }).rerank('q', ['a', 'b']);
    expect(denied).toMatchObject({ status: 'disabled', reason: 'consent_required' });
    const ok = await new HttpRerankClient({
      baseUrl: 'http://192.168.1.20:8012', fetchImpl, remote: { consent: true, apiKey: 'secret-key' },
    }).rerank('q', ['a', 'b']);
    expect(ok.status).toBe('ok');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer secret-key');
  });

  it('rejects public http and metadata addresses even with consent', async () => {
    const { fetchImpl, calls } = okFetch();
    for (const baseUrl of ['http://example.com', 'http://169.254.169.254']) {
      const r = await new HttpRerankClient({ baseUrl, fetchImpl, remote: { consent: true } }).rerank('q', ['a', 'b']);
      expect(r).toMatchObject({ status: 'disabled', reason: 'unsafe_endpoint' });
    }
    expect(calls).toHaveLength(0);
  });

  it('factory picks the custom backend from settings', async () => {
    const { updateConfig } = await import('./decision_config_service');
    updateConfig({ backend: 'custom', remoteDataConsent: false, custom: { baseUrl: 'http://127.0.0.1:9' } });
    expect(getDefaultRerankClient()).toBeInstanceOf(HttpRerankClient);
    updateConfig({ backend: 'jev', remoteDataConsent: true });
    expect(getDefaultRerankClient()).toBeInstanceOf(JevRerankClient);
  });
});

describe('JevRerankClient', () => {
  let server: Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function fake(handler: (body: any, auth: string | undefined) => { status?: number; json?: unknown; delayMs?: number }) {
    const seen: { body: any; auth?: string }[] = [];
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw);
        seen.push({ body, auth: req.headers.authorization });
        const out = handler(body, req.headers.authorization);
        setTimeout(() => {
          res.statusCode = out.status ?? 200;
          res.end(JSON.stringify(out.json ?? {}));
        }, out.delayMs ?? 0);
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
  }

  const yesFor = (body: any, pick: (instr: string) => number) =>
    Object.fromEntries(Object.entries(body.questions).map(([qid, q]: [string, any]) => [qid, { probabilities: { yes: pick(q.instructions), no: 0 } }]));

  it('sends one choice question per document and maps probabilities.yes', async () => {
    const { baseUrl, seen } = await fake((body) => ({
      json: { answers: yesFor(body, (i) => (i.endsWith('rename') ? 0.95 : 0.05)) },
    }));
    const c = new JevRerankClient({ baseUrl, model: 'jev-latest', apiKey: 'k', consent: true, allowInsecureLoopback: true });
    const r = await c.rerank('rename foo', ['weather', 'rename']);
    expect(r).toMatchObject({ status: 'ok', scores: [0.05, 0.95], model: 'jev-latest' });
    expect(seen[0].auth).toBe('Bearer k');
    expect(seen[0].body.state).toBe('rename foo');
    expect(seen[0].body.questions.q0).toEqual({
      type: 'choice',
      instructions: 'Is this relevant to / does this describe the request? weather',
      criteria: { yes: 'relevant', no: 'not relevant' },
    });
  });

  it('chunks 32 questions per request in parallel', async () => {
    const { baseUrl, seen } = await fake((body) => ({ json: { answers: yesFor(body, () => 0.5) } }));
    const c = new JevRerankClient({ baseUrl, model: 'm', apiKey: 'k', consent: true, allowInsecureLoopback: true });
    const r = await c.rerank('q', Array.from({ length: 70 }, (_, i) => `d${i}`));
    expect(r.status === 'ok' && r.scores.length).toBe(70);
    expect(seen.map((s) => Object.keys(s.body.questions).length).sort((a, b) => a - b)).toEqual([6, 32, 32]);
  });

  it('disabled without consent/key, never http without the test option', async () => {
    const mk = (o: object) => new JevRerankClient({ baseUrl: 'https://api.typesafe.ai', model: 'm', apiKey: 'k', consent: true, ...o });
    expect(await mk({ consent: false }).rerank('q', ['a'])).toMatchObject({ status: 'disabled', reason: 'consent_required' });
    expect(await mk({ apiKey: '' }).rerank('q', ['a'])).toMatchObject({ status: 'disabled', reason: 'missing_api_key' });
    expect(await mk({ baseUrl: 'http://127.0.0.1:1' }).rerank('q', ['a'])).toMatchObject({ status: 'disabled', reason: 'https_required' });
  });

  it('errors on a missing answer, http errors and malformed json; times out', async () => {
    let mode = 'missing';
    const { baseUrl } = await fake((body) => {
      if (mode === 'missing') return { json: { answers: { q0: { probabilities: { yes: 0.5 } } } } };
      if (mode === 'http') return { status: 500 };
      if (mode === 'slow') return { json: { answers: yesFor(body, () => 1) }, delayMs: 300 };
      return { json: { nope: 1 } };
    });
    const c = new JevRerankClient({ baseUrl, model: 'm', apiKey: 'k', consent: true, allowInsecureLoopback: true });
    expect(await c.rerank('q', ['a', 'b'])).toMatchObject({ status: 'error', reason: 'missing_answer' });
    mode = 'http';
    expect(await c.rerank('q', ['a'])).toMatchObject({ status: 'error', reason: 'http_500' });
    mode = 'bad';
    expect(await c.rerank('q', ['a'])).toMatchObject({ status: 'error', reason: 'malformed_response' });
    mode = 'slow';
    expect((await c.rerank('q', ['a'], { timeoutMs: 50 })).status).toBe('timeout');
  });
});

describe('routes', () => {
  let http: Server;
  let base: string;
  beforeEach(async () => {
    const app = express();
    app.use('/agent-decisions', agentDecisionsRouter);
    http = createServer(app);
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/agent-decisions`;
  });
  afterEach(() => new Promise<void>((r) => http.close(() => r())));

  const put = (body: unknown) => fetch(`${base}/config`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  it('GET/PUT round trip with redaction and 400s', async () => {
    const got = (await (await fetch(`${base}/config`)).json()) as any;
    expect(got).toMatchObject({ backend: 'local', timeoutMs: 400, remoteDataConsent: false, lockedByEnv: [] });
    expect(got.effective.baseUrl).toBe('http://127.0.0.1:8012');

    const bad = await put({ backend: 'jev' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'consent_required' });
    const badUrl = await put({ custom: { baseUrl: 'http://example.com' } });
    expect(await badUrl.json()).toMatchObject({ error: 'invalid_url' });

    const ok = await put({ backend: 'jev', remoteDataConsent: true, jev: { apiKey: 'topsecret' }, features: { tool_ranking: 'shadow' } });
    expect(ok.status).toBe(200);
    const view = (await ok.json()) as any;
    expect(view).toMatchObject({ backend: 'jev', jev: { hasApiKey: true }, timeoutMs: 1500 });
    expect(view.effective.features.tool_ranking).toBe('shadow');
    expect(JSON.stringify(view)).not.toContain('topsecret');
  });

  it('POST /config/test ranks the sample against a fake backend', async () => {
    const backend = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const { documents } = JSON.parse(raw);
        res.end(JSON.stringify({
          results: documents.map((d: string, index: number) => ({ index, relevance_score: /Rename/.test(d) ? 0.9 : 0.1 })),
        }));
      });
    });
    await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
      const res = await fetch(`${base}/config/test`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backend: 'custom', custom: { baseUrl: url, model: 'x' } }),
      });
      const out = (await res.json()) as any;
      expect(out).toMatchObject({ ok: true, backend: 'custom', model: 'x' });
      expect(out.ranked).toHaveLength(3);
      expect(out.ranked[0].text).toMatch(/Rename/);
      const bad = await fetch(`${base}/config/test`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backend: 'jev' }),
      });
      expect(bad.status).toBe(400);
    } finally {
      await new Promise<void>((r) => backend.close(() => r()));
    }
  });

  it('systemone: GET never returns the key; POST /config/test classifies one prompt', async () => {
    const seen: any[] = [];
    const backend = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
        res.end(JSON.stringify({
          model: 'kev-4b',
          answers: { q: { type: 'choice', choice: 'cheap', confidence: 0.9, probabilities: { cheap: 0.9, standard: 0.08, frontier: 0.02 } } },
        }));
      });
    });
    await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
      const saved = await put({ backend: 'systemone', systemone: { baseUrl: url, apiKey: 'kev-secret' } });
      expect(saved.status).toBe(200);
      const view = (await (await fetch(`${base}/config`)).json()) as any;
      expect(view).toMatchObject({ backend: 'systemone', systemone: { baseUrl: url, model: 'kev-latest', hasApiKey: true }, timeoutMs: 1000 });
      expect(view.effective.routing).toMatchObject({ minConfidence: 0.55, lowConfidenceTier: 'standard' });
      expect(JSON.stringify(view)).not.toContain('kev-secret');

      const res = await fetch(`${base}/config/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const out = (await res.json()) as any;
      expect(out).toMatchObject({ ok: true, backend: 'systemone', model: 'kev-4b', tier: 'cheap', probabilities: { cheap: 0.9 } });
      expect(typeof out.latencyMs).toBe('number');
      expect(out.ranked[0]).toEqual({ text: 'cheap', score: 0.9 });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ url: '/v1/systemone', auth: 'Bearer kev-secret', body: { state: 'What tasks are due today?' } });
      expect(Object.keys(seen[0].body.questions)).toHaveLength(1);
    } finally {
      await new Promise<void>((r) => backend.close(() => r()));
    }
  });
});

describe('systemone backend settings', () => {
  it('defaults, and old files without the key still load', () => {
    const d = defaultDecisionSettings();
    expect(d.systemone).toEqual({ baseUrl: 'http://127.0.0.1:8009', model: 'kev-latest', apiKey: '' });
    expect(d.routing).toMatchObject({ minConfidence: 0.55, lowConfidenceTier: null });
    writeFileSync(process.env.RHYTHM_DECISION_ROUTER_FILE!, JSON.stringify({ version: 1, backend: 'jev', jev: { apiKey: 'k' } }));
    resetDecisionSettingsCacheForTests();
    const old = loadDecisionSettings();
    expect(old.backend).toBe('jev');
    expect(old.systemone).toEqual(d.systemone);
    expect(effectiveLowConfidenceTier(old)).toBe('keep');
    expect(effectiveLowConfidenceTier({ ...old, backend: 'systemone' })).toBe('standard');
  });

  it('timeout defaults to 1000ms and stays overridable', () => {
    const s = mergeConfig(defaultDecisionSettings(), { backend: 'systemone' });
    expect(resolveConfig(s)).toMatchObject({ backend: 'systemone', baseUrl: 'http://127.0.0.1:8009', model: 'kev-latest', timeoutMs: 1000 });
    expect(resolveConfig({ ...s, timeoutMs: 700 }).timeoutMs).toBe(700);
  });

  it('loopback http needs no consent; anything else needs https plus consent', () => {
    const base = defaultDecisionSettings();
    expect(code(() => mergeConfig(base, { backend: 'systemone', systemone: { baseUrl: 'http://localhost:9000' } }))).toBe('none');
    expect(code(() => mergeConfig(base, { backend: 'systemone', systemone: { baseUrl: 'http://192.168.1.4:8009' } }))).toBe('invalid_url');
    expect(code(() => mergeConfig(base, { backend: 'systemone', remoteDataConsent: true, systemone: { baseUrl: 'http://example.com' } }))).toBe('invalid_url');
    expect(code(() => mergeConfig(base, { backend: 'systemone', systemone: { baseUrl: 'https://api.typesafe.ai' } }))).toBe('consent_required');
    const hosted = mergeConfig(base, {
      backend: 'systemone', remoteDataConsent: true,
      systemone: { baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', apiKey: 'k' },
    });
    expect(hosted.systemone).toEqual({ baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', apiKey: 'k' });
  });

  it('validates the routing policy fields', () => {
    const base = defaultDecisionSettings();
    expect(mergeConfig(base, { routing: { lowConfidenceTier: 'keep', minConfidence: 0.6 } }).routing)
      .toMatchObject({ lowConfidenceTier: 'keep', minConfidence: 0.6 });
    expect(code(() => mergeConfig(base, { routing: { lowConfidenceTier: 'frontier' } }))).toBe('invalid_body');
    expect(code(() => mergeConfig(base, { routing: { minConfidence: 0 } }))).toBe('invalid_confidence');
  });

  it('tool/memory ranking under systemone use the local reranker, never Kev', () => {
    writeFileSync(process.env.RHYTHM_DECISION_ROUTER_FILE!, JSON.stringify({ backend: 'systemone', local: { baseUrl: 'http://127.0.0.1:8123' } }));
    resetDecisionSettingsCacheForTests();
    const c = getDefaultRerankClient() as unknown as { opts: { baseUrl: string } };
    expect(c).toBeInstanceOf(HttpRerankClient);
    expect(c.opts.baseUrl).toBe('http://127.0.0.1:8123');
  });
});
