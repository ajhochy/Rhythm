# Rhythm — project state

## Current focus
Month-wide AI feature inventory and local mega Playwright qualification, including Dayflow, Hermes and Bot Crossing. [Inventory](plans/2026-10-20-ai-feature-test-inventory.md), [run](runs/2026-10-20-ai-feature-playwright.md), [findings](../testing/results/2026-10-20-ai-findings.md). This is failed local qualification, not an overall mega/release pass.

## Active branch / PR
- Work branch: `test/feature-playwright-2026-10-19`; mega base `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`, remote head checked this run.
- Product source: `d7fb554735f93c0d0a76785cbadd583d0f866610` (prior router calibration). Current changes are tests/docs/runner only.
- Locally built/signed 0.18.83 app remains in the task worktree. Exact API and bundled/live engine identity required; no GitHub artifact substitution or rebuild of unchanged product sources in this phase.
- Existing integration target mega / PR #1598. Local commits only; no push, PR, merge, release or installation. Installed app and original checkout dirt preserved.

## In progress
- Three cheap gpt-6-luna research agents reviewed 489 month-window commits, merge provenance, primary issue/PR evidence and existing tests. Inventory has 82 groups: 77 current/partial user-feature claims and five historical/audit boundaries.
- New packaged checks exercise catalog/reload/error recovery, memory, skills, cookbook inert CRUD, schedules read/cancel, shared agents, read-only Settings/model/MCP/profile agreement and actual companion children/services. Explicit UNVERIFIED markers preserve missing assertions/prerequisites.
- Current capability disclosure is status-only; finite G2 admission/callback/checked-result paths are retired. Generic Coordinator multi-run remains active and separately unqualified.

## Risks / known issues
- Empty-project branch requests fail strict session/conversation error audits. Bot Crossing real inventory fails with revoked/unavailable channels. Report Card blank labels, unavailable local skill content and a missing Gallery thumbnail remain visible.
- Native Dayflow module is absent from this local bundle; accepted native source/stage/manifests are unavailable at recorded paths. Separately, the newer signed installed Dayflow fails the exact older version pin. Do not bypass signature/manifest guards.
- Existing primary cwd is missing; tests refuse to rewrite the permanent journal. Approval expiry/owner switches/concurrent Coordinator and broader execution/privacy/device coverage need supported disposable state or appropriate native/device fixtures.
- RHYTHM_SMOKE_USER_DATA changes only Chromium profile, not DB/engine/companion/Keychain isolation. Never start a second API by hand. Preserve the shared 10 GiB guarded-build cap and symlinked dependency stores.
- GitNexus index is stale and targets the original checkout; new helper lookups return UNKNOWN. Manual test/docs diff review supplements it.

## Test status
- Full 155-case snapshot at 8ca697e58f: 46 passed / 109 failed / no skips or flaky results in 17.4 minutes. Of failures: 80 coverage markers, 12 prerequisites, 16 runtime/data/build failures and one test-authoring error. See sanitized per-case JSON; do not call these 109 distinct product bugs.
- Corrected two-case Bot Crossing rerun: 0/2, both real data channels fail. Final gap-only run: 77 explicit failures after historical G2 reclassification. Separate receipts must not be reported as one final whole-suite run.
- Router: all 17 cases pass again, including cheap route and routine inline edit. Hermes history/draft/overlay all pass. Prior calibration source tests/build/sandbox evidence remains in its run log.
- Added Settings/Profile focused receipt: 3/3 read-only cases passed after two recorded test-authoring corrections. A later final MCP-only run timed out at 120s (status assertion took71.5s; API/engine healthy); root cause unproven and reliable MCP qualification remains failed. Final discovery 155 cases/14 files includes 37 new live checks and 77 current inventory gap markers.
- Strict packaged TypeScript, runner syntax/list and local signature checks return zero; final exact commands/results are recorded in the run. Prior aggregate PR gate was not rerun after scoped repairs; no one-shot aggregate PR/release pass exists.

## Next step
Review local findings, then repair/requalify the concrete failures and fill remaining safe test gaps with disposable state. Product fixes, integration and release are separate actions; a catalog pass cannot qualify execution, privacy, ownership or restart behavior.
