import {
  getDecisionBaseUrl,
  getDecisionModel,
  getDecisionScoreScale,
  type DecisionScoreScale,
  getDecisionTimeoutMs,
} from '../../config/env';
import { resolveEndpoint, validateEndpointUrl } from '../custom_provider_service';
import { loadDecisionSettings } from './decision_settings';

export type RerankResult =
  | { status: 'ok'; scores: number[]; latencyMs: number; model: string }
  | { status: 'disabled' | 'timeout' | 'error'; reason: string; latencyMs: number };

export interface RerankClient {
  /** `scores[i]` is the normalised 0..1 score for `documents[i]` (input order). */
  rerank(
    query: string,
    documents: string[],
    opts?: { timeoutMs?: number },
  ): Promise<RerankResult>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_RESPONSE_BYTES = 1_000_000;

/** Loopback only: prompts and memories must never leave the machine. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

const REMOTE_CHECK_TTL_MS = 60_000;
const remoteCheckCache = new Map<string, { reason: string | null; at: number }>();

/**
 * Non-loopback endpoint gate, reusing the custom-provider validation: http only
 * for loopback/RFC1918/IPv6-local literals, public hosts https and resolving to
 * public addresses, link-local/metadata blocked. Returns null when allowed,
 * else a reason. Cached briefly so the prompt path does not do DNS per turn.
 */
export async function checkRemoteEndpoint(baseUrl: string): Promise<string | null> {
  const hit = remoteCheckCache.get(baseUrl);
  if (hit && Date.now() - hit.at < REMOTE_CHECK_TTL_MS) return hit.reason;
  let reason: string | null = null;
  try {
    const endpoint = validateEndpointUrl(baseUrl, { allowLocalhostName: true });
    const host = endpoint.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (endpoint.protocol === 'https:' && host !== 'localhost') await resolveEndpoint(endpoint);
  } catch {
    reason = 'unsafe_endpoint';
  }
  if (remoteCheckCache.size > 64) remoteCheckCache.clear();
  remoteCheckCache.set(baseUrl, { reason, at: Date.now() });
  return reason;
}

export function resetRemoteEndpointCacheForTests(): void {
  remoteCheckCache.clear();
}

/** Read the body as text, aborting once it exceeds the size cap. */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Accepts llama.cpp/Jina/Cohere `{results:[{index, relevance_score}]}`,
 * `{data:[{index, score|relevance_score}]}` and TEI `[{index, score}]`.
 * Returns raw scores in input order, or null when the payload is unusable.
 */
function parseRawScores(body: unknown, expected: number): number[] | null {
  const items = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? ((body as { results?: unknown }).results ?? (body as { data?: unknown }).data)
      : undefined;
  if (!Array.isArray(items)) return null;
  const raw: (number | undefined)[] = new Array(expected).fill(undefined);
  for (const item of items) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as { index?: unknown; score?: unknown; relevance_score?: unknown };
    const score = typeof entry.relevance_score === 'number' ? entry.relevance_score : entry.score;
    if (
      typeof entry.index !== 'number'
      || !Number.isInteger(entry.index)
      || entry.index < 0
      || entry.index >= expected
      || typeof score !== 'number'
      || !Number.isFinite(score)
      || raw[entry.index] !== undefined
    ) {
      return null;
    }
    raw[entry.index] = score;
  }
  if (raw.some((v) => v === undefined)) return null;
  return raw as number[];
}

const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));

/**
 * auto: keep scores when all are in [0,1], else sigmoid (batch-dependent, so
 * raw logits that happen to fall in [0,1] are misread). probability: clamp.
 * logit: always sigmoid (use for llama.cpp).
 */
export function normaliseScores(raw: number[], scale: DecisionScoreScale = 'auto'): number[] {
  if (scale === 'logit') return raw.map(sigmoid);
  if (scale === 'probability') return raw.map((v) => Math.min(1, Math.max(0, v)));
  if (raw.every((v) => v >= 0 && v <= 1)) return raw;
  return raw.map(sigmoid);
}

export class HttpRerankClient implements RerankClient {
  constructor(
    private readonly opts: {
      baseUrl?: string;
      model?: string;
      timeoutMs?: number;
      fetchImpl?: FetchLike;
      /** Overrides AGENT_DECISION_SCORE_SCALE. */
      scoreScale?: DecisionScoreScale;
      /**
       * Custom backend only. Without it the client is loopback-only. With it,
       * non-loopback URLs need `consent` and must pass the custom-provider
       * endpoint validation; `apiKey` is sent as a Bearer token.
       */
      remote?: { consent: boolean; apiKey?: string };
    } = {},
  ) {}

  async rerank(
    query: string,
    documents: string[],
    callOpts?: { timeoutMs?: number },
  ): Promise<RerankResult> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    if (documents.length === 0) {
      return { status: 'ok', scores: [], latencyMs: 0, model: this.opts.model ?? getDecisionModel() };
    }
    const baseUrl = this.opts.baseUrl ?? getDecisionBaseUrl();
    const model = this.opts.model ?? getDecisionModel();
    const timeoutMs = callOpts?.timeoutMs ?? this.opts.timeoutMs ?? getDecisionTimeoutMs();

    let url: URL;
    try {
      url = new URL('/v1/rerank', baseUrl);
    } catch {
      return { status: 'disabled', reason: 'invalid_base_url', latencyMs: elapsed() };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { status: 'disabled', reason: 'non_loopback_base_url', latencyMs: elapsed() };
    }
    if (!isLoopbackHost(url.hostname)) {
      const remote = this.opts.remote;
      if (!remote) return { status: 'disabled', reason: 'non_loopback_base_url', latencyMs: elapsed() };
      if (!remote.consent) return { status: 'disabled', reason: 'consent_required', latencyMs: elapsed() };
      const bad = await checkRemoteEndpoint(baseUrl);
      if (bad) return { status: 'disabled', reason: bad, latencyMs: elapsed() };
    }

    try {
      const response = await (this.opts.fetchImpl ?? fetch)(url.toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.remote?.apiKey ? { authorization: `Bearer ${this.opts.remote.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          query,
          documents,
          top_n: documents.length,
          return_documents: false,
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        return { status: 'error', reason: `http_${response.status}`, latencyMs: elapsed() };
      }
      const text = await readCapped(response);
      if (text === null) {
        return { status: 'error', reason: 'response_too_large', latencyMs: elapsed() };
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return { status: 'error', reason: 'malformed_json', latencyMs: elapsed() };
      }
      const raw = parseRawScores(body, documents.length);
      if (!raw) return { status: 'error', reason: 'malformed_response', latencyMs: elapsed() };
      return { status: 'ok', scores: normaliseScores(raw, this.opts.scoreScale ?? getDecisionScoreScale()), latencyMs: elapsed(), model };
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { status: 'timeout', reason: `timeout_${timeoutMs}ms`, latencyMs: elapsed() };
      }
      return { status: 'error', reason: 'request_failed', latencyMs: elapsed() };
    }
  }
}

const JEV_CHUNK = 32;

/**
 * Hosted Jev "systemone" backend: one Choice question per document, score is
 * the probability of "yes". Never throws. Requires remote-data consent + key.
 */
export class JevRerankClient implements RerankClient {
  constructor(
    private readonly opts: {
      baseUrl: string;
      model: string;
      apiKey: string;
      consent: boolean;
      timeoutMs?: number;
      fetchImpl?: FetchLike;
      chunkSize?: number;
      /** Tests only (explicit constructor option, never settings): allow http loopback. */
      allowInsecureLoopback?: boolean;
    },
  ) {}

  async rerank(
    query: string,
    documents: string[],
    callOpts?: { timeoutMs?: number },
  ): Promise<RerankResult> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    const { model } = this.opts;
    if (documents.length === 0) return { status: 'ok', scores: [], latencyMs: 0, model };
    if (!this.opts.consent) return { status: 'disabled', reason: 'consent_required', latencyMs: elapsed() };
    if (!this.opts.apiKey) return { status: 'disabled', reason: 'missing_api_key', latencyMs: elapsed() };
    const timeoutMs = callOpts?.timeoutMs ?? this.opts.timeoutMs ?? getDecisionTimeoutMs();

    let url: URL;
    try {
      url = new URL('/v1/systemone', this.opts.baseUrl);
    } catch {
      return { status: 'disabled', reason: 'invalid_base_url', latencyMs: elapsed() };
    }
    const insecureOk = this.opts.allowInsecureLoopback === true
      && url.protocol === 'http:' && isLoopbackHost(url.hostname);
    if (!insecureOk) {
      if (url.protocol !== 'https:') return { status: 'disabled', reason: 'https_required', latencyMs: elapsed() };
      const bad = await checkRemoteEndpoint(this.opts.baseUrl);
      if (bad) return { status: 'disabled', reason: bad, latencyMs: elapsed() };
    }

    const signal = AbortSignal.timeout(timeoutMs);
    const size = Math.max(1, this.opts.chunkSize ?? JEV_CHUNK);
    const chunks: string[][] = [];
    for (let i = 0; i < documents.length; i += size) chunks.push(documents.slice(i, i + size));
    try {
      const parts = await Promise.all(
        chunks.map((chunk) => this.askChunk(url, query, chunk, signal)),
      );
      const scores: number[] = [];
      for (const part of parts) {
        if (typeof part === 'string') return { status: 'error', reason: part, latencyMs: elapsed() };
        scores.push(...part);
      }
      return { status: 'ok', scores, latencyMs: elapsed(), model };
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { status: 'timeout', reason: `timeout_${timeoutMs}ms`, latencyMs: elapsed() };
      }
      return { status: 'error', reason: 'request_failed', latencyMs: elapsed() };
    }
  }

  /** Scores for one chunk, or an error-reason string. */
  private async askChunk(
    url: URL,
    query: string,
    docs: string[],
    signal: AbortSignal,
  ): Promise<number[] | string> {
    const questions: Record<string, unknown> = {};
    docs.forEach((doc, i) => {
      questions[`q${i}`] = {
        type: 'choice',
        instructions: `Is this relevant to / does this describe the request? ${doc}`,
        criteria: { yes: 'relevant', no: 'not relevant' },
      };
    });
    const response = await (this.opts.fetchImpl ?? fetch)(url.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({ model: this.opts.model, state: query, questions }),
      redirect: 'manual',
      signal,
    });
    if (!response.ok) return `http_${response.status}`;
    const text = await readCapped(response);
    if (text === null) return 'response_too_large';
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return 'malformed_json';
    }
    const answers = body && typeof body === 'object'
      ? (body as { answers?: unknown }).answers
      : undefined;
    if (!answers || typeof answers !== 'object') return 'malformed_response';
    const scores: number[] = [];
    for (let i = 0; i < docs.length; i++) {
      const answer = Array.isArray(answers)
        ? (answers as unknown[])[i]
        : (answers as Record<string, unknown>)[`q${i}`];
      const yes = answer && typeof answer === 'object'
        ? ((answer as { probabilities?: { yes?: unknown } }).probabilities?.yes)
        : undefined;
      if (typeof yes !== 'number' || !Number.isFinite(yes)) return 'missing_answer';
      scores.push(Math.min(1, Math.max(0, yes)));
    }
    return scores;
  }
}

export interface ResolvedRouterConfig {
  backend: 'local' | 'jev' | 'custom';
  baseUrl: string;
  model: string;
  scoreScale: DecisionScoreScale;
  timeoutMs: number;
  apiKey: string;
  consent: boolean;
}

/** Build a client from an explicit, already-resolved config. */
export function buildRerankClient(cfg: ResolvedRouterConfig): RerankClient {
  if (cfg.backend === 'jev') {
    return new JevRerankClient({
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      apiKey: cfg.apiKey,
      consent: cfg.consent,
      timeoutMs: cfg.timeoutMs,
    });
  }
  return new HttpRerankClient({
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    scoreScale: cfg.scoreScale,
    timeoutMs: cfg.timeoutMs,
    ...(cfg.backend === 'custom'
      ? { remote: { consent: cfg.consent, apiKey: cfg.apiKey || undefined } }
      : {}),
  });
}

/** Client for the effective backend (env > saved settings > defaults). */
export function buildRerankClientFromSettings(): RerankClient {
  const settings = loadDecisionSettings();
  const backend = settings.backend;
  // Pass nothing time-/url-sensitive to the constructor: the getters are read
  // per call so env/settings changes apply without rebuilding.
  if (backend === 'jev') {
    return new JevRerankClient({
      baseUrl: getDecisionBaseUrl(),
      model: getDecisionModel(),
      apiKey: settings.jev.apiKey,
      consent: settings.remoteDataConsent,
    });
  }
  if (backend === 'custom') {
    return new HttpRerankClient({
      remote: { consent: settings.remoteDataConsent, apiKey: settings.custom.apiKey || undefined },
    });
  }
  return new HttpRerankClient();
}

let defaultClient: { signature: string; client: RerankClient } | null = null;
let testClient: RerankClient | null = null;

/**
 * Singleton for the effective backend, rebuilt when settings change. Env
 * overrides (base URL/model/timeout/scale) are still read live per call.
 */
export function getDefaultRerankClient(): RerankClient {
  if (testClient) return testClient;
  const s = loadDecisionSettings();
  const signature = JSON.stringify([
    s.backend, s.remoteDataConsent, s.jev.apiKey, getDecisionBaseUrl(), getDecisionModel(),
    s.custom.apiKey,
  ]);
  if (!defaultClient || defaultClient.signature !== signature) {
    defaultClient = { signature, client: buildRerankClientFromSettings() };
  }
  return defaultClient.client;
}

export function setRerankClientForTests(client: RerankClient | null): void {
  testClient = client;
}
