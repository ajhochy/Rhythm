import { adaptRouterFreeConfig } from './router_free_config';
import { selectFreeRoute, type FreeClassification, type PrivacyState } from './router_free_policy';
import type { RouterFreeStateStore } from './router_free_state';
import type { RouterGridConfig } from './router_grid_config';

/**
 * F3: one genuine Free verifier class (structured extraction) and a conservative public-context preflight.
 * The verifier recomputes every value from the declared source text; the model's own claims are never trusted.
 * No product entrypoint calls executeFreeExtraction; Free stays disabled by default (free_mode.enabled=false).
 */
export interface ExtractionField { name: string; type: 'string' | 'number'; required: boolean }
export interface ExtractionTask {
  kind: 'structured_extraction';
  taskId: string;
  /** The ONLY user content a Free request may carry. */
  sourceText: string;
  fields: readonly ExtractionField[];
  /**
   * Operator-declared trusted public source and the owner's Free opt-in. Never inferred from scanner silence.
   * INTEGRATION CONTRACT: any API entrypoint must derive both server-side (operator public-source registry and the
   * owner's stored opt-in); request-body booleans are never proof. No such entrypoint exists yet.
   */
  publicSource: { trusted: true; label: string } | null;
  ownerOptIn: boolean;
  attachments: readonly unknown[];
  /** What a normal turn would add; any true means user-bearing context exists. */
  context: { memory: boolean; dayflow: boolean; history: boolean; profilePrompt: boolean };
}
export interface VerificationResult { pass: boolean; checks: string[]; values: Record<string, string | number | null> }
export interface FreeOutputVerifier {
  readonly id: string;
  readonly taskKind: ExtractionTask['kind'];
  verify(task: ExtractionTask, outputText: string): VerificationResult;
}

// Reject-only filters: a hit proves user data is present; NO hit proves nothing about arbitrary text.
const SCANNERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ['phone', /(?:\+?\d[\s().-]{0,2}){9,}\d/],
  ['bearer_or_jwt', /\bBearer\s+\S{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./],
  ['api_key', /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/],
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['home_path', /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+/],
  ['ssn_like', /\b\d{3}-\d{2}-\d{4}\b/],
];

// Trusted schema: bounded snake_case names and two types only, so field names can never carry user text.
const FIELD_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_SOURCE_CHARS = 20_000, MAX_FIELDS = 20;
const CONTEXT_KEYS = ['memory', 'dayflow', 'history', 'profilePrompt'] as const;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Runtime shape check (fail-closed): malformed, unbounded, unknown or uninspected input is never public. */
function shapeProblems(t: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (t.kind !== 'structured_extraction') problems.push('unknown_task_kind');
  if (typeof t.taskId !== 'string' || !t.taskId.trim() || t.taskId.length > 200) problems.push('malformed_task_id');
  if (typeof t.sourceText !== 'string' || !t.sourceText.trim() || t.sourceText.length > MAX_SOURCE_CHARS) problems.push('malformed_source');
  const fields = t.fields;
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > MAX_FIELDS) problems.push('malformed_fields');
  else {
    const names = new Set<string>();
    for (const f of fields) {
      if (!isObject(f) || Object.keys(f).some(k => !['name', 'type', 'required'].includes(k)) || typeof f.name !== 'string'
        || !FIELD_NAME.test(f.name) || names.has(f.name) || !['string', 'number'].includes(f.type as string)
        || typeof f.required !== 'boolean') { problems.push('untrusted_field_schema'); break; }
      names.add(f.name);
    }
  }
  if (!Array.isArray(t.attachments)) problems.push('malformed_attachments');
  else if (t.attachments.length > 0) problems.push('uninspected_attachments');
  const ctx = t.context;
  if (!isObject(ctx)) problems.push('context_missing');
  else {
    for (const key of Object.keys(ctx)) if (!(CONTEXT_KEYS as readonly string[]).includes(key)) problems.push(`context_unknown:${key}`);
    for (const key of CONTEXT_KEYS) if (ctx[key] !== false) problems.push(key in ctx ? `context:${key}` : `context_missing:${key}`);
  }
  const source = t.publicSource;
  if (source !== null && !(isObject(source) && source.trusted === true && typeof source.label === 'string')) problems.push('malformed_public_source');
  else if (source === null) problems.push('no_trusted_public_source');
  if (t.ownerOptIn !== true) problems.push('no_owner_opt_in');
  return problems;
}

/**
 * Local, network-free. Scans EVERY outbound surface (source text, field names, and the exact messages that would be
 * sent). `false` only for a well-formed task with an operator-trusted public source + owner opt-in + no attachments
 * and provably empty context. Scanner silence alone never makes text public.
 */
export function publicContextPreflight(task: ExtractionTask): { privacy: PrivacyState; reasons: string[] } {
  const t: Record<string, unknown> = isObject(task) ? task : {};
  const problems = isObject(task) ? shapeProblems(t) : ['malformed_task'];
  const surfaces: string[] = [];
  if (typeof t.sourceText === 'string') surfaces.push(t.sourceText);
  if (Array.isArray(t.fields)) for (const f of t.fields) if (isObject(f)) surfaces.push(String(f.name ?? ''), String(f.type ?? ''));
  const wellFormed = !problems.some(p => p.startsWith('malformed') || p === 'untrusted_field_schema' || p === 'unknown_task_kind');
  if (wellFormed) for (const m of publicExtractionMessages(task)) surfaces.push(m.content);
  const hits = SCANNERS.filter(([, re]) => surfaces.some(s => re.test(s))).map(([name]) => `scanner:${name}`);
  if (hits.length) return { privacy: true, reasons: [...hits, ...problems] };
  return problems.length ? { privacy: 'unknown', reasons: problems } : { privacy: false, reasons: ['trusted_public_source_owner_opt_in'] };
}

const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
/** Schema + independently recomputed offsets/values against the declared source. */
export function verifyExtraction(task: ExtractionTask, outputText: string): VerificationResult {
  const checks: string[] = [], values: Record<string, string | number | null> = {};
  let parsed: unknown;
  try { parsed = JSON.parse(outputText.trim()); } catch { return { pass: false, checks: ['output_not_json'], values }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { pass: false, checks: ['output_not_object'], values };
  const out = parsed as Record<string, unknown>;
  const names = new Set(task.fields.map(f => f.name));
  for (const key of Object.keys(out)) if (!names.has(key)) checks.push(`unexpected_field:${key}`);
  let present = 0;
  for (const field of task.fields) {
    const entry = out[field.name];
    if (entry === undefined || entry === null) { if (field.required) checks.push(`missing:${field.name}`); values[field.name] = null; continue; }
    const { value, start, end } = entry as { value?: unknown; start?: unknown; end?: unknown };
    if (typeof entry !== 'object' || !integer(start) || !integer(end) || start < 0 || end <= start || end > task.sourceText.length) {
      checks.push(`bounds:${field.name}`); continue;
    }
    const slice = task.sourceText.slice(start, end);
    const ok = field.type === 'string'
      ? typeof value === 'string' && slice === value
      : typeof value === 'number' && Number.isFinite(value) && /^[\s$]*-?[\d,]+(?:\.\d+)?\s*$/.test(slice) && Number(slice.replace(/[\s$,]/g, '')) === value;
    if (!ok) { checks.push(`${field.type === 'string' ? 'value_mismatch' : 'number_mismatch'}:${field.name}`); continue; }
    values[field.name] = value as string | number; present++;
    checks.push(`verified:${field.name}@${start}-${end}`);
  }
  const failed = checks.some(c => !c.startsWith('verified:'));
  return { pass: !failed && present > 0, checks: present === 0 && !failed ? [...checks, 'nothing_extracted'] : checks, values };
}

export const extractionVerifier: FreeOutputVerifier = Object.freeze({ id: 'structured_extraction_v1', taskKind: 'structured_extraction', verify: verifyExtraction });
/** Code-owned registry: configuration can never add a verifier. */
export const FREE_VERIFIERS: readonly FreeOutputVerifier[] = Object.freeze([extractionVerifier]);
export function freeExecutionAllowed(classification: FreeClassification, taskKind: string, verifiers: readonly FreeOutputVerifier[] = FREE_VERIFIERS): boolean {
  return classification.containsPrivateData === false && verifiers.some(v => v.taskKind === taskKind);
}

export const FREE_EXTRACTION_SYSTEM = 'Extract the requested fields from the source text. Reply with JSON only: {"<field>": {"value": <value>, "start": <offset>, "end": <offset>}} where start/end are character offsets into the source text.';
/** Public-only request: fixed instruction + declared fields + declared source. No memory, Dayflow, history or profile prompt. */
export function publicExtractionMessages(task: ExtractionTask): Array<{ role: 'system' | 'user'; content: string }> {
  return [{ role: 'system', content: FREE_EXTRACTION_SYSTEM },
    { role: 'user', content: `Fields: ${task.fields.map(f => `${f.name} (${f.type}${f.required ? ', required' : ''})`).join('; ')}\nSource:\n${task.sourceText}` }];
}

export type FreeExtractionResult = { kind: 'held'; reason: string }
  | { kind: 'released'; model: string; effort: string | null; degraded: boolean; values: Record<string, string | number | null>; checks: string[] }
  | { kind: 'rejected'; model: string; checks: string[] };
export interface FreeExtractionDeps {
  config: RouterGridConfig; store: RouterFreeStateStore; verifiedFreeModels: ReadonlySet<string>;
  baseUrl: string; apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number;
  /** Server-owned classification for a registered task; clients never set it. */
  classification?: FreeClassification;
}
/** Output is released ONLY after the verifier passes; a rejected output is never returned. */
export async function executeFreeExtraction(task: ExtractionTask, deps: FreeExtractionDeps): Promise<FreeExtractionResult> {
  const held = (reason: string): FreeExtractionResult => ({ kind: 'held', reason });
  const f = deps.config.free_mode;
  if (f.enabled !== true) return held('disabled');
  // Before any route, reservation or request: every outbound surface must be proven public.
  if (publicContextPreflight(task).privacy !== false) return held('privacy');
  const verifier = FREE_VERIFIERS.find(v => v.taskKind === task.kind);
  if (!verifier) return held('verification_unavailable');
  const usage = deps.store.usage();
  const route = selectFreeRoute({ config: adaptRouterFreeConfig(deps.config).policy,
    classification: deps.classification ?? { tier: 3, category: 'knowledge', canQueue: false, containsPrivateData: false },
    // realUser=true keeps forbidden_real models out even for synthetic callers (conservative).
    privacyPreflight: false, realUser: true, hasImages: false, canVerify: true,
    availableVerifiedFreeModels: deps.verifiedFreeModels, openCircuitModels: deps.store.openCircuits(),
    dailyRemaining: usage.dailyRemaining, dailyCount: usage.dailyCount, rpmCount: Math.max(0, f.rpm_limit - Math.floor(usage.availableTokens)) });
  if (route.kind === 'queue') return held(route.reason);
  const admission = deps.store.tryReserve(route.requiredCalls);
  if (admission.kind !== 'lease') return held(admission.reason);
  try {
    if (!deps.store.commitAttempt(admission.lease.id)) return held('budget');
    let text: unknown;
    try {
      const response = await (deps.fetchImpl ?? fetch)(`${deps.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.apiKey}` },
        body: JSON.stringify({ model: route.model.replace(/^openrouter\//, ''), stream: false,
          ...(route.effort ? { reasoning: { effort: route.effort } } : {}), messages: publicExtractionMessages(task) }),
      });
      if (!response.ok) { deps.store.recordFailure(route.model, response.status === 429 ? '429' : response.status >= 500 ? '5xx' : 'error_body'); return held('provider_failure'); }
      text = ((await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content;
    } catch { deps.store.recordFailure(route.model, 'error_body'); return held('provider_failure'); }
    if (typeof text !== 'string' || !text.trim()) { deps.store.recordFailure(route.model, 'empty'); return held('provider_failure'); }
    const verdict = verifier.verify(task, text);
    if (!verdict.pass) return { kind: 'rejected', model: route.model, checks: verdict.checks };
    deps.store.reportSuccess(route.model);
    return { kind: 'released', model: route.model, effort: route.effort ?? null, degraded: route.degraded, values: verdict.values, checks: verdict.checks };
  } finally { deps.store.release(admission.lease.id); }
}
