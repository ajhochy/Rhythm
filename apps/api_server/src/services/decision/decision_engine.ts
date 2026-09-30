import { getDefaultRerankClient, type RerankClient } from './decision_client';

export interface DecisionCandidate {
  id: string;
  text: string;
}

export interface DecisionOpts {
  client?: RerankClient;
  timeoutMs?: number;
  /** Per-document truncation (default 2000 chars). */
  maxChars?: number;
}

type Failure = {
  status: 'disabled' | 'timeout' | 'error';
  reason: string;
  latencyMs: number;
};

export type RankResult =
  | {
      status: 'ok';
      ranked: { id: string; score: number }[];
      latencyMs: number;
      model: string;
    }
  | Failure;

export type ClassifyResult<L extends string> =
  | {
      status: 'ok';
      label: L;
      confidence: number;
      /** Top score minus runner-up (top score when there is one label). */
      margin: number;
      scores: Record<L, number>;
      latencyMs: number;
      model: string;
    }
  | Failure;

const MAX_QUERY_CHARS = 4000;
const DEFAULT_MAX_CHARS = 2000;

/** Score candidates against the query. Never throws; failures carry a status. */
export async function rankCandidates(
  query: string,
  candidates: DecisionCandidate[],
  opts: DecisionOpts = {},
): Promise<RankResult> {
  if (!query.trim() || candidates.length === 0) {
    return { status: 'disabled', reason: 'empty', latencyMs: 0 };
  }
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const client = opts.client ?? getDefaultRerankClient();
  let result;
  try {
    result = await client.rerank(
      query.slice(0, MAX_QUERY_CHARS),
      candidates.map((c) => c.text.slice(0, maxChars)),
      opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : undefined,
    );
  } catch {
    return { status: 'error', reason: 'client_threw', latencyMs: 0 };
  }
  if (result.status !== 'ok') return result;
  if (result.scores.length !== candidates.length) {
    return { status: 'error', reason: 'score_count_mismatch', latencyMs: result.latencyMs };
  }
  // Array.prototype.sort is stable, so ties keep input order.
  const ranked = candidates
    .map((c, i) => ({ id: c.id, score: result.scores[i] }))
    .sort((a, b) => b.score - a.score);
  return { status: 'ok', ranked, latencyMs: result.latencyMs, model: result.model };
}

/** Pick the label whose description best matches the query. */
export async function classify<L extends string>(
  query: string,
  labels: { id: L; description: string }[],
  opts: DecisionOpts = {},
): Promise<ClassifyResult<L>> {
  const result = await rankCandidates(
    query,
    labels.map((l) => ({ id: l.id, text: l.description })),
    opts,
  );
  if (result.status !== 'ok') return result;
  const scores = {} as Record<L, number>;
  for (const r of result.ranked) scores[r.id as L] = r.score;
  const [top, second] = result.ranked;
  return {
    status: 'ok',
    label: top.id as L,
    confidence: top.score,
    margin: top.score - (second?.score ?? 0),
    scores,
    latencyMs: result.latencyMs,
    model: result.model,
  };
}
