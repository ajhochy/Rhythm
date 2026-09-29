import {
  getDecisionBaseUrl,
  getDecisionModel,
  getDecisionScoreScale,
  type DecisionScoreScale,
  getDecisionTimeoutMs,
} from '../../config/env';

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
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
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
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLoopbackHost(url.hostname)) {
      return { status: 'disabled', reason: 'non_loopback_base_url', latencyMs: elapsed() };
    }

    try {
      const response = await (this.opts.fetchImpl ?? fetch)(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

let defaultClient: RerankClient | null = null;
let testClient: RerankClient | null = null;

/** Singleton; env is read at call time so live config changes still apply. */
export function getDefaultRerankClient(): RerankClient {
  if (testClient) return testClient;
  defaultClient ??= new HttpRerankClient();
  return defaultClient;
}

export function setRerankClientForTests(client: RerankClient | null): void {
  testClient = client;
}
