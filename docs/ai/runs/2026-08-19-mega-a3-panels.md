---
date: 2026-08-19
repo: Rhythm
branch: codex/mega-a3-panels
pr: null
issues: [1414, 1407]
status: ready_for_verification
tags: [run, Rhythm]
---

## Contract

- `docs/ai/contracts/issue-1414-1407.json`
- All four UI criteria are `not_tested`: the dispatch forbids concurrent Playwright execution, and this slice's ownership excludes existing Playwright specs. Browser verification is deferred to the orchestrator's serial gate.

## Files

- `apps/web/src/components/Profiles.tsx`
  - Replaced raw profile icon text at all three render sites with compact labels.
  - Preserved short fixture labels; asset paths, long icon names, and empty icons derive initials from the profile label.
  - Removed the three-character edit limit and uppercase transform for existing non-label icon values so saving does not corrupt asset paths.
- `apps/web/src/components/SessionRail.tsx`
  - Manual cwd edits clear branch/new-branch state and expose a neutral “Use cwd's current branch” selection.
  - Live create omits the branch when neutral, allowing the server to retain the typed cwd's current branch.
- `docs/ai/contracts/issue-1414-1407.json`
- `docs/ai/runs/2026-08-19-mega-a3-panels.md`

## Checks

- `cd apps/web && npm install` — pass; installed 77 packages. npm reported two dependency audit findings (one moderate, one high); no dependency files changed.
- `cd apps/web && npm run typecheck` — initial fail: `Profiles.tsx(28,35): TS2322` from an invalid empty-string default for the avatar size union.
- `cd apps/web && npm run typecheck` — pass after the focused type repair (`tsc -b`, exit 0).
- GitNexus pre-edit impact: `Profiles` LOW (0 upstream); `SessionRail` LOW (one direct caller, `AgentsWorkspace`; no affected process).
- GitNexus `detect_changes(scope=all)`: LOW risk, two changed source files, no affected execution processes.
- Playwright — not run, as explicitly required by the parallel-worktree dispatch.
- Sandbox — not run, as explicitly prohibited by the dispatch.

## Notes

- `agent_configs.icon` is seeded as `assets/agents/opencode.png` by `apps/api_server/src/services/agent_profile_sync.ts`. That file exists only under `apps/desktop_flutter/assets/agents/`; `apps/web/public/` contains only `assets/rhythm-logo.png`, `apps/web/src/assets/` does not exist, and Vite has no asset proxy. The Flutter asset paths are therefore not servable by the web client. The web UI deliberately renders initials instead of a known-broken `<img>`.
- The existing `GET /projects/:id/branches` route resolves only the stored project's cwd. The session VCS routes require an existing session, so neither resolves an arbitrary manually typed cwd before creation. Clearing the stale branch is the minimal safe option. The server ignores an omitted/blank branch and probes the supplied cwd only when a branch was explicitly requested.
- No Playwright spec files were edited. Verification should add the asset-path render/save assertions to `tests/post-m1-phase-2-profiles.redspec.ts` and run `npx playwright test tests/post-m1-phase-2-profiles.redspec.ts --workers=1`. Validate custom-cwd creation with `npx playwright test tests/sessions/session-live-lifecycle.live.spec.ts --workers=1` under that suite's documented serial live environment.
