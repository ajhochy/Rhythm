import { getDecisionBaseUrl, getDecisionModel, getDecisionTimeoutMs } from '../../config/env';
import { checkRemoteEndpoint, isLoopbackHost, readCapped } from './decision_client';
import { loadDecisionSettings } from './decision_settings';

export interface ScoreQuestion {
  type: 'score';
  name: string;
  instructions: string;
  levels: { label: string; description: string }[];
}
export type OpenAIDecisionsResult =
  | { status: 'ok'; score: number; levelProbabilities: { quick: number; everyday: number; hard: number };
      apiConfidence: number; inputTokens: number; latencyMs: number; model: string }
  | { status: 'disabled' | 'error' | 'timeout'; reason: string; latencyMs: number };

const unit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/** One scored question; only the network boundary is injectable. Never exposes response bodies. */
export class OpenAIDecisionsClient {
  constructor(private readonly opts: {
    baseUrl: string; model: string; apiKey: string; consent: boolean; timeoutMs?: number;
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  }) {}

  async score(input: string, question: ScoreQuestion): Promise<OpenAIDecisionsResult> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    const fail = (status: 'disabled' | 'error' | 'timeout', reason: string): OpenAIDecisionsResult => ({ status, reason, latencyMs: elapsed() });
    if (!this.opts.apiKey.trim()) return fail('disabled', 'no_api_key');
    // Consent is required even on loopback: tests must exercise the same trust boundary.
    if (!this.opts.consent) return fail('disabled', 'remote_consent_required');
    if (!input.trim()) return fail('disabled', 'empty');
    const timeoutMs = this.opts.timeoutMs ?? 1000;
    try {
      const url = new URL('/v1/decisions', this.opts.baseUrl);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) return fail('disabled', 'https_required');
      const bad = await checkRemoteEndpoint(this.opts.baseUrl);
      if (bad) return fail('disabled', bad);
      const response = await (this.opts.fetchImpl ?? fetch)(url.toString(), {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({ model: this.opts.model, input: input.trim().slice(0, 8000), questions: [question] }),
      });
      if (!response.ok) return fail('error', `http_${response.status}`);
      const text = await readCapped(response);
      if (text === null) return fail('error', 'response_too_large');
      let body;
      try { body = JSON.parse(text); } catch { return fail('error', 'malformed_json'); }
      const answer = Array.isArray(body?.answers) && body.answers.length === 1 ? body.answers[0] : null;
      if (answer?.name === question.name && answer.type === 'refusal') return fail('error', 'refusal');
      const inputTokens = body?.usage?.input_tokens;
      if (!answer || answer.type !== 'score' || answer.name !== question.name ||
        typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 2 ||
        !unit(answer.confidence) || !Array.isArray(answer.probabilities) || answer.probabilities.length !== 3 ||
        typeof inputTokens !== 'number' || !Number.isSafeInteger(inputTokens) || inputTokens < 0) return fail('error', 'malformed_response');
      const levelProbabilities = { quick: 0, everyday: 0, hard: 0 };
      const labels = ['quick', 'everyday', 'hard'] as const;
      for (const [value, label] of labels.entries()) {
        const entries = answer.probabilities.filter((p: { value?: unknown; label?: unknown } | null) => p?.value === value && p.label === label);
        if (entries.length !== 1 || !unit(entries[0].probability)) return fail('error', 'malformed_response');
        levelProbabilities[label] = entries[0].probability;
      }
      return { status: 'ok', score: answer.score, levelProbabilities, apiConfidence: answer.confidence,
        inputTokens, latencyMs: elapsed(), model: this.opts.model };
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      return name === 'TimeoutError' || name === 'AbortError'
        ? fail('timeout', `timeout_${timeoutMs}ms`) : fail('error', 'request_failed');
    }
  }
}

export function getOpenAIDecisionsClient(): OpenAIDecisionsClient {
  const s = loadDecisionSettings();
  return new OpenAIDecisionsClient({ baseUrl: getDecisionBaseUrl(), model: getDecisionModel(),
    apiKey: s.openaiDecisions.apiKey, consent: s.remoteDataConsent, timeoutMs: getDecisionTimeoutMs() });
}
