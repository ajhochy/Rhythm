import { getDecisionBaseUrl, getDecisionModel, getDecisionTimeoutMs } from '../../config/env';
import { checkRemoteEndpoint, isLoopbackHost, readCapped } from './decision_client';
import { DEFAULT_SYSTEMONE_TIMEOUT_MS, loadDecisionSettings } from './decision_settings';

/**
 * Client for the Jev-compatible System One API (`POST /v1/systemone`): local
 * Kev (https://github.com/jaredpalmer/kev) or hosted Jev (api.typesafe.ai).
 * Asks ONE typed `choice` question and returns normalised per-option
 * probabilities. Never throws. Loopback http needs no consent; anything else
 * must be https, pass the remote-endpoint check, and have remoteDataConsent.
 */
export interface ChoiceQuestion<O extends string = string> {
  instructions: string;
  /** option id -> description */
  options: Record<O, string>;
}

export type ChoiceResult<O extends string = string> =
  | {
      status: 'ok';
      choice: O;
      /** Top probability. */
      confidence: number;
      probabilities: Record<O, number>;
      latencyMs: number;
      /** Model the server says it served, else the configured one. */
      model: string;
    }
  | { status: 'disabled' | 'timeout' | 'error'; reason: string; latencyMs: number };

export interface ChoiceClient {
  choose<O extends string>(
    state: string,
    question: ChoiceQuestion<O>,
    opts?: { timeoutMs?: number },
  ): Promise<ChoiceResult<O>>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const QUESTION_ID = 'q';
const MAX_STATE_CHARS = 8000;

export class SystemOneClient implements ChoiceClient {
  constructor(
    private readonly opts: {
      baseUrl: string;
      model: string;
      apiKey?: string;
      consent: boolean;
      timeoutMs?: number;
      fetchImpl?: FetchLike;
    },
  ) {}

  async choose<O extends string>(
    state: string,
    question: ChoiceQuestion<O>,
    callOpts?: { timeoutMs?: number },
  ): Promise<ChoiceResult<O>> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    const options = Object.keys(question.options) as O[];
    if (!state.trim() || options.length === 0) {
      return { status: 'disabled', reason: 'empty', latencyMs: 0 };
    }
    const timeoutMs = callOpts?.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_SYSTEMONE_TIMEOUT_MS;

    let url: URL;
    try {
      url = new URL('/v1/systemone', this.opts.baseUrl);
    } catch {
      return { status: 'disabled', reason: 'invalid_base_url', latencyMs: elapsed() };
    }
    const loopbackHttp = url.protocol === 'http:' && isLoopbackHost(url.hostname);
    if (!loopbackHttp) {
      if (url.protocol !== 'https:') return { status: 'disabled', reason: 'https_required', latencyMs: elapsed() };
      if (!this.opts.consent) return { status: 'disabled', reason: 'consent_required', latencyMs: elapsed() };
      if (!isLoopbackHost(url.hostname)) {
        const bad = await checkRemoteEndpoint(this.opts.baseUrl);
        if (bad) return { status: 'disabled', reason: bad, latencyMs: elapsed() };
      }
    }

    try {
      const response = await (this.opts.fetchImpl ?? fetch)(url.toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.opts.model,
          state: state.slice(0, MAX_STATE_CHARS),
          questions: {
            [QUESTION_ID]: { type: 'choice', instructions: question.instructions, criteria: question.options },
          },
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        return { status: 'error', reason: `http_${response.status}`, latencyMs: elapsed() };
      }
      const text = await readCapped(response);
      if (text === null) return { status: 'error', reason: 'response_too_large', latencyMs: elapsed() };
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return { status: 'error', reason: 'malformed_json', latencyMs: elapsed() };
      }
      const parsed = parseAnswer(body, options);
      if (typeof parsed === 'string') return { status: 'error', reason: parsed, latencyMs: elapsed() };
      const served = (body as { model?: unknown }).model;
      return {
        status: 'ok',
        ...parsed,
        latencyMs: elapsed(),
        model: typeof served === 'string' && served ? served : this.opts.model,
      };
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { status: 'timeout', reason: `timeout_${timeoutMs}ms`, latencyMs: elapsed() };
      }
      return { status: 'error', reason: 'request_failed', latencyMs: elapsed() };
    }
  }
}

/** Normalised answer for the one question, or an error reason. */
function parseAnswer<O extends string>(
  body: unknown,
  options: O[],
): { choice: O; confidence: number; probabilities: Record<O, number> } | string {
  const answers = body && typeof body === 'object' ? (body as { answers?: unknown }).answers : undefined;
  const answer = answers && typeof answers === 'object' && !Array.isArray(answers)
    ? (answers as Record<string, unknown>)[QUESTION_ID]
    : undefined;
  if (!answer || typeof answer !== 'object') return 'missing_answer';
  const { choice, probabilities } = answer as { choice?: unknown; probabilities?: unknown };
  const probs = {} as Record<O, number>;
  if (probabilities === undefined || probabilities === null) {
    // Fallback only when the server sent no probabilities at all.
    if (typeof choice !== 'string' || !(options as string[]).includes(choice)) return 'malformed_response';
    for (const o of options) probs[o] = o === choice ? 1 : 0;
    return { choice: choice as O, confidence: 1, probabilities: probs };
  }
  if (typeof probabilities !== 'object' || Array.isArray(probabilities)) return 'malformed_response';
  let sum = 0;
  for (const o of options) {
    const p = (probabilities as Record<string, unknown>)[o];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return 'malformed_response';
    probs[o] = p;
    sum += p;
  }
  if (sum <= 0) return 'malformed_response';
  let top = options[0];
  for (const o of options) {
    probs[o] /= sum;
    if (probs[o] > probs[top]) top = o;
  }
  return { choice: top, confidence: probs[top], probabilities: probs };
}

let defaultClient: { signature: string; client: SystemOneClient } | null = null;

/** Client for the saved systemone settings (env base URL/model/timeout win). */
export function getDefaultChoiceClient(): SystemOneClient {
  const s = loadDecisionSettings();
  const cfg = {
    baseUrl: getDecisionBaseUrl(),
    model: getDecisionModel(),
    apiKey: s.systemone.apiKey,
    consent: s.remoteDataConsent,
    timeoutMs: getDecisionTimeoutMs(),
  };
  const signature = JSON.stringify(cfg);
  if (!defaultClient || defaultClient.signature !== signature) {
    defaultClient = { signature, client: new SystemOneClient(cfg) };
  }
  return defaultClient.client;
}
