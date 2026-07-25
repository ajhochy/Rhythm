---
date: 2026-07-24
repo: Rhythm
branch: codex/1161-1162-profile-fixes
pr: null
issues: [1162]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- `apps/api_server/src/services/opencode_agent_writer.ts` — replaces a permission parent and all deeper-indented children as one subtree.
- `apps/api_server/src/services/__tests__/opencode_agent_writer_projection.test.ts` — map/scalar shape-transition regressions.
- `apps/api_server/src/__tests__/live_e2e_1162_permission_shape_transition.test.ts` — real engine-registry YAML parsing contract.
- `docs/ai/contracts/issue-1162.json` — five-criterion acceptance contract.

## Checks run

- Pre-implementation: focused projection command — 2 expected failures, 28 passes, 1 env-gated live skip.
- Focused projection command after implementation — 30 passed, 1 live skip.
- Writer/profile-sync suite — 108 passed across 7 files.
- `node_modules/.bin/tsc --noEmit` — exit 0.
- `ai-workflow checks --level issue` — exit 0.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4298 DB_PATH=/tmp/rhythm-dev-sandbox-1161-1162/rhythm.db RHYTHM_SANDBOX_HOME=/tmp/rhythm-dev-sandbox-1161-1162/home npx vitest run src/__tests__/live_e2e_1161_cookbook_bound_profile.test.ts src/__tests__/live_e2e_1162_permission_shape_transition.test.ts` — PASS, 2/2 live tests. The real engine registry parsed all permission shape transitions and preserved configured model/options.

## Notes

- GitNexus reports `writeAgentProfileFile` MEDIUM blast radius: 26 total / 14 direct upstream impacts across profile patch and skill-distillation flows. The implementation remains inside its private permission-subtree helpers.
- The branch-built sandbox used API `:4298` and engine `:4297`; the unrelated workflow on `:4098`/`:4097` was not touched.
