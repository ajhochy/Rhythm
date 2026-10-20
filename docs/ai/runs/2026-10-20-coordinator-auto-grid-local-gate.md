---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pending
tags: [run, Rhythm]
---

# Coordinator Auto Grid local gate

## Files

- `apps/api_server/src/services/coordinator_conversation_service.ts`, `server.ts`: reserve the exact C2 command before Auto classification, recheck owner/project/profile/permission and account state, then dispatch the selected Grid route with requested-versus-final provenance. Fixed mode bypasses Grid.
- `apps/api_server/src/services/decision/turn_routing.ts`, `router_grid_turn.ts`, `repositories/agent_sessions_repository.ts`: optional Coordinator-only synchronous guarded commit after Luna's awaits. The session model, variant and account fields use one SQLite CAS; Free Mode cannot put C2 into the ordinary WS replay queue. Ordinary Grid callers keep their existing path.
- `apps/api_server/src/__tests__/coordinator_chat_controls_parity.test.ts`, `services/decision/router_grid_turn.test.ts`: guarded route, stale authority, fixed bypass, and no-queue contracts.
- `apps/api_server/src/__tests__/coordinator_auto_grid_live_e2e.test.ts`: default-skipped real API/engine dispatch-binding gate requiring a prestarted approved private sandbox and explicit owned synthetic root.

## Checks

- RED: `npx vitest run src/services/decision/router_grid_turn.test.ts -t 'Coordinator guarded route cannot overwrite'` failed before the product change: an in-flight Luna classification overwrote a newly fixed model and returned `applied: true`.
- GREEN after Engraph's sandbox teardown: `npx tsc --noEmit --pretty false` passed; `npx vitest run src/__tests__/coordinator_chat_controls_parity.test.ts src/services/decision/router_grid_turn.test.ts src/__tests__/coordinator_auto_grid_live_e2e.test.ts` passed 94/94 focused cases with the one live case skipped by default.
- The live gate has **not** exercised a real API/engine turn yet.
- GitNexus impact/detect reported LOW or missing symbols against an index 290 commits stale; manual upstream review treats C2 foreground dispatch, Grid persistence, account routing, and strict native/Dayflow provenance as HIGH blast radius.

## Notes

- This is a local source candidate, not a confirmed served-model or packaged-UI result. The real sandbox gate needs an approved synthetic primary root, private Grid/Luna account configuration, and exact running API/engine build identity. A separate bounded private model run must establish the actual answer in the main UI.
- The external account-routing file is synchronous but outside SQLite's transaction. If its write throws, the DB transaction rolls back and no SDK request is sent. A later relay/outbox failure after a successful file write could leave file/DB disagreement; the next authority check still refuses SDK dispatch. This cross-store atomicity limit is inherited from the existing account-routing architecture and remains a review risk.
- Original intermittent Hermes 15-second IPC timeout is a separate unproven cause; this Coordinator work does not close that gap.
