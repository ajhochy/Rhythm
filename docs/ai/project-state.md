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
**Issue mcp-scope-02 DONE** (engine patch + TS2416 carried fix; verification passed).

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (stacking the mcp-scope-* work here).
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open, do not auto-merge.
  A draft PR for the mcp-scope work is opened at the END of the run (after 06).
- PR #741 (is_manager/importer decouple) merged as commit `5d67aaa`.

## In progress

mcp-scope run, order: 01 (done) → 02 (done) → **05** (allowlist expander, next)
→ 04 (api_server wiring) → local proof → 03 (CI binary bundle + sign) → 06 (verify).

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
| `apps/opencode_fork bun test src/session/` | **PASS** — 5 pass, 0 fail |
| `flutter analyze --no-fatal-infos` | **PASS** |
| `dart format --set-exit-if-changed` | **PASS** |

## Next step

1. Implement Issue **mcp-scope-05** (allowlist expander: `.mcp-roles` config → flat sanitized `<server>_<tool>` id list).
2. Implement Issue **mcp-scope-04** (api_server wiring: pass `mcpAllowlist` on `createSession`, both paths).
3. Local end-to-end proof (fork binary on PATH, open Secretary session, verify tool count drops).
4. Issue **mcp-scope-03** (CI binary bundle + sign).
5. Issue **mcp-scope-06** (verification + acceptance measurement).
6. Open draft PR. No merge.
