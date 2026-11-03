---
date: 2026-10-21
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, Rhythm]
---

# Live-catalog eligibility for managed and tiered models

## Files

- `apps/api_server/src/services/agent_model_resolver.ts`: the managed `small_model` and tiered background route now consult the live, authenticated, curated, capable and entitled model catalog. The static tier fallback no longer fabricates an unauthenticated provider route. Explicit model overrides still win.
- `apps/api_server/src/services/agent_runner.ts`: supplies the existing run route for a catalog-verified fallback when a task's target tier has no eligible model.
- `apps/api_server/src/services/opencode_plugin_config.ts`, `apps/api_server/src/server.ts`: reconcile the Rhythm-owned `small_model` once after engine initialization; clear a stale key only when a live catalog proves it ineligible, preserve it when catalog authority is transiently unavailable, and reload config only after a change.
- Focused tests: new `apps/api_server/src/__tests__/agent_model_resolver_live_eligibility.test.ts`, plus `apps/api_server/src/__tests__/opencode_plugin_config_managed_defaults.test.ts` and `apps/api_server/src/services/model_routing.test.ts`. The latter explicitly replaces the old expectation that a zero-auth task may choose the first static Anthropic route.

## Checks

- Before implementation, the new resolver contract failed **5/5** on the old authenticated-but-absent small model, phantom Haiku, base-route and empty-catalog behaviors. The stale managed-key test failed **1/11** before its config repair.
- Guarded focused command: `npm run build:guard -- npm --prefix apps/api_server exec vitest run src/__tests__/agent_model_resolver_live_eligibility.test.ts src/__tests__/issue_844_contract.test.ts src/services/model_routing.test.ts src/services/decision/model_catalog.test.ts src/__tests__/opencode_plugin_config_managed_defaults.test.ts src/__tests__/c1_agent_runner_pre_dispatch_enrollment.test.ts` → **6 files, 73 tests passed**. Output: `/private/tmp/rhythm-api-model-eligibility-20261021/focused-tests.log` (0600).
- Guarded typecheck: `npm run build:guard -- ./apps/api_server/node_modules/.bin/tsc --noEmit -p apps/api_server/tsconfig.json` → exit 0. Output: `/private/tmp/rhythm-api-model-eligibility-20261021/tsc.log` (0600). `git diff --check` was clean.

## Notes

- GitNexus upstream impact reported LOW/0 for the resolver symbols, `ensureManagedDefaults`, and server `main`, but its index was 321 commits behind this worktree. Manual scope is **HIGH**: agent task routing and API startup/config. The parent reported that risk before product edits.
- The API candidate has not yet passed the required live API/engine sandbox or signed native C1/title qualification. The prior auto-name failure's exact background-title error remains unknown; this change repairs a proven selection hazard without claiming that failed run's cause. A post-initialize config refresh may race a first UI turn until the live gate establishes timing.
- Source base at the time of these focused checks: `b7d5db0af960`. No model call, native launch, push, PR or commit was performed in this lane.
