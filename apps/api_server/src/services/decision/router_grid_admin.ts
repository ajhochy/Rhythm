import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { env } from '../../config/env';
import { getDb } from '../../database/db';
import defaults from './router_grid.default.json';
import { listDecisions } from './decision_log';
import { RouterGridExhaustionStore } from './router_grid_exhaustion';
import { loadRouterGridConfig, normaliseRouterGridConfig, routerGridConfigPath, type GridCategory } from './router_grid_config';

// Settings surface for the Grid policy: the SAME router-grid.json file loadRouterGridConfig() reads
// on every routed turn. No second copy of the policy lives anywhere else.

export class RouterGridConfigError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const categories: GridCategory[] = ['coding', 'design', 'knowledge'];
/** Efforts the config validator accepts; the applied effort is clamped to the served model's variants. */
export const GRID_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
/** Only the routing policy is editable here; free_mode/models/task_type_overrides stay file-only. */
const EDITABLE = ['routing', 'openrouter_fallback', 'reserve_pct', 'coding_t1_prefer_astra', 'classifier'] as const;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Raw override file: {} when absent; throws when present but unreadable so a save never clobbers it. */
function readRaw(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { raw = null; }
  if (!isObj(raw)) throw new RouterGridConfigError('router_grid_config_unreadable', 'router-grid.json is not valid JSON; fix or remove it before saving from settings.');
  return raw;
}

async function accounts() {
  const out: Array<{ provider: 'anthropic' | 'openai'; id: string; label: string | null; status: string | null }> = [];
  try {
    // Lazy, like router_grid_turn: the account services touch their stores on import.
    const services = [['anthropic', (await import('../anthropic_accounts_service')).anthropicAccountsService],
      ['openai', (await import('../openai_accounts_service')).openaiAccountsService]] as const;
    for (const [provider, service] of services)
      for (const a of service.listRedacted().accounts as unknown as Array<Record<string, unknown>>)
        out.push({ provider, id: String(a.id), label: typeof a.label === 'string' ? a.label : null, status: typeof a.status === 'string' ? a.status : null });
  } catch { /* inventory unavailable: show none rather than fail the view */ }
  return out;
}

export async function routerGridView(path = routerGridConfigPath()) {
  let reason: string | null = null;
  const config = loadRouterGridConfig(path, (r) => { reason = r; });
  let raw: Record<string, unknown> = {};
  try { raw = readRaw(path); } catch { /* reason already reports invalid */ }
  const rawRouting = { ...(defaults.routing as Record<string, unknown>), ...(isObj(raw.routing) ? raw.routing : {}) };
  const aliases: Partial<Record<GridCategory, GridCategory>> = {};
  for (const c of categories) {
    const r = rawRouting[c];
    if (typeof r === 'string' && r.startsWith('SAME_AS:')) aliases[c] = r.slice(8) as GridCategory;
  }
  // The loader reports a missing file as unavailable too; only an existing file can be invalid.
  const present = existsSync(path);
  return {
    source: !present ? 'defaults' as const : reason ? 'defaults_after_invalid_file' as const : 'file' as const,
    invalidReason: present ? reason : null,
    version: config.version,
    reserve_pct: config.reserve_pct,
    coding_t1_prefer_astra: config.coding_t1_prefer_astra,
    classifier: config.classifier,
    models: config.models,
    routing: config.routing,
    openrouter_fallback: config.openrouter_fallback,
    aliases,
    efforts: [...GRID_EFFORTS],
    accounts: await accounts(),
    exhaustion: new RouterGridExhaustionStore().list(),
  };
}

/** Top-level editable keys replace per category (routing/fallback) or merge (classifier); validated, then atomically written. */
export async function saveRouterGridPolicy(body: unknown, path = routerGridConfigPath()) {
  if (!isObj(body)) throw new RouterGridConfigError('invalid_body', 'Body must be an object.');
  const unknown = Object.keys(body).filter((k) => !(EDITABLE as readonly string[]).includes(k));
  if (unknown.length) throw new RouterGridConfigError('invalid_body', `Not editable here: ${unknown.join(', ')}.`);
  const next = readRaw(path);
  for (const key of ['routing', 'openrouter_fallback', 'classifier'] as const) {
    if (body[key] === undefined) continue;
    if (!isObj(body[key])) throw new RouterGridConfigError('invalid_body', `${key} must be an object.`);
    next[key] = { ...(isObj(next[key]) ? next[key] : {}), ...(body[key] as object) };
  }
  if (body.reserve_pct !== undefined) next.reserve_pct = body.reserve_pct;
  if (body.coding_t1_prefer_astra !== undefined) next.coding_t1_prefer_astra = body.coding_t1_prefer_astra;
  try { normaliseRouterGridConfig(next); } catch (err) {
    throw new RouterGridConfigError('invalid_router_grid_config', err instanceof Error && err.message === 'invalid_router_free_config'
      ? 'Free mode settings in router-grid.json are invalid.'
      : 'Rejected: every tier needs valid candidates (known anthropic/openai model, supported effort, cost ≥ 0) and fallbacks must be priced openrouter models.');
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* best-effort */ }
  return routerGridView(path);
}

/** Most recent Grid model_routing decision, plus the first model the provider reported serving after it. */
export function lastGridDecision() {
  const row = listDecisions({ feature: 'model_routing', limit: 200 }).find((r) => r.detail.engine === 'grid');
  if (!row) return null;
  const d = row.detail;
  let served: { servedModelId: string; requestModelId: string | null; at: string } | null = null;
  if (row.sessionId && env.dbClient === 'sqlite') {
    try {
      const s = getDb().prepare(`SELECT served_model_id, request_model_id, created_at FROM agent_served_steps
        WHERE session_id = ? AND created_at >= ? ORDER BY rowid ASC LIMIT 1`).get(row.sessionId, row.createdAt) as
        { served_model_id: string; request_model_id: string | null; created_at: string } | undefined;
      if (s) served = { servedModelId: s.served_model_id, requestModelId: s.request_model_id, at: s.created_at };
    } catch { /* provenance table unavailable */ }
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  // Never the prompt preview: settings shows routing facts only.
  return {
    at: row.createdAt, mode: row.mode, status: row.status, applied: row.applied, sessionId: row.sessionId,
    kind: str(d.kind), reason: str(d.reason), category: str(d.category), tier: typeof d.tier === 'number' ? d.tier : null,
    tierUsed: typeof d.tierUsed === 'number' ? d.tierUsed : null,
    classifierSource: str(d.classifierSource), classifierReason: str(d.classifierReason),
    model: str(d.model), provider: str(d.provider), effortRequested: str(d.effortRequested), effortApplied: str(d.effortApplied),
    accountId: str(d.accountId), accountSource: str(d.accountSource), degraded: d.degraded === true,
    errorName: str(d.errorName), trace: Array.isArray(d.trace) ? d.trace.slice(0, 50) : [], served,
  };
}
