---
date: 2026-07-02
repo: Rhythm
branch: mega-830-optimizer-cron
pr: null
issues: [830]
status: complete
tags: [run, rhythm]
---

## Files

Added:
- `apps/api_server/src/services/org_optimizer_seed.ts`
- `apps/api_server/src/services/org_proposal_appliers_wiring.ts`
- `apps/api_server/src/services/org_exercised_tools_resolver.ts`
- `.mcp-roles/org-optimizer.mcp.json`
- `.mcp-roles/org-external-discovery.mcp.json`
- `apps/api_server/src/__tests__/issue_830_contract.test.ts`
- `docs/ai/contracts/issue-830.json`

Edited:
- `apps/api_server/src/server.ts` — boot block calls `registerAllProposalAppliers()` then `seedOrgOptimizerTask()`.
- `apps/api_server/src/services/org_proposal_measure.ts` — `defaultExercisedTools` now calls the real resolver.
- `apps/api_server/src/__tests__/obsidian_write_grants.test.ts` — role-file count pin 13 -> 15.
- `.mcp-roles/README.md` — documented the two new roles.

## Checks

- `npx vitest run issue_830_contract` — 9/9 pass.
- `npx vitest run org_optimizer_seed proposal_appliers org_proposal org_audit` — 44/44 pass.
- `./node_modules/.bin/tsc --noEmit` — clean.
- `npm run build` — clean.
- `npx vitest run` (full suite) — 203 files / 1717 tests, all pass (0 regressions).
- Both role files valid JSON; names checked against a live/mocked set.
- Falsification: broke the audit task's name-guard (`existingTasks.some(...)` -> `false`);
  issue-830-c1 failed as expected (duplicate task inserted, `expected 2 to be 1`); reverted.

## Notes

Wired all six generators' `register*Applier` functions into a new
`org_proposal_appliers_wiring.ts` module with real production deps
(curated-MCP install, skill-create, alignment guards, delegation config
repo). Discovered and closed an integration gap beyond the literal issue
text: three proposal kinds (`grant-delegation`/`expand-delegation`,
`webhook-wiring`, `external-adoption`) had no re-validator reachable from a
freshly-wired registry because their built-in validators in
`org_proposal_apply_service.ts` are module-private — without a fix,
`applyProposal` would fail-closed-refuse every one of them. Added three
structural shape-check validators alongside each applier registration.

Closed the #821 "prune-guard stub" by wiring a real `exercisedTools`
resolver derived from `agent_session_messages.parts_json` tool-call parts,
joined via `agent_scheduled_tasks.agent_config_id`. Documented approximation:
only scheduled-task session activity is visible (not ad hoc interactive
sessions under the same `mcp_role` slug) — a safe-direction under-count, not
an over-count, so the functional guard is never made less safe by the gap.

The org optimizer's actual LLM-driven run loop (the seeded prompt's
described behavior: build snapshot -> run generators -> write proposals) is
NOT implemented by this issue — there is no MCP-tool-exposed way yet for the
seeded agent to invoke the audit/generator machinery from its own tool
surface. That orchestration wiring is explicitly out of #830's ownership
scope (seed + applier wiring only) and is flagged as the natural next issue.
