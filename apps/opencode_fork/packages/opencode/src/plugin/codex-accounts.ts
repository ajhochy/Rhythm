// rhythm: multi-account OpenAI (ChatGPT/Codex OAuth) routing for the codex plugin.
//
// READ-ONLY view of openai-accounts.json, which api_server owns (single
// writer). Mirrors the vendored rhythm-anthropic-accounts plugin
// (apps/api_server/opencode_plugins/rhythm-anthropic-accounts/dist/accounts.js):
//   - account per request: in-memory spillover override → file `routing`
//     (sdkSessionId → accountId; api_server writes it from the session's
//     openaiAccountId, which already folds in the profile default) → file
//     `defaultAccountId`;
//   - refresh ownership: api_server refreshes EVERY account in the file (its
//     15-min loop). This module never refreshes — OpenAI refresh tokens are
//     single-use, so exactly one refresher per token. A 401 re-reads the file.
//   - on a rate limit the plugin retries on another `ok` account and reports it
//     to POST /opencode/spillover (providerID 'openai'); api_server persists the
//     new routing.
// When the file is absent/empty the codex plugin keeps its legacy auth.json path.
import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface CodexAccount {
  id: string
  access: string
  expires?: number
  status?: string
  chatgptAccountId?: string
}

interface CodexAccountsFile {
  accounts?: CodexAccount[]
  defaultAccountId?: string | null
  routing?: Record<string, string>
}

// Env read lazily so tests can point at temp files.
function accountsFilePath() {
  return (
    process.env.RHYTHM_OPENAI_ACCOUNTS_FILE ??
    join(homedir(), "Library", "Application Support", "Rhythm", "openai-accounts.json")
  )
}

function apiBase() {
  return process.env.RHYTHM_API_BASE ?? "http://localhost:4001"
}

let cache: { path: string | null; mtimeMs: number; data: CodexAccountsFile } = { path: null, mtimeMs: -1, data: {} }
// sessionId → { accountId, storeMtimeMs }. A newer file write beats a stale override.
const overrides = new Map<string, { accountId: string; storeMtimeMs: number }>()

export function readCodexStore(): CodexAccountsFile {
  const path = accountsFilePath()
  try {
    const mtimeMs = statSync(path).mtimeMs
    if (path !== cache.path || mtimeMs !== cache.mtimeMs) {
      cache = { path, mtimeMs, data: JSON.parse(readFileSync(path, "utf8")) }
    }
  } catch {
    cache = { path, mtimeMs: -1, data: {} }
  }
  return cache.data
}

export function hasCodexAccounts() {
  const accounts = readCodexStore().accounts
  return Array.isArray(accounts) && accounts.length > 0
}

export function resolveCodexAccount(sessionId: string | undefined): {
  account?: CodexAccount
  fallbacks: CodexAccount[]
} {
  const store = readCodexStore()
  let override = sessionId ? overrides.get(sessionId) : undefined
  if (override && cache.mtimeMs > override.storeMtimeMs) {
    overrides.delete(sessionId!)
    override = undefined
  }
  const usable = (store.accounts ?? []).filter((a) => a.status === "ok" && a.access)
  if (usable.length === 0) return { account: undefined, fallbacks: [] }
  const wanted = override?.accountId || (sessionId && store.routing?.[sessionId]) || store.defaultAccountId
  const account = usable.find((a) => a.id === wanted) ?? usable[0]
  return { account, fallbacks: usable.filter((a) => a.id !== account.id) }
}

/** Record failover in memory and notify api_server (fire-and-forget; it persists routing). */
export function markCodexSpillover(sessionId: string | undefined, fromAccountId: string, toAccountId: string) {
  if (sessionId) {
    readCodexStore()
    overrides.set(sessionId, { accountId: toAccountId, storeMtimeMs: cache.mtimeMs })
  }
  fetch(`${apiBase()}/opencode/spillover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sdkSessionId: sessionId ?? null,
      providerID: "openai",
      fromAccountId,
      toAccountId,
      reason: "rate_limited",
    }),
  }).catch(() => {})
}

/** Test hook. */
export function resetCodexAccountsCache() {
  cache = { path: null, mtimeMs: -1, data: {} }
  overrides.clear()
}
