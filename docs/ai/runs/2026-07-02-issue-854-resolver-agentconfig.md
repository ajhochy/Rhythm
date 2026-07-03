---
date: 2026-07-02
repo: Rhythm
branch: mega-854-resolver-agentconfig
pr: null
issues: [854]
status: verified
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# fix(agents/#854): resolve per-turn model from agent_configs before static fallback

Branch `mega-854-resolver-agentconfig`, based on `origin/codex/mega-2026-07-02`.
Fixes the confirmed bug blocking the live agent evaluation: custom agent
profiles (e.g. `secretary`) configured with a valid, authed model in
`agent_configs` stalled forever on their first WS turn because
`resolveModelForSessionTurn` never consulted `agent_configs` — only the
static `ROUTE_FALLBACKS_BY_AGENT` table (base kinds only). No PR opened
(explicit instruction — mega-branch fix, folds into #848).

## Files changed

- `apps/api_server/src/services/agent_model_resolver.ts` — new precedence
  step 3 in `resolveModelForSessionTurn`: per-turn override (1) > session pin
  (2) > **`agent_configs` model for `agentId`, auth-verified (3, NEW)** >
  `resolveModelForAgent` static fallback (4). New private helper
  `resolveModelFromAgentConfigs()` + injectable `setAgentConfigsRepositoryForTest()`
  accessor (module-level override, defaults to `new AgentConfigsRepository()`).
  Fail-soft: never throws into the caller.
- `apps/api_server/src/services/__tests__/issue_854_contract.test.ts` (new) —
  8 contract tests.
- `tools/dev/agent_eval_driver.ts` — added `resolveConfiguredModelPin()` +
  `pinSessionModel()`; wired into `runAgentCase`/`runDelegationCase` to PATCH
  each session's model from `agent_configs` right after creation, independent
  of the resolver fix. Guarded `main()` behind `require.main === module` so
  the file is importable by its unit tests without a live run; `--dry-run`
  stays offline.
- `tools/dev/__tests__/agent_eval_driver.test.ts` (new) — 6 unit tests.
- `apps/api_server/vitest.config.ts` — broadened `include` to also pick up
  `../../tools/dev/**/*.test.ts` (the driver lives outside `src/`).
- `docs/ai/contracts/issue-854.json` (new) — 7 criteria, all `pass`.
- `docs/ai/decisions/2026-07-02-resolver-agentconfig-precedence.md` (new) —
  full rationale for the injectable-repo pattern and precedence ordering.

## Checks run

- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit` — clean.
- `npx vitest run agent_model_resolver model_routing usage_budget agent_eval ws_gateway`
  (issue's exact validation command) — 5 files / 54 tests pass.
- Full `npx vitest run` — 213 files / 1825 pass / 1 pre-existing intentional
  skip. No regressions.
- `npm run build` — clean.
- Falsification: removed the new `resolveModelFromAgentConfigs` call from the
  precedence chain — exactly and only `issue-854-c1` (secretary resolves from
  agent_configs) failed; all 7 other contract tests still passed. Reverted;
  8/8 green again.

## Notes

- Decision: chose a module-level injectable accessor
  (`setAgentConfigsRepositoryForTest`) over adding a 5th constructor param to
  `resolveModelForSessionTurn`, to avoid touching its two existing call sites
  (`ws_gateway.ts` ~line 609, `agent_sessions_controller.ts`'s `summarize()`
  ~line 1135). Full rationale in the linked decision file.
- Deviation from the literal file list: broadened
  `apps/api_server/vitest.config.ts`'s `include` glob so the new eval-driver
  test is reachable by the issue's own stated validation command — the
  driver lives in `tools/dev/`, outside the default `src/**/*.test.ts` glob.
- Follow-up (not in scope here): `workflow-orchestrator` and other
  manager-only `agent_configs` rows with no `model_provider`/`model_id` set
  still resolve to `undefined` from the static fallback (verified unchanged
  by contract test c4b). A future issue could backfill sensible model
  defaults for those profiles.
