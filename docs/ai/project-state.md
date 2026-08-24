# Rhythm — Project State

Two active, unrelated threads on this repo right now (no file overlap):

1. **Mobile smart-client rebuild** — PR #1383, awaiting manual smoke + merge.
2. **Numbat OpenCode observability (#1452)** — draft PR pending, awaiting AJ's manual smoke + merge decision.

---

## Thread 1 — Mobile smart-client rebuild

**Focus:** Mobile smart-client rebuild — **complete, PR open, awaiting manual smoke + merge.**
**Branch:** `mobile/smart-client-rebuild` → **PR #1383** (https://github.com/ajhochy/Rhythm/pull/1383). **Do NOT merge** — AJ merges after manual testing.

## What shipped
MEGA PR #1368 **merged** (all 59 issues; new surfaces off by default:
`RHYTHM_RESEARCH_PROJECTS_ENABLED=off`, `RHYTHM_MCP_APPS_MODE=off`).

#1368 lifted the **React Native** halves of the mobile workstream off its branch
(`f4c7c352`) while the server halves landed. PR #1383 restores that RN transport:
#1270 profile fallback · #1308/#1311 attachment-limit constant · #1364/#1366
session-lifecycle fencing · #1247 SSE permission replay. Five commits, one per issue.

#1363 (binding-repair CLI) was never reverted — server-side, already on main, verified intact.

## Test status (PR #1383)
- mobile: tsc clean, eslint 0 errors, **Jest 61/61**, **Playwright 71/71**, `test:ci:static` exit 0,
  contract green (**136 ops**) — matches mega-HEAD parity exactly.
- api_server: mobile gateway + proxy 17/17; `session_binding_cleanup` 3/3.
- **Contract anchors untouched → no fingerprint bump, no re-pair.**

## Two regressions found during the rebuild
1. `eas.json` lost `ascAppId` (revert reset it pre-#1175) — non-interactive TestFlight submit would
   prompt and fail. Restored + the iOS preflight now requires a non-empty `ascAppId` (it previously
   accepted an empty `ios: {}`).
2. `issue-1247.test.mjs` was orphaned (no npm script ever ran it). Wired into `test:ci:static`.

## NOT started — #1378 / #1379 smart-client plan
`docs/ai/plan-mobile-smart-client.md` is a **proposed** plan to make the phone a client of the
api_server mirror instead of a raw-engine proxy (Phases 0–4). It is unrelated to PR #1383's six
issues and is **unimplemented**. Its four open decisions still need a call before Phase 1/2 —
chiefly mirror authority vs. live backfill, and whether new mobile-native DTOs get a contract
version separate from the engine fingerprint.

## Flaky note (pre-existing, out of scope)
api_server vitest + mobile Playwright each surface ~1 parallel-execution flake per full run (shared
DB/port), always a *different* test, all passing in isolation. CI re-run clears transient reds.
(Both full mobile suites ran clean on #1383.)

## Next step (Thread 1)
AJ: manual-smoke PR #1383 on-device. The specific check is #1364's ready state — create a new chat
and confirm it reaches "Start a new task" rather than flashing missing-session. Then merge.
```bash
cd apps/mobile && npm run test:ci:static   # full automated gate, exit 0
```

---

## Thread 2 — Numbat OpenCode observability (#1452)

**Focus:** Wire observe-only Numbat OpenCode monitoring into api_server startup — **verification-gate PASSED, draft PR open, awaiting AJ's manual smoke + merge decision.**
**Branch:** `numbat-opencode-observability` → **PR #1453** (https://github.com/ajhochy/Rhythm/pull/1453). **Do NOT merge** — AJ merges after manual testing.

### What it does
New `apps/api_server/src/services/numbat_observability_service.ts` spawns
`numbat hook install --agent opencode --emit all --content preview` at
api_server startup, wired into the existing `agentExecutionEnabled` block in
`server.ts` (own try/catch, no change to existing calls). Gated by
`RHYTHM_NUMBAT_MONITORING_DISABLED=1` (checked first) and best-effort binary
resolution (`RHYTHM_NUMBAT_BIN_PATH` → `/opt/homebrew/bin/numbat` →
`/usr/local/bin/numbat` → bare `numbat` on PATH). **Observe-only, local-only,
no enforcement, no HTTP sink** — numbat's own upstream constraint for the
`opencode` agent (no `--enforce` flag accepted). Captured data lands in
numbat's own `$HOME/.numbat/records.ndjson`, wholly separate from Rhythm's
`run_quality` telemetry (#1069) — no schema/write-path collision.

### Test status
All 6 automatable acceptance criteria (AC1-AC6) pass with live-sandbox
evidence: real `numbat` v0.2.0 binary installed and independently
reproduced by verification-gate (real WS session + tool call → bounded
`content_preview` NDJSON records, no `enforcement` records, turn completes
without error). 13/13 unit tests, `tsc --noEmit` clean. AC7/AC8 are
structural/doc-inspection criteria, recorded `not_tested` with reasoning in
the contract — not silently marked green.

### Next step (Thread 2)
AJ: manual-smoke PR #1453 per `docs/testing/manual-smoke.md` §15 ("Numbat
OpenCode observability hook"), then merge decision.

Full detail: contract `docs/ai/contracts/issue-1452.json`, run note
`docs/ai/runs/2026-08-18-numbat-opencode-observability.md`, decision record
`docs/ai/decisions/2026-08-18-numbat-observability-integration.md`.
