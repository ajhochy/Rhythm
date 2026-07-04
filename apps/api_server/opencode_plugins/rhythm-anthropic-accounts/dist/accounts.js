// Rhythm multi-account resolution. READ-ONLY view of the accounts store that
// api_server owns (single-writer rule: never write the file from this module).
// Plain ESM JS — runs under Bun inside the opencode engine.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EMPTY = { version: 1, accounts: [], defaultAccountId: null, routing: {} };

// Env is read lazily (per call) so tests can point at tmp files/servers
// without import-order gymnastics.
function accountsFilePath() {
    return (process.env.RHYTHM_ACCOUNTS_FILE ??
        join(homedir(), "Library", "Application Support", "Rhythm", "anthropic-accounts.json"));
}
function apiBase() {
    return process.env.RHYTHM_API_BASE ?? "http://localhost:4001";
}

let cache = { path: null, mtimeMs: -1, data: EMPTY };
// Session-scoped overrides recorded on failover; consulted before file routing.
const overrides = new Map();

export function readStore() {
    const path = accountsFilePath();
    try {
        const mtimeMs = statSync(path).mtimeMs;
        if (path !== cache.path || mtimeMs !== cache.mtimeMs) {
            cache = { path, mtimeMs, data: JSON.parse(readFileSync(path, "utf8")) };
        }
    }
    catch {
        // Missing/corrupt file → empty store (caller falls back to legacy keychain path).
        cache = { path, mtimeMs: -1, data: EMPTY };
    }
    return cache.data;
}

export function hasAccounts() {
    const store = readStore();
    return Array.isArray(store.accounts) && store.accounts.length > 0;
}

/** Resolve {account, fallback} for a request. sessionId may be undefined (non-session calls). */
export function resolveForSession(sessionId) {
    const store = readStore();
    const usable = (store.accounts ?? []).filter((a) => a.status === "ok" && a.access);
    if (usable.length === 0)
        return { account: undefined, fallback: undefined };
    const wantedId = (sessionId && overrides.get(sessionId)) ||
        (sessionId && store.routing?.[sessionId]) ||
        store.defaultAccountId;
    const account = usable.find((a) => a.id === wantedId) ?? usable[0];
    const fallback = usable.find((a) => a.id !== account.id);
    return { account, fallback };
}

/** Record failover and notify api_server (fire-and-forget; api_server persists routing). */
export function markSpillover(sessionId, fromAccountId, toAccountId) {
    if (sessionId)
        overrides.set(sessionId, toAccountId);
    fetch(`${apiBase()}/opencode/spillover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sdkSessionId: sessionId ?? null,
            fromAccountId,
            toAccountId,
            reason: "rate_limited",
        }),
    }).catch(() => { });
}

/** Test/debug knob: force this account id to be treated as rate-limited. */
export function forcedSpilloverAccountId() {
    return process.env.RHYTHM_FORCE_SPILLOVER || undefined;
}
