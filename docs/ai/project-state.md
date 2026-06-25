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

**Issue mcp-scope-01 is DONE** (opencode @ v1.14.49 vendored). Now on Issue 02.

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (stacking the mcp-scope-* work here).
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open, do not auto-merge.
  A draft PR for the mcp-scope work is opened at the END of the run (after 06).
- PR #741 (is_manager/importer decouple) merged as commit `5d67aaa`.

## In progress

mcp-scope run, order: **01 (done)** → 02 (engine patch) → 05 (allowlist expander)
→ 04 (api_server wiring) → local proof → 03 (CI binary bundle + sign) → 06 (verify).
Next: Issue 02, preceded by `acceptance-contract`.

## Risks / known issues

- **Upstream baseline TS2416** in `apps/opencode_fork/packages/opencode/src/bus/global.ts`
  (pristine v1.14.49 `@types/node` EventEmitter generic). Non-blocking for the
  binary; minimal type-only fix folded into Issue 02. Re-validate on each
  `git subtree pull`. See `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md`.
- **Issue 03 is the riskiest** — CI `bun build --compile` (arm64+x64) + macOS
  sign/notarize + bundle into the .app + PATH-prepend before `createOpencode`.
  Audit signing/secrets config statically before any release run.
- **Pre-existing flaky test:** `tasks_controller.test.ts > overdue=yes` intermittent.

## Test status

| Suite | Status |
|-------|--------|
| `apps/api_server npx tsc --noEmit` | **PASS** — exit 0 (no opencode_fork bleed) |
| `apps/opencode_fork bun install` | **PASS** — exit 0 (upstream lockfile unchanged) |
| opencode pkg `bun run typecheck` | **1 baseline error** — upstream TS2416, deferred to Issue 02 |
| GitNexus detect_changes vs main | additions-only; no existing code symbol modified |

## Next step

1. `acceptance-contract` for Issue mcp-scope-02 (per-session `mcpAllowlist` gate).
2. coding-agent: patch `session/session.ts` + `session/prompt.ts`, add fork unit
   test, carry the baseline TS2416 fix; `verification-gate`.
3. Continue 05 → 04 → local proof → 03 → 06; open draft PR at end. No merge.
