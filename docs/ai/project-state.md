# Project State

## Current focus

**2026-06-25 — Per-session MCP tool-schema scoping (forked opencode engine).**

Goal: a "lite" agent session should only pay the token weight of its Agent
Profile's MCP allowlist. All MCP servers stay connected at startup (memory only,
no token cost); the only change is that the engine injects just the session's
profile allowlist into model context. This is Rhythm's owned fix for upstream
sst/opencode#5373.

Approach: vendor opencode as a git subtree (`apps/opencode_fork`), carry a minimal
per-session `mcpAllowlist` patch, build a standalone binary, and have api_server
pass each session's expanded profile allowlist on session create.

**Issue mcp-scope-01 DONE** (opencode @ v1.14.49 vendored).
**Issue mcp-scope-02 DONE** (engine patch + TS2416 carried fix + mcpAllowlist SQLite persistence defect fixed; all e2e cases pass).
**Issue mcp-scope-05 DONE** (allowlist expander).
**Issue mcp-scope-04 DONE** (api_server wiring).

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (stacking the mcp-scope-* work here).
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open, do not auto-merge.
  A draft PR for the mcp-scope work is opened at the END of the run (after 06).
- PR #741 (is_manager/importer decouple) merged as commit `5d67aaa`.

## In progress

mcp-scope run, order: 01 (done) → 02 (done) → 05 (done) → 04 (done) →
local proof (done — deterministic e2e) → **03** (CI binary bundle + sign, next)
→ 06 (verify).

The full software path is wired AND proven end-to-end: the deterministic e2e test
(`mcp_allowlist_e2e.test.ts`) drives the real prompt/resolveTools flow and shows the
offered MCP tool set drop 5→3→1→0 across no-profile / server-scoped / tool-scoped /
empty-allowlist sessions. What remains is the DELIVERY half: build/bundle/sign the
fork binary (03) so the running app actually uses the patched engine, then final
acceptance measurement (06). A live full-app smoke (Flutter UI + signed binary) is
naturally part of the post-03 manual smoke.

## Risks / known issues

- **Issue 03 is the riskiest** — CI `bun build --compile` (arm64+x64) + macOS
  sign/notarize + bundle into the .app + PATH-prepend before `createOpencode`.
  Audit signing/secrets config statically before any release run.
- **Pre-existing flaky test:** `tasks_controller.test.ts > overdue=yes` intermittent.
- **`toolClientNames()` / `tools()` snapshot race:** both read `s.defs[clientName]`
  from the same InstanceState snapshot in synchronous Effects; risk is low in practice
  but should be kept in mind on future MCP refactors.
- **Upstream TS2416 carried patch** in `bus/global.ts` — must re-validate on each
  `git subtree pull` from upstream. See `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md`.

## Test status

| Suite | Status |
|-------|--------|
| `apps/api_server npx tsc --noEmit` | **PASS** — exit 0 |
| `apps/api_server vitest` | **PASS** — exit 0 |
| `apps/opencode_fork bun run typecheck` | **PASS** — exit 0 (TS2416 fixed) |
| `apps/opencode_fork bun test src/session/mcp_allowlist.test.ts` | **PASS** — 5/5 |
| `apps/opencode_fork bun test test/session/mcp_allowlist_e2e.test.ts` | **PASS** — 4/4 (A=5, B=3, C=1, D=0) |
| `apps/opencode_fork bun test test/session/ src/session/` | **PASS** — 325 pass, 0 fail |
| `flutter analyze --no-fatal-infos` | **PASS** |
| `dart format --set-exit-if-changed` | **PASS** |

## Next step

1. Issue **mcp-scope-03** (CI binary bundle + sign) — riskiest. Static-audit
   `desktop_release.yml` signing/secrets first; build the fork binary via
   `bun build --compile` (arm64+x64), sign in tools/release, bundle into the .app,
   PATH-prepend its dir before `createOpencode`.
2. Issue **mcp-scope-06** (verification + acceptance measurement).
3. Live full-app manual smoke (Flutter UI + signed binary: open a Secretary session,
   confirm tool count drops) — part of the post-03 smoke handoff.
4. Open draft PR. No merge.

Per-issue run logs: `docs/ai/runs/2026-06-25-mcp-scope-0{1,2,4,5}-*.md`.
Persistence defect fix: `docs/ai/runs/2026-06-25-mcp-scope-02-allowlist-persistence.md`.
