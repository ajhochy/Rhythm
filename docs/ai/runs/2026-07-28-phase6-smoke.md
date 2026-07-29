---
date: 2026-07-28
repo: Rhythm
branch: mega/post-1241-20260728
tags: [run, rhythm, smoke]
status: complete
---

# Phase 6 release smoke — fresh-context black-box run

Sandbox: `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-smoke-sandbox`, API `:4688`, engine `:4687`, mobile gateway `:4689`. Throwaway `HUMAN_APPROVAL_CAPABILITY_SHA256` + P-256 `HUMAN_APPROVAL_PUBLIC_KEY` generated per docs.

## 1. Setup experience (docs-only)

- `docs/ai/testing-guide.md` + `tools/dev/sandbox.sh` header were sufficient to boot: export the env vars, `tools/dev/sandbox.sh up`. First boot (fork bun build + api build + engine spawn) completed and printed `Sandbox ready: http://127.0.0.1:4688 (engine :4687)`.
- Doc gap (minor): neither the testing guide nor the sandbox.sh header mentions `RHYTHM_MOBILE_GATEWAY_PORT` or that `HUMAN_APPROVAL_*` must be exported *before* `up` for the gateway/pairing surface; both are only discoverable from `src/config/env.ts` / live-test files. The vars do pass through `sandbox.sh` env inheritance, so it works, but a fresh tester has to read source to learn the P-256 generation recipe lives only in prose ("throwaway P-256 public key", no command).
- Human-approval key format is strict (65-byte uncompressed point, canonical base64) and the server validated it — `openssl ec -pubout -outform DER | tail -c 65 | base64` worked first try.

## 2. Primary journeys (http://127.0.0.1:4688)

### Health
- `GET /health` → `{"status":"ok","service":"rhythm-api-server","commit":"dev"}`
- `GET /opencode/health` → `{"status":"ready","message":"Opencode SDK ready",...}`
- `GET /mobile-gateway/health` → `{"status":"ready", features:[pairing, device-revocation, project-scope, opencode-http-proxy, opencode-sse-proxy, opencode-pty-proxy], opencodeVersion 1.14.49}`; gateway listener confirmed on `:4689`.

### Agent sessions (auth-bypassed local surface)
- `GET /agent-sessions` → 200, real session list from the copied DB.

### Memory provenance + lifecycle (PASS)
- `POST /agent-memory` `{kind:"fact", content:..., sources:[{type:"session",id:"smoke-session-1"}]}` → 201 `{id:<ULID>, path:"memory/fact/...md", kind:"fact"}`.
- `GET /agent-memory/:dbRowId` → provenance fields present: `generatedBy:"agent:rhythm/1"`, `generatedAt`, `trustTier:"unverified"`, `sourcesJson` (round-tripped), `lifecycleState:"active"`, `auditHistory:[]`.
- Observation (minor): `POST /` returns the frontmatter ULID, but `GET /:id` only resolves the DB row id (ULID → 404); callers must re-list to find the row id. `PATCH`/`DELETE` docs claim dual resolution; `GET` does not.
- `POST /:id/agent-lifecycle {action:"verify", staleAfter:"2026-12-31"}` → verified entry stamped with fixed machine actor `agent:rhythm-mcp/1`, `priorState` captured, `staleAfter` applied.
- `POST /:id/agent-lifecycle {action:"deprecate"}` → `lifecycleState:"deprecated"`, auditCount 2.
- DB assertion: `agent_memory_changes` holds both rows (`verified`, `deprecated`, actor `agent:rhythm-mcp/1`).
- Human lane fails closed: `POST /:id/verify` with no token → 401 even in AGENT_LOCAL mode (by design).

### Transcript sharing (PASS — fails closed everywhere)
- Seeded throwaway session tokens directly into the sandbox DB copy (`sessions` table) for users 1/2/3; set `owner_user_id=1` on an existing agent session.
- `POST /agent-sessions/:id/shares` (owner token, `review.items[{id,category:"message",content}]`, recipient user 2) → 201 share.
- Recipient GET `/shares/:id` → 200. Wrong-user GET → 404 (not 403 — no existence leak). No-auth GET → 401. Guessed share id → 404.
- Owner `DELETE /shares/:id` → 204; recipient GET post-revoke → 404.
- Invalid review category → 400 with clear message.

### Mobile gateway pairing + session catalog sync (PASS)
- `POST /mobile-gateway/pairing-codes` (Bearer + `X-Rhythm-Human-Approval: <raw capability>`) → 201 pairing code.
- `POST /mobile-gateway/pair` (code + hostId + deviceName) → 201 device with deviceToken, userId 1, contractFingerprint.
- `GET /mobile-gateway/projects` (Device token) → project list from DB.
- `GET /mobile-gateway/opencode/session` scoped `X-Rhythm-Project-ID: <Rhythm>` → initially `[]` (fresh engine — correct, ownership-filtered).
- Created a desktop session `POST /agent-sessions` (owner bearer, projectId Rhythm) → 201 with `sdkSessionId`; gateway session list then showed exactly that session (`ses_053bf0e8cffe... | Smoke desktop session`), and DB row carried `owner_user_id=1`, `project_id` set. Session catalog sync works.

### Skill retrieval sanity (BM25 swap) (PASS)
- `GET /agent-skills` → 200, 85 skills.
- `GET /agent-memory/search?q=sanctuary+projector` (FTS/BM25 path) → 200, returned the just-created memory as top hit.

## 3. Suites

| Suite | Command | Result |
|---|---|---|
| Mobile static | `apps/mobile: npm run test:ci:static` | exit 0 (final node suite 7/7 pass incl. issue-1175 external-share denial) |
| Mobile e2e | `apps/mobile: npx playwright test` | **69 passed (2.3m)**, 0 failed — matches expected ~69 |
| Desktop | `apps/desktop_flutter: flutter test` | **1015 tests, all passed** (expected ~1014) |
| api_server | `apps/api_server: npx vitest run` | **438 files passed / 70 skipped; 3664 tests passed / 109 skipped, 0 failed** (49.1s, exit 0). No `sandbox_foreground` flake — no retry needed. |

## 4. Adversarial

| Probe | Result |
|---|---|
| Malformed JSON → `POST /agent-memory` | **500 INTERNAL_ERROR** (expected 4xx) — FINDING |
| Malformed JSON → `POST /agent-sessions` | **500 INTERNAL_ERROR** (expected 4xx) — FINDING |
| Malformed JSON → `POST /mobile-gateway/pair` | 400 "Malformed JSON request body" (gateway has its own handler) |
| No-auth `GET /shares` | 401, no data |
| No-auth `POST /agent-memory/:id/verify` | 401 (human lane enforced in AGENT_LOCAL) |
| Pairing-codes without approval header | 403 "Desktop human capability is required" |
| Pairing-codes with wrong capability | 403 |
| Guessed share id (owner token) | 404 |
| No-auth `GET /mobile-gateway/devices` | 401 |
| Device token + non-existent project id | 404 "Mobile project not found" |

Malformed-JSON finding detail: body-parser `SyntaxError` reaches the generic error handler and is mapped to 500 with a correlationId; no stack/data leaks to the client, server stays healthy. Mobile gateway routes already map it to 400 — the general `app.ts` error path does not. Low severity (cosmetic status code, no info disclosure), but it is a contract violation vs "4xx for client errors".

Port isolation: `:4001` (live Rhythm.app node, started 14:22 before this run) and `:4096` (live app's opencode) untouched — listeners belong to `/Applications/Rhythm.app`; `:4098` free throughout. Sandbox processes only ever bound 4687/4688/4689.

Mid-run restart: `down` → `up` with identical env — clean teardown (`Sandbox removed`), full rebuild, `Sandbox ready`, `/health` ok and `/mobile-gateway/health` ready after restart. `down` correctly removed the recorded engine PID and freed 4687/4688/4689.

## 5. Visual sweep

Playwright regenerated `.proof/*/ui/*.png` during this run (git shows them modified). Reviewed 4:

- `.proof/i1235/ui/agents-tab.png` — clean tabs, empty state, bottom nav; no clipping.
- `.proof/i1237/ui/offline.png` — Tailscale-unreachable banner renders correctly above chat list; layout intact.
- `.proof/i1238/ui/multiline-grown.png` — composer grows for an 18-line draft without overlapping the mode/model pills; send button aligned.
- `.proof/i1238/ui/default.png` — layout fine; a faint semi-transparent "New chat" dialog ghost is visible behind the empty-state card (dialog captured mid-dismiss animation). Cosmetic capture-timing artifact, consistent across the i1238 set; not a broken layout.

## Teardown

`tools/dev/sandbox.sh down` (same env) → `Sandbox removed`, exit 0. Post-teardown: zero listeners on 4687/4688/4689, sandbox dir gone. Live app's `:4001`/`:4096` listeners still the pre-existing Rhythm.app PIDs (97053/97070, started before this run); `:4098` never used.

## Verdict

**RELEASE READY** (no blockers).

Non-blocking findings, worst first:

1. **Malformed JSON → 500 on general API routes.** `POST /agent-memory` and `POST /agent-sessions` with syntactically invalid JSON return `500 INTERNAL_ERROR` (body-parser `SyntaxError` falls into the generic handler) instead of 400. The mobile gateway already maps this to `400 "Malformed JSON request body"`; the main `app.ts` error path does not. No data/stack leak (opaque correlationId only) and the server stays healthy, so cosmetic-contract, not a blocker. Suggested fix: map `SyntaxError`-with-`status:400` from express.json to `AppError.badRequest` in the global error handler.
2. **Memory create/GET id mismatch.** `POST /agent-memory` returns the frontmatter ULID, but `GET /agent-memory/:id` resolves only the DB row id (ULID → 404); callers must list/search to find the row id. `PATCH`/`DELETE` document dual resolution — `GET` should match.
3. **Docs gap for this exact setup.** `RHYTHM_MOBILE_GATEWAY_PORT` and the requirement to export `HUMAN_APPROVAL_*` before `up` are absent from `docs/ai/testing-guide.md` and the sandbox.sh header; the P-256 generation recipe exists only as prose. Everything worked once inferred from `src/config/env.ts`, but a fresh operator has to read source.
4. **Cosmetic screenshot ghost** in `.proof/i1238/ui/*` — dismissed dialog captured mid-fade behind the empty-state card. Capture-timing artifact, not a layout defect.

Evidence trail: journeys run against `http://127.0.0.1:4688` with state assertions via `sqlite3 /private/tmp/rhythm-smoke-sandbox/rhythm.db`; suites run from `/Users/ajhochhalter/Documents/rhythm-mega`. Nothing committed or pushed.
