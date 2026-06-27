---
index: "[[Rhythm]]"
date: 2026-06-23
repo: Rhythm
branch: feature/agent-scheduler
pr: "734"
issues: agent-local-auth-bypass
status: verified (headless) — manual smoke pending
tags: [run, Rhythm]
---

# Run: Apply AGENT_LOCAL auth bypass to all agent-local routers

## Summary

On the local agent server (`AGENT_LOCAL=true`), the Flutter data sources send
no bearer token. Several routers — `agent-schedules`, `agent-memory`,
`agent-webhooks`, `agent-research`, and the newly added `agent-cookbook`,
`agent-designs`, and `gmail-signals` — used an unconditional
`router.use(requireAuth)`, so every local request 401'd with "Missing bearer
token". This silently broke Scheduled Tasks, Brain (memory), Webhooks, and Deep
Research when run locally.

The fix matches the correct per-router gate already used by `agent_sessions` /
`agent_configs`: `if (!env.agentLocal) router.use(requireAuth)`. Production
(no `AGENT_LOCAL`) still requires auth — unchanged. A regression test then locks
both halves of the contract so the bug cannot silently ship again.

## Files changed

- `apps/api_server/src/routes/agentSchedulesRoutes.ts`
- `apps/api_server/src/routes/agentMemoryRoutes.ts`
- `apps/api_server/src/routes/agentWebhookRoutes.ts`
- `apps/api_server/src/routes/agentResearchRoutes.ts`
- `apps/api_server/src/routes/agentCookbookRoutes.ts`
- `apps/api_server/src/routes/agentDesignsRoutes.ts`
- `apps/api_server/src/routes/gmail_signals_routes.ts`
  - Each: `router.use(requireAuth)` → `if (!env.agentLocal) router.use(requireAuth)`.
- `apps/api_server/src/__tests__/agent_local_auth_bypass.test.ts` — new file (100 lines)
  - `AGENT_LOCAL=true` → the agent-local routes are reachable **without** a
    bearer token (no 401).
  - `AGENT_LOCAL` unset → the same routes still require a token (401).
  - Sets `AGENT_LOCAL` + `vi.resetModules()` before importing the app so
    routers re-read `env.agentLocal`.

## Checks run

| Check | Result |
|-------|--------|
| `tsc --noEmit` | PASS — 0 errors |
| `npm test` (vitest, full suite) | PASS — 953/953 (+2 new regression tests) |

Branch: `feature/agent-scheduler`
Commits: `d315aa9` (fix) · `463f2a3` (regression guard)

## Decisions

- Bypass is keyed on `env.agentLocal` (`process.env.AGENT_LOCAL === 'true'`),
  consistent with the existing per-router pattern — no new auth mechanism.
- The regression test is the artifact whose absence let the bug ship; it asserts
  both the bypassed (local) and enforced (production) paths.

## Notes

- Production auth tests are unaffected — they run without `AGENT_LOCAL`.
- This is the local-dev/bundled-app path; see also the `MCP_ROLES_DIR` caveat in
  `project-state.md` for the bundled api_server.
