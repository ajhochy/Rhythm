import { getEffectiveDecisionMode } from '../../config/env';
import { CustomProviderError, validateEndpointUrl } from '../custom_provider_service';
import {
  buildRerankClient,
  isLoopbackHost,
  type ResolvedRouterConfig,
} from './decision_client';
import { rankCandidates } from './decision_engine';
import {
  DECISION_FEATURE_KEYS,
  DEFAULT_LOCAL_TIMEOUT_MS,
  DEFAULT_REMOTE_TIMEOUT_MS,
  decisionLockedByEnv,
  loadDecisionSettings,
  normaliseDecisionSettings,
  saveDecisionSettings,
  type DecisionSettings,
} from './decision_settings';

export class DecisionConfigError extends Error {
  readonly status = 400;
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const bad = (code: string, message: string): never => {
  throw new DecisionConfigError(code, message);
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const SCALES = ['auto', 'probability', 'logit'];
const FEATURE_VALUES = ['default', 'off', 'shadow', 'on'];
const MAX_TEXT = 2048;

function envPositive(name: string): number | null {
  const n = Number(process.env[name]);
  return (process.env[name] ?? '').trim() !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

/** GET shape. Never includes API keys. */
export function buildConfigView(settings: DecisionSettings = loadDecisionSettings()) {
  const resolved = resolveConfig(settings);
  const features: Record<string, string> = {};
  for (const k of DECISION_FEATURE_KEYS) features[k] = getEffectiveDecisionMode(k, { sessionAuto: false });
  return {
    backend: settings.backend,
    local: { ...settings.local },
    jev: { baseUrl: settings.jev.baseUrl, model: settings.jev.model, hasApiKey: settings.jev.apiKey !== '' },
    custom: {
      baseUrl: settings.custom.baseUrl,
      model: settings.custom.model,
      scoreScale: settings.custom.scoreScale,
      hasApiKey: settings.custom.apiKey !== '',
    },
    timeoutMs: settings.timeoutMs ?? (settings.backend === 'local' ? DEFAULT_LOCAL_TIMEOUT_MS : DEFAULT_REMOTE_TIMEOUT_MS),
    remoteDataConsent: settings.remoteDataConsent,
    features: { ...settings.features },
    lockedByEnv: decisionLockedByEnv(),
    effective: {
      backend: settings.backend,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      features,
    },
  };
}

/** Effective config for `settings`, applying env overrides like the env getters. */
export function resolveConfig(settings: DecisionSettings): ResolvedRouterConfig {
  const section = settings[settings.backend];
  const envScale = (process.env.AGENT_DECISION_SCORE_SCALE ?? '').trim().toLowerCase();
  const scale = SCALES.includes(envScale)
    ? (envScale as ResolvedRouterConfig['scoreScale'])
    : settings.backend === 'jev' ? 'auto' : settings[settings.backend].scoreScale;
  return {
    backend: settings.backend,
    baseUrl: (process.env.AGENT_DECISION_BASE_URL ?? '').trim() || section.baseUrl,
    model: (process.env.AGENT_DECISION_MODEL ?? '').trim() || section.model || 'qwen3-reranker-4b',
    scoreScale: scale,
    timeoutMs:
      envPositive('AGENT_DECISION_TIMEOUT_MS')
      ?? settings.timeoutMs
      ?? (settings.backend === 'local' ? DEFAULT_LOCAL_TIMEOUT_MS : DEFAULT_REMOTE_TIMEOUT_MS),
    apiKey: settings.backend === 'jev' ? settings.jev.apiKey : settings.backend === 'custom' ? settings.custom.apiKey : '',
    consent: settings.remoteDataConsent,
  };
}

function checkUrl(kind: 'local' | 'jev' | 'custom', value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT) bad('invalid_url', 'Base URL must be a string.');
  const url = value as string;
  if (kind === 'custom' && url.trim() === '') return '';
  let endpoint: URL;
  try {
    endpoint = validateEndpointUrl(url.trim(), { allowLocalhostName: true });
  } catch (err) {
    return bad('invalid_url', err instanceof CustomProviderError ? err.message : 'Invalid base URL.');
  }
  if (kind === 'local' && !isLoopbackHost(endpoint.hostname)) {
    bad('invalid_url', 'The local backend must use a loopback address (127.0.0.1, localhost or ::1). Use the custom backend for another machine.');
  }
  if (kind === 'jev' && endpoint.protocol !== 'https:') {
    bad('invalid_url', 'The Jev backend requires an https URL.');
  }
  return url.trim();
}

function checkText(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length > 256) bad('invalid_model', `${field} must be a string of at most 256 characters.`);
  return (value as string).trim();
}

function checkScale(value: unknown): 'auto' | 'probability' | 'logit' {
  if (typeof value !== 'string' || !SCALES.includes(value)) bad('invalid_score_scale', 'scoreScale must be auto, probability or logit.');
  return value as 'auto' | 'probability' | 'logit';
}

function checkKey(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) bad('invalid_api_key', 'apiKey must be a string of at most 4096 characters.');
  return (value as string).trim();
}

/** Merge a partial body over `base`, validating everything. Throws DecisionConfigError. */
export function mergeConfig(base: DecisionSettings, body: unknown): DecisionSettings {
  if (!isObj(body)) return bad('invalid_body', 'Expected a JSON object.');
  const next = normaliseDecisionSettings(JSON.parse(JSON.stringify(base)));
  if (body.backend !== undefined) {
    if (body.backend !== 'local' && body.backend !== 'jev' && body.backend !== 'custom') {
      bad('invalid_backend', 'backend must be local, jev or custom.');
    }
    next.backend = body.backend as DecisionSettings['backend'];
  }
  if (body.local !== undefined) {
    if (!isObj(body.local)) bad('invalid_body', 'local must be an object.');
    const l = body.local as Record<string, unknown>;
    if (l.baseUrl !== undefined) next.local.baseUrl = checkUrl('local', l.baseUrl) || next.local.baseUrl;
    if (l.model !== undefined) next.local.model = checkText('local.model', l.model) || next.local.model;
    if (l.scoreScale !== undefined) next.local.scoreScale = checkScale(l.scoreScale);
  }
  if (body.jev !== undefined) {
    if (!isObj(body.jev)) bad('invalid_body', 'jev must be an object.');
    const j = body.jev as Record<string, unknown>;
    if (j.baseUrl !== undefined) next.jev.baseUrl = checkUrl('jev', j.baseUrl) || next.jev.baseUrl;
    if (j.model !== undefined) next.jev.model = checkText('jev.model', j.model) || next.jev.model;
    if (j.apiKey !== undefined) next.jev.apiKey = checkKey(j.apiKey);
  }
  if (body.custom !== undefined) {
    if (!isObj(body.custom)) bad('invalid_body', 'custom must be an object.');
    const c = body.custom as Record<string, unknown>;
    if (c.baseUrl !== undefined) next.custom.baseUrl = checkUrl('custom', c.baseUrl);
    if (c.model !== undefined) next.custom.model = checkText('custom.model', c.model);
    if (c.scoreScale !== undefined) next.custom.scoreScale = checkScale(c.scoreScale);
    if (c.apiKey !== undefined) next.custom.apiKey = checkKey(c.apiKey);
  }
  if (body.timeoutMs !== undefined) {
    const t = body.timeoutMs;
    if (t === null) next.timeoutMs = null;
    else if (typeof t !== 'number' || !Number.isInteger(t) || t < 50 || t > 30_000) {
      bad('invalid_timeout', 'timeoutMs must be an integer between 50 and 30000.');
    } else next.timeoutMs = t;
  }
  if (body.remoteDataConsent !== undefined) {
    if (typeof body.remoteDataConsent !== 'boolean') bad('invalid_body', 'remoteDataConsent must be a boolean.');
    next.remoteDataConsent = body.remoteDataConsent as boolean;
  }
  if (body.features !== undefined) {
    if (!isObj(body.features)) bad('invalid_mode', 'features must be an object.');
    for (const [key, value] of Object.entries(body.features as Record<string, unknown>)) {
      if (!(DECISION_FEATURE_KEYS as readonly string[]).includes(key)) bad('invalid_mode', `Unknown feature "${key}".`);
      if (typeof value !== 'string' || !FEATURE_VALUES.includes(value)) {
        bad('invalid_mode', `features.${key} must be default, off, shadow or on.`);
      }
      next.features[key as keyof DecisionSettings['features']] = value as DecisionSettings['features']['model_routing'];
    }
  }
  assertConsent(next);
  return next;
}

/** Jev, and custom over anything but loopback, sends prompts off-device. */
function assertConsent(s: DecisionSettings): void {
  if (s.remoteDataConsent) return;
  if (s.backend === 'jev') {
    bad('consent_required', 'Jev is a hosted service: prompts and memory text leave this device. Enable remoteDataConsent first.');
  }
  if (s.backend === 'custom' && s.custom.baseUrl) {
    let host = '';
    try { host = new URL(s.custom.baseUrl).hostname; } catch { /* validated already */ }
    if (host && !isLoopbackHost(host)) {
      bad('consent_required', 'This custom server is not on loopback, so prompts and memory text leave this device. Enable remoteDataConsent first.');
    }
  }
}

export function updateConfig(body: unknown) {
  const next = mergeConfig(loadDecisionSettings(), body);
  saveDecisionSettings(next);
  return buildConfigView(loadDecisionSettings());
}

const SAMPLE_QUERY = 'rename the variable foo to bar';
const SAMPLE_DOCS = [
  'Send a message to the team Slack channel',
  'Rename a symbol: change the variable foo to bar across the codebase',
  'Look up tomorrow\'s weather forecast',
];

export async function testConfig(draft: unknown) {
  const merged = mergeConfig(loadDecisionSettings(), draft ?? {});
  const cfg = resolveConfig(merged);
  const client = buildRerankClient({ ...cfg, timeoutMs: Math.max(cfg.timeoutMs, 3000) });
  const result = await rankCandidates(
    SAMPLE_QUERY,
    SAMPLE_DOCS.map((text, i) => ({ id: String(i), text })),
    { client },
  );
  if (result.status !== 'ok') {
    return {
      ok: false,
      backend: cfg.backend,
      model: cfg.model,
      latencyMs: result.latencyMs,
      ranked: [] as { text: string; score: number }[],
      message: result.reason,
    };
  }
  return {
    ok: true,
    backend: cfg.backend,
    model: result.model,
    latencyMs: result.latencyMs,
    ranked: result.ranked.map((r) => ({ text: SAMPLE_DOCS[Number(r.id)].slice(0, 80), score: r.score })),
  };
}
