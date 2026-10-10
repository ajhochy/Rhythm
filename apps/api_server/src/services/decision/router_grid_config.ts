import { readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import defaults from './router_grid.default.json';
import { decisionSettingsPath } from './decision_settings';
import { validateRouterFreeConfig, type RouterFreeConfig } from './router_free_config';

export type GridTier = 1 | 2 | 3 | 4;
export type GridCategory = 'coding' | 'design' | 'knowledge';
export type ClosedProvider = 'anthropic' | 'openai';
export interface GridCandidate { model: string; effort: string; cost_per_task: number }
export type GridFallback = { action: 'queue_or_degrade'; degraded_model: string } | { models: string[] };
export interface RouterGridConfig {
  free_mode: RouterFreeConfig;
  version: string;
  reserve_pct: number;
  coding_t1_prefer_astra: boolean;
  agent_auto_profiles: string[];
  classifier: { model: string; tier_thresholds: [number, number, number]; can_queue_min_p: number; security_min_p: number; rules_default_tier: GridTier };
  models: Record<string, { price_in: number; price_out: number; long_prompt_threshold?: number; peak?: 'weekday' }>;
  routing: Record<GridCategory, Record<GridTier, GridCandidate[]>>;
  openrouter_fallback: Record<GridCategory, Record<GridTier, GridFallback>>;
  task_type_overrides: Record<string, unknown>;
}
const categories: GridCategory[] = ['coding', 'design', 'knowledge'];
const tiers: GridTier[] = [1, 2, 3, 4];
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const numberIn = (v: unknown, min: number, max = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
function requireValid(ok: unknown): asserts ok { if (!ok) throw new Error('invalid_router_grid_config'); }

/** Walk arrays too: structuredClone alone would copy nested prototype keys unchecked. */
function rejectPrototypeKeys(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  requireValid(Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  for (const [key, child] of Object.entries(value)) {
    requireValid(!['__proto__', 'constructor', 'prototype'].includes(key));
    rejectPrototypeKeys(child);
  }
}

/** Objects merge recursively, arrays replace; reject prototype keys at this file boundary. */
function merge(base: unknown, override: unknown): any {
  if (!object(override)) return structuredClone(override);
  const out = object(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(override)) {
    requireValid(!['__proto__', 'constructor', 'prototype'].includes(key));
    out[key] = merge(out[key], value);
  }
  return out;
}

/** Strict merged validation; loader falls back atomically if any override is malformed. */
export function normaliseRouterGridConfig(raw: unknown): RouterGridConfig {
  requireValid(object(raw));
  rejectPrototypeKeys(raw);
  const c = merge(defaults, raw);
  validateRouterFreeConfig(c.free_mode);
  c.agent_auto_profiles ??= [];
  requireValid(Array.isArray(c.agent_auto_profiles) && c.agent_auto_profiles.every(text));
  requireValid(text(c.version) && numberIn(c.reserve_pct, 0, 100) && typeof c.coding_t1_prefer_astra === 'boolean');
  requireValid(object(c.classifier));
  const f = c.classifier;
  requireValid(text(f.model) && Array.isArray(f.tier_thresholds) && f.tier_thresholds.length === 3 &&
    f.tier_thresholds.every((v: unknown) => numberIn(v, 0, 3)) && f.tier_thresholds[0] < f.tier_thresholds[1] && f.tier_thresholds[1] < f.tier_thresholds[2] &&
    numberIn(f.can_queue_min_p, 0, 1) && numberIn(f.security_min_p, 0, 1) && tiers.includes(f.rules_default_tier));
  requireValid(object(c.models) && object(c.routing) && object(c.openrouter_fallback) && object(c.task_type_overrides));
  for (const [id, m] of Object.entries(c.models) as [string, any][]) {
    requireValid(/^(anthropic|openai|openrouter)\/.+/.test(id) && object(m) && numberIn(m.price_in, 0) && numberIn(m.price_out, 0) &&
      (m.long_prompt_threshold === undefined || numberIn(m.long_prompt_threshold, 1)) && (m.peak === undefined || m.peak === 'weekday'));
  }
  // Resolve aliases AFTER merging so knowledge tracks a coding override.
  function resolve(category: string, seen: string[] = []): any {
    requireValid(categories.includes(category as GridCategory) && !seen.includes(category));
    const route = c.routing[category];
    if (typeof route === 'string') {
      requireValid(route.startsWith('SAME_AS:'));
      return resolve(route.slice(8), [...seen, category]);
    }
    requireValid(object(route));
    return structuredClone(route);
  }
  const routing = Object.fromEntries(categories.map(k => [k, resolve(k)]));
  for (const category of categories) {
    requireValid(object(c.openrouter_fallback[category]));
    for (const tier of tiers) {
      const candidates = routing[category][tier];
      requireValid(Array.isArray(candidates));
      for (const cand of candidates) requireValid(object(cand) && text(cand.model) && /^(anthropic|openai)\//.test(cand.model) && c.models[cand.model] &&
        ['low', 'medium', 'high', 'xhigh', 'max'].includes(cand.effort) && numberIn(cand.cost_per_task, 0));
      const fb = c.openrouter_fallback[category][tier];
      requireValid(object(fb));
      if (fb.action === 'queue_or_degrade') requireValid(text(fb.degraded_model) && fb.degraded_model.startsWith('openrouter/') && c.models[fb.degraded_model]);
      else requireValid(fb.action === undefined && Array.isArray(fb.models) && fb.models.length > 0 && fb.models.every((id: unknown) => text(id) && id.startsWith('openrouter/') && c.models[id]));
    }
  }
  return { ...c, routing } as RouterGridConfig;
}
export function defaultRouterGridConfig(): RouterGridConfig { return normaliseRouterGridConfig({}); }
export function routerGridConfigPath(): string { return join(dirname(decisionSettingsPath()), 'router-grid.json'); }
let cache: { path: string; mtimeMs: number; size: number; config: RouterGridConfig } | null = null;
export function loadRouterGridConfig(path = routerGridConfigPath(), reportReason: (reason: string) => void = reason => console.warn(reason)): RouterGridConfig {
  try {
    const st = statSync(path);
    if (cache?.path === path && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.config;
    const config = normaliseRouterGridConfig(JSON.parse(readFileSync(path, 'utf8')));
    cache = { path, mtimeMs: st.mtimeMs, size: st.size, config };
    return config;
  } catch (error) {
    cache = null;
    // Fixed codes only: never expose a config body, path or parser exception.
    const reason = error instanceof Error && error.message === 'invalid_router_free_config'
      ? 'invalid_router_free_config' : 'router_grid_config_unavailable_or_invalid';
    reportReason(reason);
    return defaultRouterGridConfig();
  }
}
