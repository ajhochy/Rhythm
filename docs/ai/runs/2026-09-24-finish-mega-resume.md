---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1500, 1565, 1574]
status: partial
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Resumed full open-issue scope

AJ explicitly requested all unfinished Rhythm issues, including the Bot Crossing/Colony tab and Hermes shared memory plus shared named agents/settings and two-way delegation, stacked onto #1544 for one combined smoke. See [scope decision](../decisions/2026-09-24-finish-mega-scope.md).

## Changes and focused evidence

- #1574: resumed the preserved owner/relay implementation after independent review. `_runIndex` now retries exact recorded process disappearance for a bounded 3.5 seconds before clearing its own marker fields; uncertain/live identities remain recorded. No signal path was added by this last repair. The integrated prior one-shot version failed 58/59; the final integrated manager/ownership/routes command passed 59/59. Env-gated fake-CLI lifecycle tests passed 2/2 (real OS process ownership, shutdown and serving/indexing parent death). API build passed. This remains synthetic CLI evidence, not real Engraph/native or machine-cleanup qualification.
- #1565: production-routed messages use the reserved test host forwarded only to the canonical sandbox API. Redirects and other remote requests remain blocked. Binding the Playwright output-path callback fixed a second harness-only defect. Final real-API message/browser tests passed 2/2 with local and Kolkata labels, invalid-time fallback, accessible semantics and screenshots. Root inspected the rendered message screenshot. Synthetic threads were deleted and sandbox torn down. Remaining surfaces/dist/native checks remain open.
- #1500: CI on d0669ca4 failed the known same-tick stale-redo test (6288 pass, 1 fail, 263 skip). Added two tied-creation-time cases with opposite final statuses; both failed before repair. Detector now orders by creation then update time, using stable IDs only when time evidence is completely tied. Original sequential fixture is explicitly backdated. Added a fully tied input-order permutation regression; full workflow-signal suite passed 66/66. Identity order is deterministic and does not claim chronological evidence when every timestamp is tied.

## Commands

From apps/api_server:

- `TMPDIR=/private/tmp/rhythm-repair4-engraph-test ./node_modules/.bin/vitest run src/__tests__/engraph_manager.test.ts src/__tests__/issue_1574_engraph_ownership.test.ts src/__tests__/engraph_manager_routes.test.ts`
- `RHYTHM_LIVE_E2E=1 RHYTHM_1574_FIXTURE_ROOT=/private/tmp/rhythm-repair4-engraph-test ./node_modules/.bin/vitest run src/__tests__/live_e2e_issue_1574_engraph_process.test.ts`
- `./node_modules/.bin/vitest run src/__tests__/workflow_failure_signal_extractor.test.ts`
- `npm run build`

From apps/web, with canonical sandbox API/engine/gateway :6598/:6597/:6599:

- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:6598 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:6597 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-repair4-integrated-sandbox npx playwright test --config tests/timestamp-1565-live-playwright.config.ts`

## Limits

The 16-stage gate passed on prior source9bd0dc32; new combined gate/CI pending. #1500 public runtime audit qualification remains distinct from the repository-backed detector tests. GitNexus found LOW impact for detector (one direct caller, three upstream symbols); timestamp test helper was absent from stale index and its two local test callers were checked directly. Full Engraph integration had prior impact review, and resumed cleanup review found no new unsafe signaling. No overall issue/release PASS. All 91 current open issues are mapped in the local coverage report; not all are implemented or assigned yet. Existing dirty docs are preserved.

Evidence: `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/` (resumed Engraph logs/review, timestamp-live-proxy screenshots, 1500-red/green and CI failure log).
