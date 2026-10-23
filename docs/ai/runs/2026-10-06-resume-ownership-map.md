# Rhythm resume 2026-10-06 — ownership / dependency map (draft, orchestrator-owned)

## Reconciled source lineage (verified by git)
- GitHub: mega/2026-09-29-consolidation @ 18705742, draft PR #1598, CI green.
- Local-only lineage (never pushed): 34 commits → 6e339972 (RUNNING app source, launched from
  task-11/rhythm-coordinator-tool-discovery-delivery-20261006/snapshot/apps/electron/dist/Rhythm.app,
  profile task-11/normal-candidate-build-20261003/normal-candidate-profile; pids 21845 main / 21851 api / 21887 engine)
  → 5b81e7b9 (approval-resume + router confidence repair; packaged, NOT installed).
- Preserved in main repo today: `integration/2026-10-06-resume` = 5b81e7b9 (composition base);
  `wip/g2-c2-partial-20261006` = 610caa25 (6e339972 + Terra G2/C2 dirty tree);
  `wip/native-host-electron-20261006` = 7f127917 (5b81e7b9 + 5 Electron native host files);
  `wip/mobile-canonical-backend-20261006` = 13d7a4ab (5da2f764 + 117 dirty backend files).
- Integration worktree: /Users/ajhochhalter/Documents/Rhythm-pr-worktrees/integration-20261006 (branch integration/2026-10-06-resume).
- Main checkout is dirty with an unrelated in-progress semantic-memory/engraph stream (19 files on mega). Untouched.
- Instrument note: typecheck of 5b81e7b9 against main's node_modules fails on `McpStatusEntry 'configured'` — generated opencode SDK drift, not source. Resolve by using the candidate's node_modules / regenerating SDK.

## Streams, owners, file ownership
| Stream | Composition owner | Writers (Sonnet) | Files owned | Depends on |
|---|---|---|---|---|
| A G2 coordinator | Fable (me) | TBD after plan-A | apps/api_server/src/services/persistent_workstream_coordinator.ts, agent_delegation_service.ts, coordinator_* , shared_agents/delegation_jobs_repository.ts | C2 merge first (same files) |
| C Dayflow/memory context | Fable | TBD | apps/api_server/src/services/dayflow_*, integrations/dayflow/*, apps/opencode_fork/.../rhythm_provider_* | none (accepted) |
| B Native Dayflow | Fable | TBD | apps/electron/src/{main.mjs,preload.cjs,rhythm-agent-tools.mjs,native-dayflow-production-host.mjs}, apps/web DayflowTool.tsx, dayflow-desktop.ts, packaging config | independent of A |
| D Mobile + Research | Fable | TBD | apps/mobile/**, apps/api_server/src/routes/mobile_tools_routes.ts, mobile_gateway_routes.ts | gateway slice before device proof |
| E Routing | Fable | TBD (report only) | apps/api_server/src/services/decision/** (already in 5b81e7b9) | none |
| F Calendar/context packets | Fable | TBD | per plan-E/F | overlaps D backend files |

## Shared-file conflict zones (serialize)
- coordinator_conversation_service.ts / coordinator_conversations_repository.ts / opencode_client_service.ts: touched by 5b81e7b9 AND 610caa25 AND 13d7a4ab.
- apps/api_server/src/server.ts, app.ts: touched by 610caa25 and 13d7a4ab.

## Gates
- No install/restart of the running app without telling AJ.
- Every slice: contract test red → green with mutation proof; tests must be in CI globs.
- Compose on integration/2026-10-06-resume only; push + draft PR; never merge.
