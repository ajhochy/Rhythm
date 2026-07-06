/**
 * Usage Budget service — real, time-accurate per-provider usage for the
 * "Usage Budget" side-panel tracker. Mirrors how Claude Code (`/usage`) and
 * Codex surface limits: rolling rate-limit windows for Anthropic, quota buckets
 * for Gemini, account credits for OpenRouter.
 *
 * Data sources (all REAL — verified live 2026-06-25):
 *   • Gemini     — POST cloudcode-pa…:retrieveUserQuota → per-model
 *                  remainingFraction + resetTime (Google OAuth access token).
 *   • OpenRouter — GET /api/v1/key → usage / limit / limit_remaining (API key).
 *   • Anthropic  — minimal /v1/messages probe → `anthropic-ratelimit-unified-*`
 *                  headers (5h + 7d utilization + reset). OAuth access token via
 *                  CredentialsBridgeService (kept fresh from Claude Code).
 *   • OpenAI     — NOT available: the ChatGPT-plan OAuth token is rejected by
 *                  the standard API (401) and Codex's usage backend is
 *                  undocumented. Reported as `unavailable` (never faked).
 *
 * Tokens are read fresh per refresh from opencode's auth.json (google,
 * openrouter) / Claude Code creds (anthropic). Results are cached for
 * CACHE_TTL_MS so the client poll + multiple clients don't hammer provider
 * APIs (and so the Anthropic probe — which consumes one request against the
 * window — runs at most ~once/min).
 */
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger';
import { GEMINI_CODE_ASSIST_PROJECT_ID } from '../config/env';
import { CredentialsBridgeService } from './credentials_bridge_service';
import { anthropicAccountsService } from './anthropic_accounts_service';

export type UsageBudgetKind = 'quota' | 'credits' | 'window' | 'unavailable';

export interface UsageBudgetItem {
  /** Display label — a model id, an account, or a window name ('5h', '7d'). */
  label: string;
  /** Fraction REMAINING, 0..1. Null when the provider exposes no ceiling. */
  remainingFraction: number | null;
  /** ISO-8601 reset time for this bucket/window, when known. */
  resetAt?: string | null;
  /** Secondary detail, e.g. "$0.04 / $10" or the window status. */
  detail?: string | null;
}

export interface UsageBudgetProvider {
  provider: 'gemini' | 'openrouter' | 'anthropic' | 'openai';
  label: string;
  kind: UsageBudgetKind;
  items: UsageBudgetItem[];
  /** Populated when kind === 'unavailable'. */
  reason?: string;
  /**
   * #907 — present only for 'anthropic' entries. A user can connect multiple
   * Anthropic accounts (dual-accounts, #898); each gets its OWN provider
   * entry here (not merged into one) so the UI can show every connected
   * account's usage gauges simultaneously, not just the active/default one.
   */
  accountId?: string;
}

export interface UsageBudgetSnapshot {
  providers: UsageBudgetProvider[];
  fetchedAt: string;
}

const AUTH_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
const ANTHROPIC_PROBE_MODEL = 'claude-haiku-4-5-20251001';
const CACHE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 12_000;

const credsBridge = new CredentialsBridgeService();

let _cache: { snapshot: UsageBudgetSnapshot; at: number } | null = null;
let _inflight: Promise<UsageBudgetSnapshot> | null = null;

function readAuthJson(): Record<string, unknown> {
  try {
    if (!existsSync(AUTH_PATH)) return {};
    return JSON.parse(readFileSync(AUTH_PATH, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function epochToIso(value: unknown): string | null {
  const n = typeof value === 'string' ? parseInt(value, 10) : (value as number);
  if (!Number.isFinite(n)) return null;
  // Unified headers are seconds; tolerate ms.
  const ms = n > 1e12 ? n : n * 1000;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

async function fetchGemini(auth: Record<string, unknown>): Promise<UsageBudgetProvider> {
  const base: UsageBudgetProvider = { provider: 'gemini', label: 'Gemini', kind: 'quota', items: [] };
  const google = auth.google as { access?: string } | undefined;
  const token = google?.access;
  const project = GEMINI_CODE_ASSIST_PROJECT_ID;
  if (!token || !project) {
    return { ...base, kind: 'unavailable', reason: 'No Google Code Assist credentials' };
  }
  try {
    const res = await fetch(
      'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      return { ...base, kind: 'unavailable', reason: `quota fetch ${res.status}` };
    }
    const data = (await res.json()) as { buckets?: Array<Record<string, unknown>> };
    const items: UsageBudgetItem[] = (data.buckets ?? [])
      // REQUESTS buckets are the per-model rate buckets shown by /gquota.
      .filter((b) => (b.tokenType ?? 'REQUESTS') === 'REQUESTS')
      .map((b) => ({
        label: String(b.modelId ?? 'model'),
        remainingFraction:
          typeof b.remainingFraction === 'number' ? b.remainingFraction : null,
        resetAt: typeof b.resetTime === 'string' ? b.resetTime : null,
      }));
    return { ...base, items };
  } catch (err) {
    return { ...base, kind: 'unavailable', reason: `error: ${String(err)}` };
  }
}

async function fetchOpenRouter(auth: Record<string, unknown>): Promise<UsageBudgetProvider> {
  const base: UsageBudgetProvider = {
    provider: 'openrouter',
    label: 'OpenRouter',
    kind: 'credits',
    items: [],
  };
  const or = auth.openrouter as { key?: string } | undefined;
  const key = or?.key;
  if (!key) return { ...base, kind: 'unavailable', reason: 'No OpenRouter API key' };
  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { ...base, kind: 'unavailable', reason: `key fetch ${res.status}` };
    const body = (await res.json()) as {
      data?: { usage?: number; limit?: number | null; limit_remaining?: number | null };
    };
    const d = body.data ?? {};
    const limit = typeof d.limit === 'number' ? d.limit : null;
    const remaining = typeof d.limit_remaining === 'number' ? d.limit_remaining : null;
    let item: UsageBudgetItem;
    if (limit != null && limit > 0 && remaining != null) {
      item = {
        label: 'credits',
        remainingFraction: Math.max(0, Math.min(1, remaining / limit)),
        detail: `$${(limit - remaining).toFixed(2)} / $${limit.toFixed(2)}`,
      };
    } else {
      // No ceiling on the key (pay-as-you-go) — show lifetime usage, no fraction.
      item = {
        label: 'usage',
        remainingFraction: null,
        detail: `$${(d.usage ?? 0).toFixed(2)} used`,
      };
    }
    return { ...base, items: [item] };
  } catch (err) {
    return { ...base, kind: 'unavailable', reason: `error: ${String(err)}` };
  }
}

/** Probe ONE Anthropic account's rate-limit headers. Never throws. */
async function probeAnthropicAccount(
  token: string,
  base: UsageBudgetProvider,
): Promise<UsageBudgetProvider> {
  try {
    // Minimal 1-token probe — the only way to read the unified rate-limit
    // headers (same source Claude Code `/usage` uses). Negligible quota cost.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const h = res.headers;
    const fiveUtil = h.get('anthropic-ratelimit-unified-5h-utilization');
    const weekUtil = h.get('anthropic-ratelimit-unified-7d-utilization');
    if (fiveUtil == null && weekUtil == null) {
      return { ...base, kind: 'unavailable', reason: `no rate-limit headers (${res.status})` };
    }
    const items: UsageBudgetItem[] = [];
    if (fiveUtil != null) {
      items.push({
        label: '5h limit',
        remainingFraction: Math.max(0, 1 - parseFloat(fiveUtil)),
        resetAt: epochToIso(h.get('anthropic-ratelimit-unified-5h-reset')),
        detail: h.get('anthropic-ratelimit-unified-5h-status') ?? undefined,
      });
    }
    if (weekUtil != null) {
      items.push({
        label: 'weekly',
        remainingFraction: Math.max(0, 1 - parseFloat(weekUtil)),
        resetAt: epochToIso(h.get('anthropic-ratelimit-unified-7d-reset')),
        detail: h.get('anthropic-ratelimit-unified-7d-status') ?? undefined,
      });
    }
    return { ...base, items };
  } catch (err) {
    return { ...base, kind: 'unavailable', reason: `error: ${String(err)}` };
  }
}

/**
 * #907 — one UsageBudgetProvider entry PER connected Anthropic account,
 * probed concurrently, so the UI can show every account's gauges at once
 * instead of only the active/default one. Falls back to the legacy
 * single-credential path (Claude Code creds / auth.json) when the accounts
 * store has nothing yet — e.g. a fresh install before the store's own
 * migrateFromClaudeCode() has run.
 */
async function fetchAnthropic(auth: Record<string, unknown>): Promise<UsageBudgetProvider[]> {
  const { accounts } = anthropicAccountsService.listRedacted();

  if (accounts.length > 0) {
    return Promise.all(
      accounts.map((account) => {
        const base: UsageBudgetProvider = {
          provider: 'anthropic',
          label: `Anthropic — ${account.label}`,
          kind: 'window',
          items: [],
          accountId: account.id,
        };
        const full = anthropicAccountsService.getAccount(account.id);
        if (!full?.access) {
          return { ...base, kind: 'unavailable' as const, reason: 'Account needs re-login' };
        }
        return probeAnthropicAccount(full.access, base);
      }),
    );
  }

  const base: UsageBudgetProvider = {
    provider: 'anthropic',
    label: 'Anthropic',
    kind: 'window',
    items: [],
  };
  const token =
    credsBridge.readClaudeCreds()?.access ??
    (auth.anthropic as { access?: string } | undefined)?.access;
  if (!token) return [{ ...base, kind: 'unavailable', reason: 'No Anthropic credentials' }];
  return [await probeAnthropicAccount(token, base)];
}

function openAiUnavailable(): UsageBudgetProvider {
  return {
    provider: 'openai',
    label: 'OpenAI',
    kind: 'unavailable',
    items: [],
    reason:
      'No usage API for the ChatGPT-plan token (standard API returns 401; Codex usage backend is undocumented).',
  };
}

async function buildSnapshot(): Promise<UsageBudgetSnapshot> {
  const auth = readAuthJson();
  const [gemini, openrouter, anthropicAccounts] = await Promise.all([
    fetchGemini(auth),
    fetchOpenRouter(auth),
    fetchAnthropic(auth),
  ]);
  return {
    providers: [...anthropicAccounts, openrouter, gemini, openAiUnavailable()],
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Return a usage-budget snapshot, served from a short-lived cache. Pass
 * `force` to bypass the cache (manual refresh).
 */
export async function getUsageBudget(opts?: { force?: boolean }): Promise<UsageBudgetSnapshot> {
  const now = Date.now();
  if (!opts?.force && _cache && now - _cache.at < CACHE_TTL_MS) {
    return _cache.snapshot;
  }
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const snapshot = await buildSnapshot();
      _cache = { snapshot, at: Date.now() };
      return snapshot;
    } catch (err) {
      logger.warn(`[UsageBudget] snapshot failed: ${String(err)}`);
      if (_cache) return _cache.snapshot;
      throw err;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}
