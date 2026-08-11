---
date: 2026-08-11
repo: Rhythm
branch: mega-ws/permissions
pr: null
issues: [1341, 1367, 1322, 1340]
status: commit-blocked
tags: [run, Rhythm]
---

# ws-permissions regression repair

## Files

- `apps/api_server/src/controllers/agent_sessions_controller.ts`
  - Preserve the legacy three-argument `createSession` call in default and bypass modes while supplying the #1322 permission override only for plan mode.
  - Preserve the pre-existing OCU-01 route's canonical `permission.replied` broadcast independently of the new pending-permission bridge state.

## Checks

- PASS — `apps/api_server/node_modules/.bin/tsc -p apps/api_server/tsconfig.json --noEmit`.
- PASS — `npm test --workspace apps/api_server -- src/controllers/__tests__/agent_sessions_permissions.test.ts --reporter=verbose`: 3/3.
- PASS — `npm test --workspace apps/api_server -- src/services/opencode_client_service.test.ts --reporter=dot`: 57/57.
- PASS — `npm test --workspace apps/api_server -- src/services/opencode_client_service.test.ts -t "issue-1322" --reporter=verbose`: 2/2, including plan deny and non-plan no-override behavior.
- ENVIRONMENT BLOCKED — `npm test --workspace apps/api_server -- src/__tests__/opc_agent_session_routes.test.ts --reporter=verbose`: `listen EPERM: operation not permitted 127.0.0.1` in `beforeAll`, before all assertions.
- ENVIRONMENT BLOCKED — `src/__tests__/agent_sessions.test.ts` uses the same `startTestServer` loopback harness; the managed worker cannot bind sockets. The orchestrator's prior socket-capable run is the source of the six assertion failures being repaired.
- PASS — branch-local GitNexus impact analysis completed before edits; final unstaged detection reported one source file, six mapped symbols, five expected create/resume flows, MEDIUM aggregate risk.

## Notes

- No tests were weakened or removed.
- The fork was not touched, so the existing 107/0 fork permission-scope result remains applicable.
- Required follow-up before merge readiness: rerun the two named files in a socket-capable worker and confirm all six formerly failing assertions pass.
- Commit attempt `git commit -m "fix(api): restore permission route compatibility"` was blocked before staging because the managed worker cannot create `/Users/ajhochhalter/Documents/Rhythm/.git/worktrees/ws-permissions/index.lock` (`Operation not permitted`). No push occurred.
