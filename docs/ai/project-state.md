# Rhythm current state

Focus: scoped Dayflow and automatic permission repairs integrated onto existing mega/2026-09-29-consolidation (draft PR1598).

Included: scheduled zero-history ordinary admission with ownership/history/finalizer safeguards; authoritative event-directory automatic permission replies and acknowledgement-only resolved events. Existing mega provider-error handling retained.

Excluded/recoverable: PR1610 Coordinator proposal/model/inventory changes, Workflow instruction candidate and unproven handoff harness. Original source branch/PR/external patch preserved. No later successful handoff proof found.

Test status: API typecheck/build;48 focused tests after the companion fixture correction; actual fork build; live permission transport regression and live scheduled Dayflow transport test all exited0. Repo-wide wrapper blocked by Flutter cache restriction and restricted local binds; no full-suite PASS claim. Fresh remote head/CI checked after push.

Risk: historical missing approval-card cause remains unresolved; manual/reconnect stale-CWD path not covered. No installed-runtime qualification.

Next: human review/manual smoke of mega draft; no main merge/install/restart authorized here. See runs/2026-10-08-scoped-dayflow-approval-mega-integration.md.

Companion scheduled_task_id fixture correction copied exactly from30f51138 after CI exposed the omitted test schema update. Production files unchanged. Previous ac056260 CI:4 success;desktop download failure,2 unrelated mobile test failures,and1 API fixture failure. New exact-head CI followed separately. See runs/2026-10-08-dayflow-fixture-integration-correction.md.

## Branch fix/scheduled-dayflow-memory-router-20261008 (draft PR onto mega, 2026-10-08)

On top of mega 8c003765: widens the scheduled zero-history Dayflow admission to every system AgentRunner session and to owned chats left unassigned to a project (scheduled children and self-improvement runs were still held `history_ambiguous`: 61 of 72 failures since the 2026-10-07 build); automatic memory admitted only on the text actually injected, with follow-up evidence and per-turn body-free receipts; shadow routing non-blocking, once per session, concrete would-be pick, no uncertain frontier downgrade; new `openai_decisions` router backend (Shadow only). Kev runs as a launchd service on 127.0.0.1:8009. Sandbox live suites pass on production source identical to d7df02cd; installed app not tested; routing stays Shadow. Separate and unaddressed: `nfl_mcp` required-MCP scheduled failure. Record: runs/2026-10-08-scheduled-dayflow-memory-router.md.
