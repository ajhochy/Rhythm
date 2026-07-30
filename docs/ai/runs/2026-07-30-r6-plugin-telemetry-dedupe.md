---
date: 2026-07-30
repo: Rhythm
branch: codex/r6-plugin-telemetry-dedupe
pr: null
issues: []
status: blocked-git-metadata
tags: [run, Rhythm]
---

# R6 OpenCode plugin and telemetry deduplication

## Files

- `apps/api_server/src/services/opencode_plugin_config.ts` — replaces every
  positively identified managed plugin copy with the active checkout/package
  path.
- `apps/api_server/src/services/opencode_plugin_identity.ts` — canonical
  `rhythm-managed:<name>` identity from reserved name, reserved path marker,
  or matching realpath.
- `apps/api_server/src/__tests__/opencode_plugin_config_identity.test.ts` —
  temp-directory-only acceptance coverage for path canonicalization, stale
  cleanup, third-party preservation, convergence, and the single telemetry
  event seam.
- `docs/ai/contracts/r6-plugin-telemetry-dedupe.json` — executable acceptance
  contract (five automated criteria, one diff-review scope guard).

## Checks

- `npm install` (repo root) — exit 0; 217 packages installed, 12 audit findings
  reported (pre-existing dependency audit scope: 1 low, 7 moderate, 4 high).
- RED: `cd apps/api_server && npx vitest run src/__tests__/opencode_plugin_config_identity.test.ts`
  — exit 1; 1 file failed, 5/5 tests failed on the unmodified implementation.
- `cd apps/api_server && npx tsc --noEmit` — exit 0.
- GREEN: `cd apps/api_server && npx vitest run src/__tests__/opencode_plugin_config_identity.test.ts src/__tests__/rhythm_session_context_plugin.test.ts src/__tests__/opencode_plugin_config_managed_defaults.test.ts src/__tests__/opencode_plugin_config_org_skills.test.ts src/__tests__/opencode_plugin_config_org_instructions.test.ts`
  — exit 0; 5 files passed, 33/33 tests passed.
- GREEN: `cd apps/api_server && npx vitest run src/__tests__/rhythm_telemetry_plugin.test.ts -t "ensureRequiredPlugins"`
  — exit 0; 1 file passed, 5 config tests passed, 5 socket-based hook tests
  intentionally filtered.
- Environment-only failure reproduced twice: the combined focused command
  including `anthropic_plugin_routing.test.ts` and the unfiltered telemetry
  suite reached 38 passing tests, then both legacy listener hooks failed with
  `listen EPERM: operation not permitted 127.0.0.1`. This managed workspace
  forbids socket binding; no Rhythm ports, api_server, engine, or sandbox were
  started.

## Notes

- GitNexus MCP tools were not available and `.gitnexus/run.cjs` is absent in
  this worktree. Targeted caller search found one runtime caller
  (`server.ts` startup) plus focused tests. A fallback compare-main/status
  scope review found only the five listed R6 files; GitNexus
  `detect_changes()` itself could not be run.
- Unknown plugin entries are never classified by substring or filesystem
  existence alone. A user path outside the reserved `opencode_plugins/<name>`
  marker is preserved unless its realpath equals the active managed plugin.
- No migration, `tool_events` row, database service, scheduler, runner,
  extractor, or session repository was touched. Historical telemetry cleanup
  remains explicitly deferred.
- `git add` could not create
  `/Users/ajhochhalter/Documents/Rhythm/.git/worktrees/r6/index.lock`
  (`Operation not permitted`). The managed environment exposes shared Git
  metadata read-only and does not allow approval escalation, so no commit or
  push was possible; the verified worktree diff remains intact.
