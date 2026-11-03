import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { env } from '../../config/env';
import { getDb, getPostgresPool } from '../../database/db';
import { OpencodeAuthStore } from '../opencode_auth_store';
import { getUsageBudget } from '../usage_budget_service';
import { isLoopbackHost } from './decision_client';
import { decisionSettingsPath } from './decision_settings';
import { executeFreeExtraction, publicContextPreflight, type ExtractionTask, type FreeExtractionResult } from './router_free_extraction';
import { executePublicCoding, executePublicImageDesign, validatePublicCodingTask, validatePublicImageTask, type PublicCodingTask, type PublicFreeTask, type PublicImageAsset, type PublicImageDesignTask, type PublicTaskResult } from './router_free_public_tasks';
import { checkFreeMode, freeStore, type FreeModeState } from './router_free_runtime';
import { loadRouterGridConfig, type RouterGridConfig } from './router_grid_config';
import { RouterGridExhaustionStore } from './router_grid_exhaustion';
import { accountsFromSnapshot } from './router_grid_select';

/**
 * Free structured-extraction entry point (F3). Provenance is server-side only: source text comes from the
 * operator registry file, the owner opt-in from agent_free_opt_ins. See plans/2026-10-09-free-mode-drain-verifier-design.md.
 */
export const TASK_KIND = 'structured_extraction';
export interface FreeExtractionOperatorConfig {
  endpoint: { baseUrl: string; authProvider: string };
  qualifiedFreeModels: string[];
  publicSources: Array<{ id: string; label: string; text: string; classification?: { tier: 1|2|3|4; category: 'knowledge'; canQueue: boolean } }>;
  publicTasks: PublicFreeTask[];
  publicImages: PublicImageAsset[];
}
export function routerFreeExtractionOperatorPath(): string { return join(dirname(decisionSettingsPath()), 'router-free-extraction.json'); }

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
function gridFreeModels(config: RouterGridConfig): Set<string> {
  const f = config.free_mode;
  return new Set([...Object.values(f.grid).flatMap(byTier => Object.values(byTier).flat().map(c => c.model)), f.image_helper.model, f.random_fallback.model]);
}
/** Operator file only (no write API). Absent -> not_configured; any schema problem -> invalid (fail closed). */
export function loadFreeExtractionOperatorConfig(config: RouterGridConfig, path = routerFreeExtractionOperatorPath()):
  { kind: 'ok'; value: FreeExtractionOperatorConfig } | { kind: 'not_configured' | 'invalid' } {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { return (err as { code?: string }).code === 'ENOENT' ? { kind: 'not_configured' } : { kind: 'invalid' }; }
  if (!plain(raw) || raw.version !== 1 || !onlyKeys(raw, ['version', 'endpoint', 'qualifiedFreeModels', 'publicSources', 'publicTasks', 'publicImages'])) return { kind: 'invalid' };
  const { endpoint, qualifiedFreeModels: models, publicSources: sources } = raw;
  const tasks = raw.publicTasks ?? [], images = raw.publicImages ?? [];
  if (!plain(endpoint) || !onlyKeys(endpoint, ['baseUrl', 'authProvider']) || typeof endpoint.baseUrl !== 'string'
    || typeof endpoint.authProvider !== 'string' || !ID.test(endpoint.authProvider)) return { kind: 'invalid' };
  let url: URL;
  try { url = new URL(endpoint.baseUrl); } catch { return { kind: 'invalid' }; }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) || url.search || url.hash || url.username || url.password) return { kind: 'invalid' };
  const known = gridFreeModels(config);
  if (!Array.isArray(models) || models.length > 20 || models.some(m => typeof m !== 'string' || !known.has(m))) return { kind: 'invalid' };
  if (!Array.isArray(sources) || sources.length > 100 || !Array.isArray(tasks) || tasks.length > 100 || !Array.isArray(images) || images.length > 100) return { kind: 'invalid' };
  const imageList = images as PublicImageAsset[];
  const taskList = tasks as PublicFreeTask[];
  if (imageList.some(a => !a || !ID.test(a.id)) || new Set(imageList.map(a => a.id)).size !== imageList.length
    || taskList.some(t => t?.kind === 'coding' ? !validatePublicCodingTask(t as PublicCodingTask)
      : t?.kind === 'image_design' ? !validatePublicImageTask(t as PublicImageDesignTask, imageList.find(a => a.id === (t as PublicImageDesignTask).imageId)) : true)
    || new Set(taskList.map(t => t.id)).size !== taskList.length) return { kind: 'invalid' };
  const ids = new Set<string>();
  for (const s of sources) {
    if (!plain(s) || !onlyKeys(s, ['id', 'label', 'text', 'classification']) || typeof s.id !== 'string' || !ID.test(s.id) || ids.has(s.id)
      || typeof s.label !== 'string' || !s.label.trim() || s.label.length > 200
      || typeof s.text !== 'string' || !s.text.trim() || s.text.length > 20_000
      || (s.classification !== undefined && (!plain(s.classification) || !onlyKeys(s.classification, ['tier','category','canQueue'])
        || ![1,2,3,4].includes(s.classification.tier as number) || s.classification.category !== 'knowledge' || typeof s.classification.canQueue !== 'boolean'))) return { kind: 'invalid' };
    ids.add(s.id);
  }
  return { kind: 'ok', value: { endpoint: { baseUrl: endpoint.baseUrl, authProvider: endpoint.authProvider },
    qualifiedFreeModels: models as string[], publicSources: sources as FreeExtractionOperatorConfig['publicSources'], publicTasks: taskList, publicImages: imageList } };
}

const pg = () => env.dbClient === 'postgres';
/** Stored owner opt-in: the only accepted proof. Written only by the owner's authenticated request. */
export class FreeOptInRepository {
  async get(ownerUserId: number): Promise<boolean> {
    const sql = `SELECT enabled FROM agent_free_opt_ins WHERE owner_user_id=${pg() ? '$1' : '?'} AND task_kind=${pg() ? '$2' : '?'}`;
    const row = (pg() ? (await getPostgresPool().query(sql, [ownerUserId, TASK_KIND])).rows[0] : getDb().prepare(sql).get(ownerUserId, TASK_KIND)) as { enabled: number } | undefined;
    return Number(row?.enabled) === 1;
  }
  async set(ownerUserId: number, enabled: boolean): Promise<void> {
    const params = [ownerUserId, TASK_KIND, enabled ? 1 : 0, new Date().toISOString()];
    const conflict = 'ON CONFLICT(owner_user_id, task_kind) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at';
    if (pg()) await getPostgresPool().query(`INSERT INTO agent_free_opt_ins (owner_user_id,task_kind,enabled,updated_at) VALUES ($1,$2,$3,$4) ${conflict}`, params);
    else getDb().prepare(`INSERT INTO agent_free_opt_ins (owner_user_id,task_kind,enabled,updated_at) VALUES (?,?,?,?) ${conflict}`).run(...params);
  }
}

/**
 * Free Mode state from the same capacity inputs as routeGridTurn (cached usage, fresh-or-unknown, cooldowns,
 * healthy local inventory). ponytail: duplicated from routeGridTurn's capacity block so the live dispatch path is
 * untouched; extract a shared helper if a third caller appears.
 */
export async function freeModeNow(config: RouterGridConfig, now = Date.now()): Promise<FreeModeState> {
  const exhaustion = new RouterGridExhaustionStore().list();
  const snapshot = await getUsageBudget({ cachedOnly: true });
  const fresh = !!snapshot?.providers.length && Number.isFinite(Date.parse(snapshot.fetchedAt)) && now - Date.parse(snapshot.fetchedAt) <= 15 * 60_000;
  const accounts = snapshot ? accountsFromSnapshot(snapshot, exhaustion) : [];
  if (!fresh) accounts.forEach(a => { a.quotaRemainingPct = null; });
  const { anthropicAccountsService } = await import('../anthropic_accounts_service');
  const { openaiAccountsService } = await import('../openai_accounts_service');
  for (const [provider, service] of [['anthropic', anthropicAccountsService], ['openai', openaiAccountsService]] as const) {
    for (const a of service.listRedacted().accounts) {
      if (a.status !== 'ok' || accounts.some(e => e.provider === provider && e.id === a.id)) continue;
      accounts.push({ provider, id: a.id, quotaRemainingPct: null, resetsAt: null,
        exhaustedUntil: exhaustion.find(e => e.provider === provider && e.accountId === a.id)?.exhaustedUntil ?? null });
    }
  }
  const { opencodeClient } = await import('../opencode_engine');
  const authed = new Set(await opencodeClient.listAuthedProviders());
  return checkFreeMode({ config, accounts, usageFresh: fresh, openrouterUsable: authed.has('openrouter'), tier: 3, now });
}

export type FreeExtractionResponse = FreeExtractionResult | { kind: 'invalid_request'; reason: string };
export interface FreeExtractionApiDeps {
  loadConfig?: () => RouterGridConfig; operatorPath?: string; optIns?: Pick<FreeOptInRepository, 'get'>;
  freeMode?: (config: RouterGridConfig) => Promise<FreeModeState>; apiKey?: (provider: string) => string | null; fetchImpl?: typeof fetch;
}
export async function runFreeExtractionRequest(ownerUserId: number, body: unknown, deps: FreeExtractionApiDeps = {}): Promise<FreeExtractionResponse> {
  // The client names a registry source and a schema; it can never supply text, provenance, opt-in or context.
  if (!plain(body)) return { kind: 'invalid_request', reason: 'body_not_object' };
  const extra = Object.keys(body).find(k => !['publicSourceId', 'fields'].includes(k));
  if (extra) return { kind: 'invalid_request', reason: `client_field_not_accepted:${extra}` };
  if (typeof body.publicSourceId !== 'string' || !ID.test(body.publicSourceId)) return { kind: 'invalid_request', reason: 'invalid_public_source_id' };
  const held = (reason: string): FreeExtractionResponse => ({ kind: 'held', reason });
  const config = (deps.loadConfig ?? loadRouterGridConfig)();
  if (config.free_mode.enabled !== true) return held('disabled');
  const operator = loadFreeExtractionOperatorConfig(config, deps.operatorPath);
  if (operator.kind !== 'ok') return held(operator.kind === 'invalid' ? 'operator_config_invalid' : 'not_configured');
  const source = operator.value.publicSources.find(s => s.id === body.publicSourceId);
  if (!source) return held('unknown_public_source');
  const task: ExtractionTask = { kind: TASK_KIND, taskId: randomUUID(), sourceText: source.text, fields: body.fields as ExtractionTask['fields'],
    publicSource: { trusted: true, label: source.label }, ownerOptIn: await (deps.optIns ?? new FreeOptInRepository()).get(ownerUserId),
    attachments: [], context: { memory: false, dayflow: false, history: false, profilePrompt: false } };
  // Local, before capacity, reservation or any request.
  if (publicContextPreflight(task).privacy !== false) return held('privacy');
  if (!(await (deps.freeMode ?? freeModeNow)(config)).active) return held('paid_capacity_available');
  const apiKey = (deps.apiKey ?? (p => new OpencodeAuthStore().apiKey(p)))(operator.value.endpoint.authProvider);
  if (!apiKey) return held('no_credential');
  return executeFreeExtraction(task, { config, store: freeStore(config), verifiedFreeModels: new Set(operator.value.qualifiedFreeModels),
    baseUrl: operator.value.endpoint.baseUrl, apiKey, ...(source.classification ? { classification: { ...source.classification, containsPrivateData: false as const } } : {}),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
}

export type PublicTaskResponse = PublicTaskResult | { kind: 'invalid_request'; reason: string };
/** Registered public coding/image tasks. Client supplies ONLY the operator task id. */
export async function runPublicFreeTaskRequest(ownerUserId: number, body: unknown, deps: FreeExtractionApiDeps = {}): Promise<PublicTaskResponse> {
  if (!plain(body)) return { kind: 'invalid_request', reason: 'body_not_object' };
  const extra = Object.keys(body).find(k => k !== 'publicTaskId');
  if (extra) return { kind: 'invalid_request', reason: `client_field_not_accepted:${extra}` };
  if (typeof body.publicTaskId !== 'string' || !ID.test(body.publicTaskId)) return { kind: 'invalid_request', reason: 'invalid_public_task_id' };
  const held = (reason: string): PublicTaskResponse => ({ kind: 'held', reason });
  const config = (deps.loadConfig ?? loadRouterGridConfig)();
  if (config.free_mode.enabled !== true) return held('disabled');
  const operator = loadFreeExtractionOperatorConfig(config, deps.operatorPath);
  if (operator.kind !== 'ok') return held(operator.kind === 'invalid' ? 'operator_config_invalid' : 'not_configured');
  const task = operator.value.publicTasks.find(t => t.id === body.publicTaskId);
  if (!task) return held('unknown_public_task');
  if (!(await (deps.optIns ?? new FreeOptInRepository()).get(ownerUserId))) return held('privacy');
  if (!(await (deps.freeMode ?? freeModeNow)(config)).active) return held('paid_capacity_available');
  const apiKey = (deps.apiKey ?? (p => new OpencodeAuthStore().apiKey(p)))(operator.value.endpoint.authProvider);
  if (!apiKey) return held('no_credential');
  const common = { config, store: freeStore(config), verifiedFreeModels: new Set(operator.value.qualifiedFreeModels),
    baseUrl: operator.value.endpoint.baseUrl, apiKey, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) };
  return task.kind === 'coding' ? executePublicCoding(task, common)
    : executePublicImageDesign(task, operator.value.publicImages.find(a => a.id === task.imageId)!, common);
}
