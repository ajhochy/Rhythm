# React Desktop Gateway v1 — Slice 2 Acceptance Contract

**Date:** 2026-08-14
**Contract commands:** `cd apps/api_server && npx vitest run src/contract/local_agent_surface_hardening.test.ts`; `cd apps/web && npx playwright test tests/gateway/gateway.spec.ts tests/gateway/receipt.spec.ts --workers=1`
**Live command:** `cd apps/web && RHYTHM_LIVE_E2E=1 npx playwright test --config tests/gateway/live-playwright.config.ts`
**Checksum reconciliation:** `cd apps/web && shasum -a 256 -c SHA256SUMS`; `shasum -a 256 SHA256SUMS`; `test "$(wc -l < SHA256SUMS)" -eq 144`

| ID | Criterion | Mode | Evidence | Status |
|---|---|---|---|---|
| slice-2-c1 | Add the smallest typed renderer-facing gateway composition boundary with explicit fixture/live mode, API/engine health, and extensible unsupported domain contracts while existing pages retain FixtureProvider. | unit | `tests/gateway/gateway.spec.ts` | pass |
| slice-2-c2 | FixtureGateway performs no network and unsupported operations fail explicitly. | unit | `tests/gateway/gateway.spec.ts` | pass |
| slice-2-c3 | LiveGateway accepts only exact env-provided `http://127.0.0.1:4098` and `http://127.0.0.1:4097` bases and rejects every named unsafe variant before render. | unit | `tests/gateway/gateway.spec.ts` | pass |
| slice-2-c4 | Live errors never fall back to fixtures; API and engine health failures are distinct and requests have platform timeouts. | unit/live | `tests/gateway/gateway.spec.ts`, `tests/gateway/live.spec.ts` | pass |
| slice-2-c5 | Explicit runtime selection defaults to fixture only when live was not requested; invalid requested-live startup renders a fatal error. | unit/ui | `tests/gateway/gateway.spec.ts`, `tests/gateway/invalid-live.spec.ts` | pass |
| slice-2-c6 | The UI renders an accessible Fixture/Live environment receipt; Live separately reports real API :4098 and engine :4097 health. | ui/live | `tests/gateway/receipt.spec.ts`, `tests/gateway/live.spec.ts` | pass |
| slice-2-c7 | Tests prove fixture isolation, URL rejection, invalid live config, separate health, real sandbox health, and no live-to-fixture fallback; live is env-gated. | unit/live | all `tests/gateway/*spec.ts` | pass |
| slice-2-c8 | Scripts expose `typecheck`, `test:fixture`, and `test:live` without dependency or lockfile changes; the authoritative discovery is 249 tests in 36 files, comprising 239 imported baseline tests plus 10 Slice 2 gateway tests. | static | package script inspection and `npm run test:list` | pass |
| slice-2-c9 | Run requested typecheck/build/targeted/sandbox/live/smoke/git checks, restarting services only through `tools/dev/sandbox.sh`. | process | run note exact command receipts, including reconciled 144/144 import inventory | pass |
| slice-2-c10 | Capture one durable live receipt screenshot when the live UI test supports it and record dimensions/hash. | live | `tests/gateway/live.spec.ts` and run note | pass |
| slice-2-c11 | Run GitNexus change detection for the isolated worktree and record its result. | process | run note | pass |
| slice-2-c12 | Return a structured verification handoff with observed responses, evidence, and exact files. | process | workflow handoff | manual |
| slice-2-c13 | Parse `RHYTHM_LOCAL_RENDERER_ORIGINS` as a trimmed, deduplicated exact allowlist containing only `http://127.0.0.1:<1-65535>` and reserved `rhythm://app`. | unit | `apps/api_server/src/contract/local_agent_surface_hardening.test.ts` | pass |
| slice-2-c14 | Fail startup closed for wildcard, null, file, HTTPS/non-loopback/localhost, credentials, missing or invalid port, path, query, fragment, lookalike, and malformed renderer origins. | unit | `apps/api_server/src/contract/local_agent_surface_hardening.test.ts` | pass |
| slice-2-c15 | In agent-local mode, an exact configured renderer Origin reaches HTTP with exact ACAO despite cross-port fetch-site provenance; empty and similar origins remain concise 403/no ACAO and loopback Host remains mandatory. | integration | `apps/api_server/src/contract/local_agent_surface_hardening.test.ts` | pass |
| slice-2-c16 | The shared local guard admits exact configured renderer Origin on `/ws/agents` and PTY upgrades while preserving headerless Flutter/native HTTP and WebSocket behavior. | integration | `apps/api_server/src/contract/local_agent_surface_hardening.test.ts` | pass |
| slice-2-c17 | Hosted configured CORS and the explicit local guard kill-switch retain their prior behavior. | integration | `apps/api_server/src/contract/local_agent_surface_hardening.test.ts` | pass (existing regression coverage) |
| slice-2-c18 | Sandbox start/restart configure only exact renderer Origin `http://127.0.0.1:4175`; live browser receipt observes real API `:4098` and engine `:4097`, no fixture fallback, and captures reviewed screenshot evidence. | live | `apps/web/tests/gateway/live.spec.ts`, sandbox probes, run note | pass |
| slice-2-c19 | The renderer CSP preserves every existing directive except `connect-src`, which contains exactly `http://127.0.0.1:4098 http://127.0.0.1:4097 ws://127.0.0.1:4098` and therefore permits the typed live-session socket while excluding wildcard, localhost, `:4001`, `:4096`, and every other network destination. | unit/live | `tests/gateway/gateway.spec.ts`, `tests/gateway/live.spec.ts` | pass |

## Manual targets

- `slice-2-c9`: command log shows every requested check, sandbox lifecycle only through `tools/dev/sandbox.sh`, and the reconciled 144/144 import inventory.
- `slice-2-c11`: record `gitnexus_detect_changes(scope=all, worktree=...)` output even if new unindexed files resolve to no symbols.
- `slice-2-c12`: verification handoff must enumerate exact changed files and remaining risks.

Pre-repair backend acceptance run: **22 failed / 26 passed**. The parser was absent and configured renderer HTTP/WS remained rejected. Post-repair API contract: **48 passed**. CSP acceptance-first run: **1 failed / 6 passed**, with `connect-src` observed as exactly `['none']`; after replacing only that directive value, the focused fixture contract passed **8/8 + 1/1** and the real live browser gate passed **1/1** with API `:4098` and engine `:4097` responses both `200` and no fixture fallback. Checksum reconciliation records all four approved Slice 2 adapted imported paths (`index.html`, `package.json`, `src/App.tsx`, and `src/main.tsx`); full `SHA256SUMS` verification passes **144/144** with root digest `9015d2f78ab85a324548dc0472f1071014a1a87bfcdbf017495f19bbf6e412c7`. The prior `NEEDS_CONTEXT` is resolved without adding gateway files to the imported inventory.

The boundary is intentionally honest: Slice 2 composes and displays the gateway, while existing feature pages continue to consume `FixtureProvider` until their separately owned migration slices.
