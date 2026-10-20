# Rhythm — project state

## Current focus
Repair and qualify the local mega AI feature candidate, with Bot Crossing and unassigned-session errors first. [Repair run](runs/2026-10-20-mega-ai-repairs.md), [inventory](plans/2026-10-20-ai-feature-test-inventory.md). Overall qualification remains failed/incomplete while required flows lack evidence.

## Active branch / PR
- Local branch `test/feature-playwright-2026-10-19`; mega base `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`.
- Product candidate `92af064652a6f44155d09470af48a7b566994baf`, locally rebuilt/signed 0.18.83 Electron app. Exact packaged API and bundled/live fork identity enforced by runner.
- Bot artifact sealed from local dependency commit `a1f113340e643c50325ac1c1e0fc1ed0ed2e066b`.
- Existing integration target mega / #1598. Local commits only; no push, PR, merge, release, installation or installed-app changes. Original checkout dirt preserved.

## In progress
- Full 159-case packaged AI receipt: 67 passed/92 failed, 601.02s. Final test-only follow-ups are separate; current discovery 160 cases/15 files. [Classified results](../testing/results/2026-10-20-ai-repair-findings.md).
- Inventory covers 489 month-window commits in 82 groups (77 active/partial and five historical). Narrow successes leave broader execution/privacy/device boundaries explicit.

## Risks / known issues
- Embedded native Dayflow is absent: accepted source/layout/signing manifests are unavailable at recorded local paths. Installed/current/previous bundles contain only the standalone companion; backup contents remain unverified/inaccessible. No manifest/signature validation bypass.
- Permanent primary cwd is absent. Primary/Coordinator/approval lifecycle tests require supported disposable signed-in state; do not rewrite the user's journal or equate fixture bearer with ordinary authentication.
- Full suite caught a late retained-Hermes API timeout; the added hidden-interval CROSS test passed without reproducing it. Missing local OAuth application configuration also causes background sync audit failures in a follow-up. Neither is allowlisted or claimed repaired.
- Full PR gate has five unresolved Engraph ownership spawn failures (21/22 batches pass); guarded ownership file 19/19 and related serial cluster 99/99 pass separately. Root cause unproven; aggregate remains failed.
- Multi-harness immutability, hostile native frames/corrupt artifacts in the packaged app, account failover/privacy, execution, relay/device and permission claims retain explicit gaps.
- GitNexus index is stale; LOW/UNKNOWN results are supplemented by manual scope review. Builds stay within the shared 10 GiB guard; sandbox/runtime ownership rules remain mandatory.

## Test status
- Exact 92af signed candidate focused acceptance: 7/7 passed, no skips/flakies, 69.91s. Covers three actual Bot paging/retention/search cases, named unassigned session API/DB/engine persistence/deletion with strict audit, profile draft discard, unavailable Gallery inspector and historical empty-kind Report Card.
- Bot source regression 41/41 and real native frame fixture 6/6; independent-reader real sealed-worker RED/GREEN preserves the two-generation cap and source bytes. Post-return observer waits only for exact capacity refusal, max 30s before 60s expiry; measured native refresh cleared at 5.2s.
- Live isolated API+fork repairs 3/3 pass (built-in skill content, historical label, unavailable Gallery); catalog native subset 18/18 passed. Standalone signed Dayflow readiness passes separately from absent embedded module.
- Full 159 suite: 67 pass/92 fail; failures are 77 inventory gaps, 12 prerequisites, missing embedded Dayflow, late Hermes timeout and MCP response-lifetime test authoring. All 17 router and 10 ordinary session/conversation/project cases pass.
- MCP no-reload correction and CROSS pass in separate 6/2 follow-up; other failures there are host observer acquisition and missing local integration config. Final corrected Bot observer confirmation is 3/3, 55.70s. Whole suite was not rerun after these test-only changes.
- Issue gate and built-web smoke passed. PR aggregate 21/22; no overall PR/release PASS. Historical d7 result remains separate.

## Next step
Diagnose retained-Hermes late timeout with request/backend health evidence; recover accepted native Dayflow inputs and supported isolated signed-in primary/Coordinator state. Resolve local integration configuration and aggregate Engraph failure, then extend missing ownership/execution/device coverage. No overall qualification claim.
