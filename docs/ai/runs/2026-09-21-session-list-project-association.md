---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: none
issues: [1556, 1557, 1558]
status: pass
tags: [run, Rhythm]
---

# Session-list project association — exploration and issue filing

Exploration only, no product code touched (standing instruction: "explore all these and write issues, dont implement fixes yet").

## Files read

- `apps/web/src/components/SessionRail.tsx` — project grouping (`:246-251`), collapse state (`:114`, `:327-333`), advanced create dialog (`:117-177`, `:347`), create buttons (`:321`)
- `apps/web/src/store.tsx` — `LiveSessionInput` (`:26-38`), `createLiveSession` (`:753`), localStorage patterns (`:126-177`)
- `apps/web/src/gateway/sessions.ts` — `create` (`:476`), `projectLabels` (`:437`), `toSessionViewModel` (`:335`)
- `apps/api_server/src/controllers/agent_sessions_controller.ts` — create handler (`:864-1113`), project inference (`:935-945`)
- `apps/api_server/src/repositories/projects_repository.ts` — `findByCwdPrefix` (`:148-166`)
- `apps/api_server/src/services/agent_runner.ts` — `_recordSession` (`:583-591`), worktree overwrite (`:996`)
- `apps/api_server/src/services/opencode_client_service.ts` — `createWorktree` (`:2447`)

## Checks

Read-only against the running stack (no sessions or projects created/modified):

- `GET localhost:4001/health` → ok
- `GET localhost:4001/projects?includeArchived=true` → 17 projects, all plain `/Users/ajhochhalter/...` paths
- `GET localhost:4001/agent-sessions?limit=60` → correlated `cwd` / `worktreePath` / `projectId`

## Findings

Session→project association is **inferred server-side by cwd prefix**; no client ever sends `projectId`.

Root cause of the report: `agent_sessions_controller.ts:943` runs `findByCwdPrefix(sessionCwd)` *after* `sessionCwd` has been overwritten with the isolated worktree directory (`:908-931`). The engine creates worktrees under `~/.local/share/opencode/worktree/<hash>/<slug>`, outside every project root, so the lookup returns null.

Confirmed on his own session: `2026-09-21T19:28` "Reload Bug + Amazon misleading name", `projectId` NULL, cwd/worktreePath `~/.local/share/opencode/worktree/0174f2e0…/reload-bug-amazon-misleading-name`. It is the only row of the last 60 with a `worktreePath`. Non-worktree sessions at the same roots associate fine.

Sibling defect, same fix: `agent_runner.ts:591` hard-codes `projectId: null`, so every scheduled/skill run is unassigned.

Collapse machinery already exists in `SessionRail.tsx` — the collapsed-by-default request is an initial-value + persistence change, not new state.

## Issues filed

- #1556 bug — worktree sessions lose their project
- #1557 feature — "+" per project heading
- #1558 feature — project groups load collapsed, state persisted

New label `session-list` created.
