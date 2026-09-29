import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/**
 * Persisted router-backend settings (local / Jev / custom). Sits beside the
 * other Rhythm app-support stores, mode 0600. API keys are write-only: they are
 * stored here but never returned by the API and never logged. Precedence
 * (applied in config/env.ts): explicit env var > saved setting > default.
 * This module deliberately has no dependency on config/env (env imports it).
 */
export type DecisionBackend = 'local' | 'jev' | 'custom';
export type DecisionScoreScaleSetting = 'auto' | 'probability' | 'logit';
export type DecisionFeatureSetting = 'default' | 'off' | 'shadow' | 'on';
export type DecisionFeatureKey =
  | 'model_routing' | 'tool_ranking' | 'memory_ranking' | 'capacity_routing';

export const DECISION_FEATURE_KEYS: readonly DecisionFeatureKey[] = [
  'model_routing', 'tool_ranking', 'memory_ranking', 'capacity_routing',
];

export interface DecisionSettings {
  version: 1;
  backend: DecisionBackend;
  local: { baseUrl: string; model: string; scoreScale: DecisionScoreScaleSetting };
  jev: { baseUrl: string; model: string; apiKey: string };
  custom: { baseUrl: string; model: string; scoreScale: DecisionScoreScaleSetting; apiKey: string };
  /** null = not set by the user (400ms local, 1500ms jev/custom). */
  timeoutMs: number | null;
  remoteDataConsent: boolean;
  features: Record<DecisionFeatureKey, DecisionFeatureSetting>;
}

export const DEFAULT_LOCAL_TIMEOUT_MS = 400;
export const DEFAULT_REMOTE_TIMEOUT_MS = 1500;

export function defaultDecisionSettings(): DecisionSettings {
  return {
    version: 1,
    backend: 'local',
    local: { baseUrl: 'http://127.0.0.1:8012', model: 'qwen3-reranker-4b', scoreScale: 'auto' },
    jev: { baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', apiKey: '' },
    custom: { baseUrl: '', model: '', scoreScale: 'auto', apiKey: '' },
    timeoutMs: null,
    remoteDataConsent: false,
    features: {
      model_routing: 'default', tool_ranking: 'default',
      memory_ranking: 'default', capacity_routing: 'default',
    },
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
  const features = asObj(r.features);
  const out: DecisionSettings = {
    version: 1,
    backend: r.backend === 'jev' || r.backend === 'custom' ? r.backend : 'local',
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
    timeoutMs:
      typeof r.timeoutMs === 'number' && Number.isInteger(r.timeoutMs) && r.timeoutMs > 0
        ? r.timeoutMs
        : null,
    remoteDataConsent: r.remoteDataConsent === true,
    features: { ...d.features },
  };
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
};

/** Setting keys pinned by explicitly set (non-empty) env vars. */
export function decisionLockedByEnv(): string[] {
  return Object.entries(ENV_KEYS)
    .filter(([, envName]) => (process.env[envName] ?? '').trim() !== '')
    .map(([key]) => key);
}

/** The settings section for the active backend (baseUrl/model). */
export function activeBackendSection(s: DecisionSettings): { baseUrl: string; model: string } {
  return s[s.backend];
}
