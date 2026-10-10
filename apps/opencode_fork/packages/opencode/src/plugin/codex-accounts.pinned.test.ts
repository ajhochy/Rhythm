import { beforeEach, expect, mock, test } from "bun:test"
import * as fs from "node:fs"

const accounts = [{ id: "A", access: "synthetic-a", status: "ok" }, { id: "B", access: "synthetic-b", status: "ok" }]
let store: Record<string, unknown>
mock.module("node:fs", () => ({ ...fs, statSync: () => ({ mtimeMs: 1 }), readFileSync: () => JSON.stringify(store) }))
const { resolveCodexAccount, resetCodexAccountsCache, markCodexSpillover } = await import("./codex-accounts")
globalThis.fetch = mock(async () => new Response(null, { status: 202 })) as typeof fetch

beforeEach(() => {
  resetCodexAccountsCache()
  store = { accounts, routing: { session: "B" }, defaultAccountId: "A" }
})

test("c1: pinned B has no fallback to A on a native 429", () => {
  store.pinned = { session: true }
  expect(resolveCodexAccount("session")).toEqual({ account: accounts[1], fallbacks: [] })
})
test("c2: pinned routing beats a stale in-memory spillover override", () => {
  store.pinned = { session: true }
  // Install override after the pin, so even a same-mtime override cannot win.
  markCodexSpillover("session", "B", "A")
  expect(resolveCodexAccount("session").account?.id).toBe("B")
})
test("c14: an unusable pinned account cannot silently select another account", () => {
  store.pinned = { session: true }
  store.accounts = [accounts[0], { ...accounts[1], status: "needs_relogin" }]
  expect(resolveCodexAccount("session")).toEqual({ account: undefined, fallbacks: [] })
})
test("c3: unpinned routing and override keep automatic fallbacks", () => {
  expect(resolveCodexAccount("session")).toEqual({ account: accounts[1], fallbacks: [accounts[0]] })
  markCodexSpillover("session", "B", "A")
  expect(resolveCodexAccount("session")).toEqual({ account: accounts[0], fallbacks: [accounts[1]] })
})
test("c4: calls without a session keep default and fallback", () => {
  store.pinned = { session: true }
  expect(resolveCodexAccount(undefined)).toEqual({ account: accounts[0], fallbacks: [accounts[1]] })
})
