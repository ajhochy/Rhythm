import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { CodexAuthPlugin } from "../../src/plugin/codex"
import { resetCodexAccountsCache } from "../../src/plugin/codex-accounts"

// Synthetic tokens only — never real credentials.
type Call = { url: string; auth: string | null; account: string | null; body?: string }

let dir: string
let file: string
let calls: Call[]
let statusFor: (auth: string) => number
let authSetCalls: unknown[]
const realFetch = globalThis.fetch
const envBefore = { file: process.env.RHYTHM_OPENAI_ACCOUNTS_FILE, api: process.env.RHYTHM_API_BASE }

function writeStore(data: object) {
  fs.writeFileSync(file, JSON.stringify(data))
  // Bump mtime so the mtime cache sees back-to-back writes.
  const t = new Date(Date.now() + calls.length * 1000 + Math.random() * 1000)
  fs.utimesSync(file, t, t)
}

const acct = (id: string, extra: object = {}) => ({
  id,
  label: id,
  access: `access-${id}`,
  refresh: `refresh-${id}`,
  expires: Date.now() + 3_600_000,
  status: "ok",
  chatgptAccountId: `ws-${id}`,
  ...extra,
})

async function loaderFetch(legacy = { access: "legacy-access", refresh: "legacy-refresh", expires: Date.now() + 3_600_000 }) {
  const hooks = await CodexAuthPlugin({
    client: { auth: { set: async (x: unknown) => void authSetCalls.push(x) } },
  } as any)
  const getAuth = async () => ({ type: "oauth" as const, ...legacy, accountId: "ws-legacy" })
  const loaded = (await hooks.auth!.loader!(getAuth as any, {} as any)) as { fetch: typeof fetch }
  return loaded.fetch
}

function request(f: typeof fetch, sessionId?: string) {
  return f("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: "Bearer dummy", ...(sessionId ? { "x-session-affinity": sessionId } : {}) },
    body: JSON.stringify({ model: "gpt-5.5" }),
  })
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-accounts-"))
  file = path.join(dir, "openai-accounts.json")
  process.env.RHYTHM_OPENAI_ACCOUNTS_FILE = file
  process.env.RHYTHM_API_BASE = "http://rhythm.test"
  resetCodexAccountsCache()
  calls = []
  authSetCalls = []
  statusFor = () => 200
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const h = new Headers(init?.headers)
    calls.push({ url, auth: h.get("authorization"), account: h.get("ChatGPT-Account-Id"), body: init?.body as string })
    if (url.startsWith("http://rhythm.test")) return new Response("{}")
    return new Response("{}", { status: statusFor(h.get("authorization") ?? "") })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  process.env.RHYTHM_OPENAI_ACCOUNTS_FILE = envBefore.file
  process.env.RHYTHM_API_BASE = envBefore.api
  if (envBefore.file === undefined) delete process.env.RHYTHM_OPENAI_ACCOUNTS_FILE
  if (envBefore.api === undefined) delete process.env.RHYTHM_API_BASE
  fs.rmSync(dir, { recursive: true, force: true })
})

const upstream = () => calls.filter((c) => !c.url.startsWith("http://rhythm.test"))
const spillovers = () => calls.filter((c) => c.url === "http://rhythm.test/opencode/spillover")

describe("plugin.codex rhythm accounts", () => {
  test("no accounts file → legacy auth.json credential, unchanged", async () => {
    const f = await loaderFetch()
    await request(f, "ses_1")
    expect(upstream()).toEqual([
      expect.objectContaining({
        url: "https://chatgpt.com/backend-api/codex/responses",
        auth: "Bearer legacy-access",
        account: "ws-legacy",
      }),
    ])
  })

  test("session routing → default, with the account's workspace header", async () => {
    writeStore({ version: 1, accounts: [acct("a"), acct("b")], defaultAccountId: "a", routing: { ses_b: "b" } })
    const f = await loaderFetch()
    await request(f, "ses_b")
    await request(f, "ses_other")
    await request(f)
    expect(upstream().map((c) => [c.auth, c.account])).toEqual([
      ["Bearer access-b", "ws-b"],
      ["Bearer access-a", "ws-a"],
      ["Bearer access-a", "ws-a"],
    ])
  })

  test("store mode never refreshes, even with an expired legacy credential", async () => {
    writeStore({ version: 1, accounts: [acct("a")], defaultAccountId: "a", routing: {} })
    const f = await loaderFetch({ access: "", refresh: "legacy-refresh", expires: 0 })
    await request(f, "ses_1")
    expect(calls.some((c) => c.url.includes("oauth/token"))).toBe(false)
    expect(authSetCalls).toEqual([])
    expect(upstream()[0].auth).toBe("Bearer access-a")
  })

  test("skips needs_relogin accounts; errors when none are usable", async () => {
    writeStore({ version: 1, accounts: [acct("a", { status: "needs_relogin" }), acct("b")], defaultAccountId: "a", routing: {} })
    const f = await loaderFetch()
    await request(f, "ses_1")
    expect(upstream()[0].auth).toBe("Bearer access-b")
    writeStore({ version: 1, accounts: [acct("a", { status: "needs_relogin" })], defaultAccountId: "a", routing: {} })
    await expect(request(f, "ses_1")).rejects.toThrow(/no usable OpenAI account/)
  })

  test("429 → retries on the next ok account, reports spillover, sticks for the session", async () => {
    writeStore({
      version: 1,
      accounts: [acct("a"), acct("dead", { status: "needs_relogin" }), acct("b")],
      defaultAccountId: "a",
      routing: {},
    })
    statusFor = (auth) => (auth === "Bearer access-a" ? 429 : 200)
    const f = await loaderFetch()
    const res = await request(f, "ses_1")
    expect(res.status).toBe(200)
    expect(upstream().map((c) => c.auth)).toEqual(["Bearer access-a", "Bearer access-b"])
    expect(upstream()[1].body).toBe(JSON.stringify({ model: "gpt-5.5" }))
    expect(spillovers().map((c) => JSON.parse(c.body!))).toEqual([
      { sdkSessionId: "ses_1", providerID: "openai", fromAccountId: "a", toAccountId: "b", reason: "rate_limited" },
    ])
    // In-memory override holds until api_server rewrites the file.
    await request(f, "ses_1")
    expect(upstream().at(-1)!.auth).toBe("Bearer access-b")
  })

  test("429 on every account → original 429 returned, no spillover report", async () => {
    writeStore({ version: 1, accounts: [acct("a"), acct("b")], defaultAccountId: "a", routing: {} })
    statusFor = () => 429
    const f = await loaderFetch()
    const res = await request(f, "ses_1")
    expect(res.status).toBe(429)
    expect(upstream().length).toBe(2)
    expect(spillovers()).toEqual([])
  })

  test("401 → re-reads the store and retries once with a newer token", async () => {
    writeStore({ version: 1, accounts: [acct("a")], defaultAccountId: "a", routing: {} })
    const f = await loaderFetch()
    statusFor = (auth) => {
      if (auth !== "Bearer access-a") return 200
      // Simulate api_server's refresh landing mid-request.
      writeStore({ version: 1, accounts: [acct("a", { access: "access-a2" })], defaultAccountId: "a", routing: {} })
      return 401
    }
    const res = await request(f, "ses_1")
    expect(res.status).toBe(200)
    expect(upstream().map((c) => c.auth)).toEqual(["Bearer access-a", "Bearer access-a2"])
  })
})
