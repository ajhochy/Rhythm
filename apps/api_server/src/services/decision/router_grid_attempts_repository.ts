import { env } from '../../config/env';
import { getDb, getPostgresPool } from '../../database/db';
import type { GridClassificationResult } from './router_grid_classifier';

type Json = Record<string, unknown>;
const tier = (v: unknown) => [1, 2, 3, 4].includes(v as number);
const id = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_.:/-]{1,200}$/.test(v);
const nullableId = (v: unknown) => v === null || id(v);
const effort = (v: unknown) => v === null || ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(v as string);
// Only local diagnostic codes, never provider error text.
const reason = (v: unknown) => typeof v === 'string' && /^(ok|empty|no_api_key|remote_consent_required|invalid_base_url|unsafe_endpoint|https_required|refusal|malformed_json|malformed_response|request_failed|response_too_large|account_exhausted|no_usable_route|model_unavailable|security_sensitive|openai_long_prompt|long_prompt|exhausted|reserve|no_eligible_account|weekday_peak|openrouter_unusable|degraded_no_queue_v1|closed_accounts_unavailable|free_mode_queued|http_[0-9]{3}|timeout_[0-9]+ms)$/.test(v);
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_grid_attempt');
  return value as Json;
}
function validate(value: unknown, fields: Record<string, (v: unknown) => boolean>, optional: string[] = []): Json {
  const row = object(value);
  if (Object.keys(row).some(k => !Object.hasOwn(fields, k)) || Object.entries(fields).some(([k, check]) =>
    !(optional.includes(k) && row[k] === undefined) && !check(row[k]))) throw new Error('invalid_grid_attempt');
  return Object.fromEntries(Object.keys(fields).filter(k => row[k] !== undefined).map(k => [k, row[k]]));
}
function classification(value: unknown): GridClassificationResult {
  return validate(value, { tier, category: v => ['coding', 'design', 'knowledge'].includes(v as string),
    canQueue: v => typeof v === 'boolean', securitySensitive: v => typeof v === 'boolean',
    estInputTokens: v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
    source: v => v === 'decisions' || v === 'rules', reason }) as unknown as GridClassificationResult;
}
function result(value: unknown): Json {
  const row = validate(value, { model: nullableId, provider: v => v === null || ['anthropic', 'openai', 'openrouter'].includes(v as string),
    effortRequested: effort, effortApplied: effort, accountId: nullableId,
    accountSource: v => v === 'pinned' || v === 'router', tierUsed: v => v === null || tier(v),
    kind: v => ['route', 'none', 'shadow', 'free_queued'].includes(v as string), reason, degraded: v => typeof v === 'boolean',
    applied: v => typeof v === 'boolean', trace: v => Array.isArray(v) && v.length <= 1000 }, ['applied']);
  // Legacy route rows predate the explicit application receipt and were written only after a successful route.
  if (row.applied === undefined) row.applied = false; // legacy pre-r26 route is ambiguous, never restart authorization
  row.trace = (row.trace as unknown[]).map(t => validate(t, {
    action: v => ['skip_rule', 'skip_account', 'pick_account', 'route', 'step_up', 'fallback', 'reorder', 'none'].includes(v as string),
    tier, model: id, accountId: id, reason, canQueue: v => typeof v === 'boolean',
  }, ['model', 'accountId', 'reason', 'canQueue']));
  if (row.kind === 'route' && (!row.model || !row.provider || !row.tierUsed || !(row.model as string).startsWith(`${row.provider}/`))) throw new Error('invalid_grid_attempt');
  return row;
}

/** Independent body-free ledger. Shadow picks use kind=shadow, never an applied route. */
export class RouterGridAttemptsRepository {
  async append(sessionId: string, c: unknown, r: unknown): Promise<void> {
    if (!id(sessionId)) throw new Error('invalid_grid_attempt');
    const values = [sessionId, new Date().toISOString(), JSON.stringify(classification(c)), JSON.stringify(result(r))];
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query('INSERT INTO agent_router_grid_attempts (session_id,created_at,classification_json,result_json) VALUES ($1,$2,$3,$4)', values);
    } else {
      getDb().prepare('INSERT INTO agent_router_grid_attempts (session_id,created_at,classification_json,result_json) VALUES (?,?,?,?)').run(...values);
    }
  }
  async readState(sessionId: string): Promise<{ classification: GridClassificationResult; model: string; provider: 'anthropic'|'openai'|'openrouter'; accountId: string | null; accountSource: 'pinned'|'router' } | null> {
    const pg = env.dbClient === 'postgres';
    const param = pg ? '$1' : '?';
    const sql = `SELECT classification_json,result_json FROM agent_router_grid_attempts WHERE session_id=${param} ORDER BY id`;
    const rows = pg ? (await getPostgresPool().query(sql, [sessionId])).rows
      : getDb().prepare(sql).all(sessionId) as { classification_json: string; result_json: string }[];
    if (!rows.length) return null;
    try {
      const first = classification(JSON.parse(rows[0].classification_json));
      const applied = rows.map(row => result(JSON.parse(row.result_json))).filter(r => r.kind === 'route' && r.applied === true).at(-1);
      return applied ? { classification: first, model: applied.model as string, provider: applied.provider as 'anthropic'|'openai'|'openrouter',
        accountId: applied.accountId as string | null, accountSource: applied.accountSource as 'pinned'|'router' } : null;
    } catch { return null; } // Corrupt ledger cannot authorize a new classification.
  }
  async isRouterOwnedAccount(sessionId: string, provider: 'anthropic'|'openai', accountId: string): Promise<boolean> {
    const state = await this.readState(sessionId);
    return !!state && state.accountSource === 'router' && state.provider === provider && state.accountId === accountId;
  }
  /** User pin transition: append body-free durable provenance when the latest routed model uses this provider. */
  async markPinned(sessionId: string, provider: 'anthropic'|'openai', accountId: string): Promise<void> {
    const pg = env.dbClient === 'postgres';
    const sql = `SELECT classification_json,result_json FROM agent_router_grid_attempts WHERE session_id=${pg ? '$1' : '?'} ORDER BY id DESC`;
    const rows = pg ? (await getPostgresPool().query(sql, [sessionId])).rows
      : getDb().prepare(sql).all(sessionId) as { classification_json: string; result_json: string }[];
    for (const row of rows) {
      let c: GridClassificationResult; let r: Json;
      try { c = classification(JSON.parse(row.classification_json)); r = result(JSON.parse(row.result_json)); }
      catch { return; } // corrupt/missing/ambiguous provenance never authorizes auto
      if (r.kind !== 'route' || r.applied !== true) continue;
      if (r.provider !== provider) return; // sibling-provider pin remains explicit by safe default
      // Durable ownership is the transaction boundary: INSERT errors must fail the caller/PATCH truthfully.
      await this.append(sessionId, c, { ...r, accountId, accountSource: 'pinned', applied: true }); return;
    }
  }
  /** Stored classification of a Free-held turn (latest row only), reused instead of reclassifying. */
  async readFreeQueued(sessionId: string): Promise<GridClassificationResult | null> {
    const pg = env.dbClient === 'postgres';
    const sql = `SELECT classification_json,result_json FROM agent_router_grid_attempts WHERE session_id=${pg ? '$1' : '?'} ORDER BY id DESC LIMIT 1`;
    const row = (pg ? (await getPostgresPool().query(sql, [sessionId])).rows[0]
      : getDb().prepare(sql).get(sessionId)) as { classification_json: string; result_json: string } | undefined;
    if (!row) return null;
    try {
      return result(JSON.parse(row.result_json)).kind === 'free_queued' ? classification(JSON.parse(row.classification_json)) : null;
    } catch { return null; }
  }
}
