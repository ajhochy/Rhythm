import {
  getDecisionEscalateMinConfidence,
  getDecisionRoutingMinConfidence,
  getDecisionRoutingScope,
  getEffectiveDecisionMode,
} from '../../config/env';
import { CustomProviderError, validateEndpointUrl } from '../custom_provider_service';
import {
  buildRerankClient,
  isLoopbackHost,
  type ResolvedRouterConfig,
} from './decision_client';
import { rankCandidates } from './decision_engine';
import { TIER_CHOICE_QUESTION, TIER_SCORE_QUESTION, tierForDecisionScore } from './model_router';
import { SystemOneClient } from './systemone_client';
import { OpenAIDecisionsClient } from './openai_decisions_client';
import { getCatalogForSettings, resetModelCatalogCache } from './model_catalog';
import {
  DECISION_FEATURE_KEYS,
  DECISION_ROUTING_SCOPES,
  ROUTER_TIER_NAMES,
  decisionLockedByEnv,
  defaultTimeoutFor,
  effectiveLowConfidenceTier,
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
    systemone: {
      baseUrl: settings.systemone.baseUrl,
      model: settings.systemone.model,
      hasApiKey: settings.systemone.apiKey !== '',
    },
    openaiDecisions: { baseUrl: settings.openaiDecisions.baseUrl, model: settings.openaiDecisions.model, hasApiKey: settings.openaiDecisions.apiKey !== '' },
    timeoutMs: settings.timeoutMs ?? defaultTimeoutFor(settings.backend),
    remoteDataConsent: settings.remoteDataConsent,
    features: { ...settings.features },
    routing: { ...settings.routing },
    tiers: { ...settings.tiers, derivedFromModels: 0 },
    tierOverrides: { ...settings.tierOverrides },
    excludedModels: [...settings.excludedModels],
    lockedByEnv: decisionLockedByEnv(),
    effective: {
      backend: settings.backend,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      features,
      routing: {
        scope: getDecisionRoutingScope(),
        escalateMinConfidence: getDecisionEscalateMinConfidence(),
        minConfidence: getDecisionRoutingMinConfidence(),
        lowConfidenceTier: effectiveLowConfidenceTier(settings),
      },
    },
  };
}

/** GET /agent-decisions/config: the settings view plus the live model catalog the router chooses among. */
export async function buildConfigViewWithCatalog(settings: DecisionSettings = loadDecisionSettings()) {
  const view = buildConfigView(settings);
  const catalog = await getCatalogForSettings({ settings }).catch(() => null);
  const effectiveTiers = catalog?.tiers ?? { ...settings.tiers, derivedFromModels: 0 };
  const tierRank = { cheap: 0, standard: 1, frontier: 2 } as const;
  return {
    ...view,
    catalog: {
      fetchedAt: catalog?.fetchedAt ?? new Date().toISOString(),
      source: catalog?.source ?? 'static',
      models: (catalog?.models ?? [])
        .map((m) => ({
          providerID: m.providerID,
          modelID: m.modelID,
          name: m.name,
          family: m.family,
          tier: m.tier,
          tierSource: m.tierSource,
          costOutputUsd: m.costOutputUsd,
          costInputUsd: m.costInputUsd,
          releaseDate: m.releaseDate,
          contextLimit: m.contextLimit,
          excluded: m.excluded,
          enabled: m.enabled,
        }))
        .sort((a, b) =>
          tierRank[a.tier] - tierRank[b.tier] ||
          (a.providerID < b.providerID ? -1 : a.providerID > b.providerID ? 1 : 0) ||
          (a.releaseDate === b.releaseDate ? 0 : a.releaseDate === null ? 1 : b.releaseDate === null ? -1 : a.releaseDate < b.releaseDate ? 1 : -1)),
      tiers: effectiveTiers,
      curatedCount: catalog?.curatedCount ?? 0,
    },
    tiers: effectiveTiers,
  };
}

/** Effective config for `settings`, applying env overrides like the env getters. */
export function resolveConfig(settings: DecisionSettings): ResolvedRouterConfig {
  const section = settings.backend === 'openai_decisions' ? settings.openaiDecisions : settings[settings.backend];
  const envScale = (process.env.AGENT_DECISION_SCORE_SCALE ?? '').trim().toLowerCase();
  const scale = SCALES.includes(envScale)
    ? (envScale as ResolvedRouterConfig['scoreScale'])
    : settings.backend === 'local' || settings.backend === 'custom'
      ? settings[settings.backend].scoreScale
      : 'auto';
  return {
    backend: settings.backend,
    baseUrl: (process.env.AGENT_DECISION_BASE_URL ?? '').trim() || section.baseUrl,
    model: (process.env.AGENT_DECISION_MODEL ?? '').trim() || section.model || 'qwen3-reranker-4b',
    scoreScale: scale,
    timeoutMs:
      envPositive('AGENT_DECISION_TIMEOUT_MS')
      ?? settings.timeoutMs
      ?? defaultTimeoutFor(settings.backend),
    apiKey: settings.backend === 'local' ? '' : settings.backend === 'openai_decisions' ? settings.openaiDecisions.apiKey : settings[settings.backend].apiKey,
    consent: settings.remoteDataConsent,
  };
}

function checkUrl(kind: DecisionSettings['backend'], value: unknown): string {
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
  if ((kind === 'systemone' || kind === 'openai_decisions') && endpoint.protocol !== 'https:' && !isLoopbackHost(endpoint.hostname)) {
    bad('invalid_url', 'This backend needs a loopback http URL or an https URL.');
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
    if (!['local', 'jev', 'custom', 'systemone', 'openai_decisions'].includes(body.backend as string)) {
      bad('invalid_backend', 'backend must be local, jev, custom, systemone or openai_decisions.');
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
  if (body.systemone !== undefined) {
    if (!isObj(body.systemone)) bad('invalid_body', 'systemone must be an object.');
    const o = body.systemone as Record<string, unknown>;
    if (o.baseUrl !== undefined) next.systemone.baseUrl = checkUrl('systemone', o.baseUrl) || next.systemone.baseUrl;
    if (o.model !== undefined) next.systemone.model = checkText('systemone.model', o.model) || next.systemone.model;
    if (o.apiKey !== undefined) next.systemone.apiKey = checkKey(o.apiKey);
  }
  if (body.openaiDecisions !== undefined) {
    if (!isObj(body.openaiDecisions)) bad('invalid_body', 'openaiDecisions must be an object.');
    const o = body.openaiDecisions as Record<string, unknown>;
    if (o.baseUrl !== undefined) next.openaiDecisions.baseUrl = checkUrl('openai_decisions', o.baseUrl) || next.openaiDecisions.baseUrl;
    if (o.model !== undefined) next.openaiDecisions.model = checkText('openaiDecisions.model', o.model) || next.openaiDecisions.model;
    if (o.apiKey !== undefined) next.openaiDecisions.apiKey = checkKey(o.apiKey);
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
  if (body.routing !== undefined) {
    if (!isObj(body.routing)) bad('invalid_routing_scope', 'routing must be an object.');
    const r = body.routing as Record<string, unknown>;
    if (r.scope !== undefined) {
      if (typeof r.scope !== 'string' || !(DECISION_ROUTING_SCOPES as readonly string[]).includes(r.scope)) {
        bad('invalid_routing_scope', 'routing.scope must be first_prompt, escalate_only or every_prompt.');
      }
      next.routing.scope = r.scope as DecisionSettings['routing']['scope'];
    }
    if (r.escalateMinConfidence !== undefined) {
      const c = r.escalateMinConfidence;
      if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0 || c > 1) {
        bad('invalid_confidence', 'routing.escalateMinConfidence must be a number greater than 0 and at most 1.');
      }
      next.routing.escalateMinConfidence = c as number;
    }
    if (r.minConfidence !== undefined) {
      const c = r.minConfidence;
      if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0 || c > 1) {
        bad('invalid_confidence', 'routing.minConfidence must be a number greater than 0 and at most 1.');
      }
      next.routing.minConfidence = c as number;
    }
    if (r.lowConfidenceTier !== undefined) {
      if (r.lowConfidenceTier !== null && r.lowConfidenceTier !== 'keep' && r.lowConfidenceTier !== 'standard') {
        bad('invalid_body', 'routing.lowConfidenceTier must be keep, standard or null (backend default).');
      }
      next.routing.lowConfidenceTier = r.lowConfidenceTier as DecisionSettings['routing']['lowConfidenceTier'];
    }
  }
  if (body.tiers !== undefined) {
    if (!isObj(body.tiers)) bad('invalid_threshold', 'tiers must be an object.');
    const t = body.tiers as Record<string, unknown>;
    if (t.mode !== undefined && t.mode !== 'auto' && t.mode !== 'manual') {
      bad('invalid_threshold', 'tiers.mode must be auto or manual.');
    }
    const hasValues = t.cheapMaxOutputUsd !== undefined || t.frontierMinOutputUsd !== undefined;
    const mode = (t.mode as 'auto' | 'manual' | undefined) ?? (hasValues ? 'manual' : next.tiers.mode);
    const cheap = t.cheapMaxOutputUsd === undefined ? next.tiers.cheapMaxOutputUsd : t.cheapMaxOutputUsd;
    const frontier = t.frontierMinOutputUsd === undefined ? next.tiers.frontierMinOutputUsd : t.frontierMinOutputUsd;
    // Values are validated whenever supplied, and always in manual mode.
    if (hasValues || mode === 'manual') {
      for (const v of [cheap, frontier]) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          bad('invalid_threshold', 'tiers thresholds must be numbers greater than 0 (USD per 1M output tokens).');
        }
      }
      if ((cheap as number) >= (frontier as number)) {
        bad('invalid_threshold', 'tiers.cheapMaxOutputUsd must be lower than tiers.frontierMinOutputUsd.');
      }
      next.tiers.cheapMaxOutputUsd = cheap as number;
      next.tiers.frontierMinOutputUsd = frontier as number;
    }
    next.tiers.mode = mode;
  }
  if (body.tierOverrides !== undefined) {
    if (!isObj(body.tierOverrides)) bad('invalid_body', 'tierOverrides must be an object of "provider/model" to tier.');
    const overrides: DecisionSettings['tierOverrides'] = {};
    for (const [id, tier] of Object.entries(body.tierOverrides as Record<string, unknown>)) {
      checkModelId('tierOverrides', id);
      if (typeof tier !== 'string' || !(ROUTER_TIER_NAMES as readonly string[]).includes(tier)) {
        bad('invalid_tier', `tierOverrides["${id.slice(0, 80)}"] must be cheap, standard or frontier.`);
      }
      overrides[id] = tier as DecisionSettings['tierOverrides'][string];
    }
    next.tierOverrides = overrides;
  }
  if (body.excludedModels !== undefined) {
    if (!Array.isArray(body.excludedModels) || body.excludedModels.length > 5000) {
      bad('invalid_body', 'excludedModels must be an array of "provider/model" strings.');
    }
    for (const id of body.excludedModels as unknown[]) checkModelId('excludedModels', id);
    next.excludedModels = [...new Set(body.excludedModels as string[])];
  }
  assertConsent(next);
  return next;
}

function checkModelId(field: string, id: unknown): void {
  if (typeof id !== 'string' || id.length > 300 || !/^[^/\s]+\/\S+$/.test(id)) {
    bad('invalid_body', `${field} entries must be "provider/model" strings.`);
  }
}

/** Jev, and custom/systemone over anything but loopback, sends prompts off-device. */
function assertConsent(s: DecisionSettings): void {
  if (s.remoteDataConsent) return;
  if (s.backend === 'openai_decisions') bad('consent_required', 'OpenAI Decisions sends prompts to OpenAI. Enable remoteDataConsent first.');
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
  if (s.backend === 'systemone') {
    let host = '';
    try { host = new URL(s.systemone.baseUrl).hostname; } catch { /* validated already */ }
    if (!isLoopbackHost(host)) {
      bad('consent_required', 'This System One server is not on loopback, so prompts leave this device. Enable remoteDataConsent first.');
    }
  }
}

export function updateConfig(body: unknown) {
  const next = mergeConfig(loadDecisionSettings(), body);
  saveDecisionSettings(next);
  resetModelCatalogCache();
  return buildConfigView(loadDecisionSettings());
}

/** PUT response: same shape as GET, catalog included. */
export async function updateConfigWithCatalog(body: unknown) {
  updateConfig(body);
  return buildConfigViewWithCatalog(loadDecisionSettings());
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
  if (cfg.backend === 'systemone') return testSystemOne(cfg);
  if (cfg.backend === 'openai_decisions') {
    const r = await new OpenAIDecisionsClient(cfg).score(SYSTEMONE_SAMPLE, TIER_SCORE_QUESTION);
    if (r.status !== 'ok') return { ok: false, backend: cfg.backend, model: cfg.model, latencyMs: r.latencyMs, ranked: [], message: r.reason };
    return { ok: true, backend: cfg.backend, model: r.model, latencyMs: r.latencyMs, prompt: SYSTEMONE_SAMPLE,
      tier: tierForDecisionScore(r.score), score: r.score, confidence: r.apiConfidence, levelProbabilities: r.levelProbabilities,
      ranked: Object.entries(r.levelProbabilities).map(([text, score]) => ({ text, score })).sort((a, b) => b.score - a.score) };
  }
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

const SYSTEMONE_SAMPLE = 'What tasks are due today?';

/** One tier classification against the draft System One settings. */
async function testSystemOne(cfg: ResolvedRouterConfig) {
  const client = new SystemOneClient({
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    apiKey: cfg.apiKey,
    consent: cfg.consent,
    timeoutMs: Math.max(cfg.timeoutMs, 3000),
  });
  const r = await client.choose(SYSTEMONE_SAMPLE, TIER_CHOICE_QUESTION);
  if (r.status !== 'ok') {
    return {
      ok: false,
      backend: cfg.backend,
      model: cfg.model,
      latencyMs: r.latencyMs,
      ranked: [] as { text: string; score: number }[],
      message: r.reason,
    };
  }
  return {
    ok: true,
    backend: cfg.backend,
    model: r.model,
    latencyMs: r.latencyMs,
    prompt: SYSTEMONE_SAMPLE,
    tier: r.choice,
    confidence: r.confidence,
    probabilities: r.probabilities,
    // Same shape the settings panels already render for the reranker test.
    ranked: Object.entries(r.probabilities as Record<string, number>)
      .map(([text, score]) => ({ text, score }))
      .sort((a, b) => b.score - a.score),
  };
}
