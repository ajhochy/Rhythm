---
date: 2026-07-17
repo: rhythm
branch: fix/1121-project-already-exists-dropdown
pr: null
issues: [1121]
status: implemented, tests green, awaiting verification-gate + manual Flutter smoke
tags: [run, rhythm]
---

# Issue #1121 — "rhythm" project missing from dropdown, re-create fails "already exists"

## Root cause

`AgentProjectsController.load()` (which populates the "By Project" dropdown
list) was **never called anywhere in the app** — `main.dart` constructed the
provider but wired no load trigger, unlike the sibling `AgentConfigsController`
which refreshes once `agentServerController.isReady`. So the dropdown only ever
showed projects created *within the current app session* (via the optimistic
prepend in `create()`); any project already in the DB (created in a prior
session) was invisible. Meanwhile `POST /projects` correctly rejects a
duplicate `cwd` via `findByExactCwd` — which is why re-adding the same folder
fails with "already exists" even though the dropdown shows nothing.

The backend error message (`A project already exists at this folder ("<name>")`)
and the Flutter HTTP error parsing (`http_utils.dart` → `AppError.toString()`)
already carried the full message end-to-end without truncation — verified,
no fix needed there.

## Files changed

- `apps/desktop_flutter/lib/main.dart` — wire `AgentProjectsController.load()`
  to run once the local agent server is ready (mirrors the existing
  `AgentConfigsController` → `agentServerController.isReady` pattern).
- `apps/desktop_flutter/lib/features/agent_projects/controllers/agent_projects_controller.dart`
  — `create()` now calls `load()` (reloading from the server) on failure
  before rethrowing, so a duplicate-cwd rejection immediately surfaces the
  existing project in the dropdown instead of leaving it stale/absent.
- `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart`
  — `_ByProjectSelector` now shows a small warning icon (with the error text
  in its tooltip) when `AgentProjectsController.status == error`, instead of
  silently rendering an empty dropdown when `load()` fails.
- `apps/api_server/src/__tests__/projects_routes.test.ts` — added regression
  test: `POST /projects` with a `cwd` that already has a project returns 400
  naming the existing project, and `GET /projects` still lists it.

## Checks run

- `impact({target:"AgentProjectsController", direction:"upstream"})` →
  HIGH risk / 8 direct callers (class-level fan-out from the constructor is
  expected — only additive changes to the class were made, no removed
  members). `impact({target:"create"/"load", ...})` on the two touched
  methods → LOW risk, 0 callers found (confirms `load()` was genuinely dead
  code — no caller graph edge existed anywhere in the app before this fix).
- `tools/dev/sandbox.sh up` → required one-time environment fix: the
  homebrew-installed `node` (v26.5.0) didn't match the prebuilt
  `better-sqlite3` binary (NODE_MODULE_VERSION mismatch, no nvm/volta present
  to pin a compatible version). Ran `npm rebuild better-sqlite3` once at the
  repo root to fix; sandbox then came up healthy at `http://127.0.0.1:4098`.
  This is an environment-only fix, not a code change.
- `cd apps/api_server && npx vitest run src/__tests__/projects_routes.test.ts src/__tests__/projects_checkout.test.ts`
  → **18 passed** (includes the new #1121 regression test). This suite drives
  the real HTTP surface (`startTestServer(createApp())`, real `errorHandler`,
  real SQLite) — not mocked — so it doubles as the AGENTS.md-required live
  behavioral check for the backend half of this fix.
- `tools/dev/sandbox.sh down` — sandbox torn down cleanly after tests.
- `dart format lib/main.dart lib/features/agent_projects/controllers/agent_projects_controller.dart lib/features/agents/views/_agents_nav_column.dart --set-exit-if-changed`
  → 0 changed, clean.
- `flutter analyze --no-fatal-infos` on the same 3 files → **No issues found.**
- `detect_changes({scope:"all"})` → 4 changed symbols across the 4 files
  touched, `risk_level: low`, 0 unexpectedly affected processes.
- `git diff --name-only` → exactly the 4 files listed above; matches
  expectation, no stray edits.

## Notes

- No Flutter live/manual smoke of the actual desktop app was run (would
  require launching the built app against the sandbox and clicking through
  the dropdown/dialog) — flagged as the remaining manual-smoke step per
  `docs/testing/manual-smoke.md`.
- No schema migration added (per issue scope) — uniqueness remains
  controller-enforced only, as directed.
- Left uncommitted per instructions; orchestrator to review/commit.
