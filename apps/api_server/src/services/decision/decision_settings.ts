import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/**
 * Persisted router-backend settings (local / Jev / custom / System One). Sits beside the
 * other Rhythm app-support stores, mode 0600. API keys are write-only: they are
 * stored here but never returned by the API and never logged. Precedence
 * (applied in config/env.ts): explicit env var > saved setting > default.
 * This module deliberately has no dependency on config/env (env imports it).
 */
export type DecisionBackend = 'local' | 'jev' | 'custom' | 'systemone' | 'openai_decisions';
export type LowConfidenceTier = 'keep' | 'standard';
export type DecisionScoreScaleSetting = 'auto' | 'probability' | 'logit';
export type DecisionFeatureSetting = 'default' | 'off' | 'shadow' | 'on';
export type DecisionFeatureKey =
  | 'model_routing' | 'tool_ranking' | 'memory_ranking' | 'capacity_routing';

export type DecisionRoutingScope = 'first_prompt' | 'escalate_only' | 'every_prompt';
export const DECISION_ROUTING_SCOPES: readonly DecisionRoutingScope[] = [
  'first_prompt', 'escalate_only', 'every_prompt',
];
export const DEFAULT_ROUTING_SCOPE: DecisionRoutingScope = 'first_prompt';
export const DEFAULT_ESCALATE_MIN_CONFIDENCE = 0.75;

export type RouterTierName = 'cheap' | 'standard' | 'frontier';
export const ROUTER_TIER_NAMES: readonly RouterTierName[] = ['cheap', 'standard', 'frontier'];
/** USD per 1M output tokens: <= cheapMax is cheap, >= frontierMin is frontier, else standard. */
export const DEFAULT_CHEAP_MAX_OUTPUT_USD = 6;
export const DEFAULT_FRONTIER_MIN_OUTPUT_USD = 25;

export const DECISION_FEATURE_KEYS: readonly DecisionFeatureKey[] = [
  'model_routing', 'tool_ranking', 'memory_ranking', 'capacity_routing',
];

export interface DecisionSettings {
  version: 1;
  backend: DecisionBackend;
  local: { baseUrl: string; model: string; scoreScale: DecisionScoreScaleSetting };
  jev: { baseUrl: string; model: string; apiKey: string };
  custom: { baseUrl: string; model: string; scoreScale: DecisionScoreScaleSetting; apiKey: string };
  /** Jev-compatible `/v1/systemone` (local Kev, or hosted Jev at https://api.typesafe.ai). */
  systemone: { baseUrl: string; model: string; apiKey: string };
  openaiDecisions: { baseUrl: string; model: string; apiKey: string };
  /** null = not set by the user (400ms local, 1000ms systemone, 1500ms jev/custom). */
  timeoutMs: number | null;
  remoteDataConsent: boolean;
  features: Record<DecisionFeatureKey, DecisionFeatureSetting>;
  routing: {
    engine: 'legacy' | 'grid';
    scope: DecisionRoutingScope;
    escalateMinConfidence: number;
    /** Below this classifier confidence the tier is not applied as-is. */
    minConfidence: number;
    /** null = backend default ('standard' for systemone, 'keep' otherwise). */
    lowConfidenceTier: LowConfidenceTier | null;
  };
  /** Live-catalog tier bands by output price (USD per 1M tokens). */
  tiers: {
    /** auto: cutoffs derived from the routable catalog; manual: the two values below. */
    mode: 'auto' | 'manual';
    /** Manual cutoffs (also the auto-mode fallback when the catalog is too small to derive). */
    cheapMaxOutputUsd: number;
    frontierMinOutputUsd: number;
  };
  /** "provider/model" -> tier; wins over the price band and the name heuristic. */
  tierOverrides: Record<string, RouterTierName>;
  /** "provider/model" ids the router never picks. */
  excludedModels: string[];
}

export const DEFAULT_LOCAL_TIMEOUT_MS = 400;
export const DEFAULT_REMOTE_TIMEOUT_MS = 1500;
export const DEFAULT_SYSTEMONE_TIMEOUT_MS = 1000;
export const DEFAULT_ROUTING_MIN_CONFIDENCE = 0.55;

/** Default per-call budget for a backend when timeoutMs is unset. */
export function defaultTimeoutFor(backend: DecisionBackend): number {
  if (backend === 'local') return DEFAULT_LOCAL_TIMEOUT_MS;
  if (backend === 'systemone' || backend === 'openai_decisions') return DEFAULT_SYSTEMONE_TIMEOUT_MS;
  return DEFAULT_REMOTE_TIMEOUT_MS;
}

/** What routing does with a low-confidence answer: keep the current route, or use standard. */
export function effectiveLowConfidenceTier(s: DecisionSettings): LowConfidenceTier {
  return s.routing.lowConfidenceTier ?? (s.backend === 'systemone' ? 'standard' : 'keep');
}

export function defaultDecisionSettings(): DecisionSettings {
  return {
    version: 1,
    backend: 'local',
    local: { baseUrl: 'http://127.0.0.1:8012', model: 'qwen3-reranker-4b', scoreScale: 'auto' },
    jev: { baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', apiKey: '' },
    custom: { baseUrl: '', model: '', scoreScale: 'auto', apiKey: '' },
    systemone: { baseUrl: 'http://127.0.0.1:8009', model: 'kev-latest', apiKey: '' },
    openaiDecisions: { baseUrl: 'https://api.openai.com', model: 'gpt-6-luna', apiKey: '' },
    timeoutMs: null,
    remoteDataConsent: false,
    features: {
      model_routing: 'default', tool_ranking: 'default',
      memory_ranking: 'default', capacity_routing: 'default',
    },
    routing: {
      engine: 'legacy',
      scope: DEFAULT_ROUTING_SCOPE,
      escalateMinConfidence: DEFAULT_ESCALATE_MIN_CONFIDENCE,
      minConfidence: DEFAULT_ROUTING_MIN_CONFIDENCE,
      lowConfidenceTier: null,
    },
    tiers: {
      mode: 'auto',
      cheapMaxOutputUsd: DEFAULT_CHEAP_MAX_OUTPUT_USD,
      frontierMinOutputUsd: DEFAULT_FRONTIER_MIN_OUTPUT_USD,
    },
    tierOverrides: {},
    excludedModels: [],
  };
}

export function decisionSettingsPath(): string {
  return (
    process.env.RHYTHM_DECISION_ROUTER_FILE ??
    join(homedir(), 'Library', 'Application Support', 'Rhythm', 'decision-router.json')
  );
}

const asStr = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const asScale = (v: unknown, fallback: DecisionScoreScaleSetting): DecisionScoreScaleSetting =>
  v === 'auto' || v === 'probability' || v === 'logit' ? v : fallback;
const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Tolerant normaliser: unknown/garbled fields fall back to defaults. */
export function normaliseDecisionSettings(raw: unknown): DecisionSettings {
  const d = defaultDecisionSettings();
  const r = asObj(raw);
  const local = asObj(r.local);
  const jev = asObj(r.jev);
  const custom = asObj(r.custom);
  const systemone = asObj(r.systemone);
  const openaiDecisions = asObj(r.openaiDecisions);
  const features = asObj(r.features);
  const out: DecisionSettings = {
    version: 1,
    backend: r.backend === 'jev' || r.backend === 'custom' || r.backend === 'systemone' || r.backend === 'openai_decisions' ? r.backend : 'local',
    local: {
      baseUrl: asStr(local.baseUrl, d.local.baseUrl) || d.local.baseUrl,
      model: asStr(local.model, d.local.model) || d.local.model,
      scoreScale: asScale(local.scoreScale, 'auto'),
    },
    jev: {
      baseUrl: asStr(jev.baseUrl, d.jev.baseUrl) || d.jev.baseUrl,
      model: asStr(jev.model, d.jev.model) || d.jev.model,
      apiKey: asStr(jev.apiKey, ''),
    },
    custom: {
      baseUrl: asStr(custom.baseUrl, ''),
      model: asStr(custom.model, ''),
      scoreScale: asScale(custom.scoreScale, 'auto'),
      apiKey: asStr(custom.apiKey, ''),
    },
    systemone: {
      baseUrl: asStr(systemone.baseUrl, d.systemone.baseUrl) || d.systemone.baseUrl,
      model: asStr(systemone.model, d.systemone.model) || d.systemone.model,
      apiKey: asStr(systemone.apiKey, ''),
    },
    openaiDecisions: {
      baseUrl: asStr(openaiDecisions.baseUrl, d.openaiDecisions.baseUrl) || d.openaiDecisions.baseUrl,
      model: asStr(openaiDecisions.model, d.openaiDecisions.model) || d.openaiDecisions.model,
      apiKey: asStr(openaiDecisions.apiKey, ''),
    },
    timeoutMs:
      typeof r.timeoutMs === 'number' && Number.isInteger(r.timeoutMs) && r.timeoutMs > 0
        ? r.timeoutMs
        : null,
    remoteDataConsent: r.remoteDataConsent === true,
    features: { ...d.features },
    routing: { ...d.routing },
    tiers: { ...d.tiers },
    tierOverrides: {},
    excludedModels: [],
  };
  const tiers = asObj(r.tiers);
  if (tiers.mode === 'manual' || tiers.mode === 'auto') out.tiers.mode = tiers.mode;
  const cheapMax = tiers.cheapMaxOutputUsd;
  const frontierMin = tiers.frontierMinOutputUsd;
  if (
    typeof cheapMax === 'number' && typeof frontierMin === 'number' &&
    Number.isFinite(cheapMax) && Number.isFinite(frontierMin) &&
    cheapMax > 0 && frontierMin > cheapMax
  ) {
    out.tiers.cheapMaxOutputUsd = cheapMax;
    out.tiers.frontierMinOutputUsd = frontierMin;
  }
  for (const [id, tier] of Object.entries(asObj(r.tierOverrides))) {
    if (id.includes('/') && (ROUTER_TIER_NAMES as readonly unknown[]).includes(tier)) {
      out.tierOverrides[id] = tier as RouterTierName;
    }
  }
  if (Array.isArray(r.excludedModels)) {
    out.excludedModels = [
      ...new Set(r.excludedModels.filter((v): v is string => typeof v === 'string' && v.includes('/'))),
    ];
  }
  const routing = asObj(r.routing);
  if (routing.engine === 'grid') out.routing.engine = 'grid';
  if ((DECISION_ROUTING_SCOPES as readonly unknown[]).includes(routing.scope)) {
    out.routing.scope = routing.scope as DecisionRoutingScope;
  }
  if (
    typeof routing.escalateMinConfidence === 'number' &&
    routing.escalateMinConfidence > 0 &&
    routing.escalateMinConfidence <= 1
  ) {
    out.routing.escalateMinConfidence = routing.escalateMinConfidence;
  }
  if (
    typeof routing.minConfidence === 'number' &&
    routing.minConfidence > 0 &&
    routing.minConfidence <= 1
  ) {
    out.routing.minConfidence = routing.minConfidence;
  }
  if (routing.lowConfidenceTier === 'keep' || routing.lowConfidenceTier === 'standard') {
    out.routing.lowConfidenceTier = routing.lowConfidenceTier;
  }
  for (const key of DECISION_FEATURE_KEYS) {
    const v = features[key];
    if (v === 'default' || v === 'off' || v === 'shadow' || v === 'on') out.features[key] = v;
  }
  return out;
}

let cache: { path: string; mtimeMs: number; size: number; settings: DecisionSettings } | null = null;

/** Mtime-cached: the prompt path calls this every turn. Never throws. */
export function loadDecisionSettings(): DecisionSettings {
  const path = decisionSettingsPath();
  try {
    if (!existsSync(path)) {
      cache = null;
      return defaultDecisionSettings();
    }
    const st = statSync(path);
    if (cache && cache.path === path && cache.mtimeMs === st.mtimeMs && cache.size === st.size) {
      return cache.settings;
    }
    const settings = normaliseDecisionSettings(JSON.parse(readFileSync(path, 'utf8')));
    cache = { path, mtimeMs: st.mtimeMs, size: st.size, settings };
    return settings;
  } catch {
    // Corrupt/unreadable file: fall back to defaults; never log contents (keys).
    return defaultDecisionSettings();
  }
}

/** Atomic write, mode 0600. */
export function saveDecisionSettings(settings: DecisionSettings): void {
  const path = decisionSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort on non-posix */
  }
  cache = null;
}

export function resetDecisionSettingsCacheForTests(): void {
  cache = null;
}

const ENV_KEYS: Record<string, string> = {
  baseUrl: 'AGENT_DECISION_BASE_URL',
  model: 'AGENT_DECISION_MODEL',
  timeoutMs: 'AGENT_DECISION_TIMEOUT_MS',
  scoreScale: 'AGENT_DECISION_SCORE_SCALE',
  'features.model_routing': 'AGENT_DECISION_MODEL_ROUTING',
  'features.tool_ranking': 'AGENT_DECISION_TOOL_RANKING',
  'features.memory_ranking': 'AGENT_DECISION_MEMORY_RANKING',
  'features.capacity_routing': 'AGENT_DECISION_CAPACITY_ROUTING',
  'routing.scope': 'AGENT_DECISION_ROUTING_SCOPE',
  'routing.escalateMinConfidence': 'AGENT_DECISION_ESCALATE_MIN_CONFIDENCE',
  'routing.minConfidence': 'AGENT_DECISION_ROUTING_MIN_CONFIDENCE',
};

/** Setting keys pinned by explicitly set (non-empty) env vars. */
export function decisionLockedByEnv(): string[] {
  return Object.entries(ENV_KEYS)
    .filter(([, envName]) => (process.env[envName] ?? '').trim() !== '')
    .map(([key]) => key);
}

/** The settings section for the active backend (baseUrl/model). */
export function activeBackendSection(s: DecisionSettings): { baseUrl: string; model: string } {
  return s.backend === 'openai_decisions' ? s.openaiDecisions : s[s.backend];
}
