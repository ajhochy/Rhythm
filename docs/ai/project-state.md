# Project State

## Current focus

First-turn token bloat fix: scope `task`-tool child sessions to their profile's skills
(mirror of the #1012 MCP fix, for skills). **Merged to `main` (PR #1120, squash `afd9b0116`);
release v0.18.46 building** (rebuilds the fork so the `task.ts` change ships to the app).

## Active branch / PR

- Branch: `main` @ `afd9b0116`.
- PR: [#1120](https://github.com/ajhochy/Rhythm/pull/1120) — **merged** (squash). No linked issues (direct fix).
- Release: v0.18.46 via `desktop_release.yml` ([run 29606504006](https://github.com/ajhochy/Rhythm/actions/runs/29606504006)), prerelease=false.
- Prior: Epic #1116 shipped — PR #1117; release v0.18.45.

## In progress

- Release build v0.18.46 (~10-15 min: flutter build → bundle api_server → rebuild fork → sign → notarize → GitHub Release). Watch to green, then install + smoke.

## Risks / known issues

- **NULL-semantics decision flagged for review** in #1120: `childSkillAllowlist` falls back to the
  parent session's scope when a profile declares no skills (never "all skills"). Reviewer may prefer the
  pure #1012 mirror (return `undefined`). See `docs/ai/decisions/2026-07-17-child-session-skill-scope.md`.
- **Sandbox provider isolation** — the dev sandbox's isolated HOME can't reach keychain-bound Anthropic
  OAuth; only OpenRouter (static API key in `auth.json`) works there. Live e2e model runs use an
  OpenRouter model; token accounting is provider-independent.
- **Pre-existing test pollution** — `issue_723_mcp_remove_reconcile.test.ts` writes the real
  `~/.config/opencode/opencode.json` under real HOME. Run api_server suites under a sandboxed HOME.
- **better-sqlite3 ABI** — root `node_modules` binary is ABI 147 (Node 26); default `node` on PATH is
  v22 (ABI 127). Run api_server vitest/build with `PATH="/opt/homebrew/bin:$PATH"` (Node 26).

## Test status

`fix/skill-scope-task-children` (Node 26 / sandboxed HOME): api_server `tsc` clean + `vitest`
**2889 passed** / 32 skipped / 0 failed; fork `bun run typecheck` clean + `bun test test/tool/task.test.ts`
**16 pass**; fork `bun run build --single` + api_server `npm run build` clean. GitNexus `detect_changes`
vs main: risk **low**, 0 affected processes. Live e2e in `docs/ai/runs/2026-07-17-skill-scope-task-children.md`
(task-tool children 10–13k first turns vs 85k unscoped baseline; before-fix live children 116–126k).

## Next step

Confirm Server CI green on #1120, hand off for human smoke-test + merge. The fork `task.ts` change is
inert until a fork rebuild (release build), so post-merge a release build is needed to ship it to the app.
