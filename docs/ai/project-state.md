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
**Issue mcp-scope-03 DONE** (CI binary bundle + sign + PATH injection — all checks pass).
**Issue mcp-scope-06 DONE** (verification: resolveToolsCount DEBUG log + acceptance proven by composition; live full-stack smoke deferred to post-release).

**All 6 mcp-scope issues complete.** Ready for draft PR + manual smoke handoff.

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (stacking the mcp-scope-* work here).
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open, do not auto-merge.
  A draft PR for the mcp-scope work is opened at the END of the run (after 06).
- PR #741 (is_manager/importer decouple) merged as commit `5d67aaa`.

## In progress

mcp-scope run COMPLETE: 01 → 02 → 05 → 04 → local proof → 03 → 06 all done.
Next: open the draft PR (no merge), then the live full-stack manual smoke after a
release/dev build with the bundled fork binary.

The full software path is now wired AND bundled:
- The deterministic e2e test proves the gate fires end-to-end.
- `augmentPathForOpencode()` now prepends `Contents/Resources/opencode_bin/` FIRST
  when the bundled binary is present; WARNs and falls back in local dev.
- CI builds both darwin arches via `bun run build`, lipo-merges into a universal
  binary, bundles to `Contents/Resources/opencode_bin/opencode`, and verifies
  presence + executability + version marker (must NOT be stock `^1\.14\.x`).
- `sign_and_notarize_macos.sh` explicitly codesigns the extensionless Mach-O
  before the broad `find`-based nested-binary pass; errors if binary absent.

What remains: Issue 06 acceptance measurement (tool count drops to profile
allowlist in a live Secretary session after a fork-bundled build), plus the
live full-app manual smoke.

## Risks / known issues

- **Issue 06 live smoke still required** — CI binary bundle not yet exercised in
  a real release run (HARD STOP rules prevented triggering CI). The fork-marker
  version check (`^1\.14\.` regex) guards against accidental stock-binary shipping.
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
| `apps/api_server vitest` | **PASS** — exit 0 (21/21 for opencode_client_service.test.ts) |
| `apps/opencode_fork bun run typecheck` | **PASS** — exit 0 (TS2416 fixed) |
| `apps/opencode_fork bun test src/session/mcp_allowlist.test.ts` | **PASS** — 5/5 |
| `apps/opencode_fork bun test test/session/mcp_allowlist_e2e.test.ts` | **PASS** — 4/4 (A=5, B=3, C=1, D=0) |
| `apps/opencode_fork bun test test/session/ src/session/` | **PASS** — 325 pass, 0 fail |
| `flutter analyze --no-fatal-infos` | **PASS** |
| `dart format --set-exit-if-changed` | **PASS** |
| `bun run build --single --skip-embed-web-ui` (fork) | **PASS** — `0.0.0-feature/agent-scheduler-<ts>` |
| `bash -n sign_and_notarize_macos.sh` | **PASS** — syntax OK |

## Next step

1. Issue **mcp-scope-06** (verification + acceptance measurement):
   - Trigger a `flutter run` build.
   - Open a Secretary session, measure injected MCP tool count via engine debug log.
   - Assert count equals `expandMcpAllowlist(secretaryConfig).tools.length`.
   - Record in `docs/ai/runs/` + update `docs/ai/testing-guide.md` smoke entry.
2. Live full-app manual smoke (Flutter UI + signed binary: open a Secretary session,
   confirm tool count drops) — part of the post-06 manual smoke handoff.
3. Open draft PR. No merge.

Per-issue run logs: `docs/ai/runs/2026-06-25-mcp-scope-0{1,2,3,4,5}-*.md`.
Persistence defect fix: `docs/ai/runs/2026-06-25-mcp-scope-02-allowlist-persistence.md`.
