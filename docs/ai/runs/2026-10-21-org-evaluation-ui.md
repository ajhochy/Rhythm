---
date: 2026-10-21
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: unverified
tags: [run, rhythm]
---

# Pre-review evaluation UI slice

## Files

- `apps/web/src/gateway/org-proposals.ts`: settings, activity, detail, evaluated proposal proof and exact-version approval contract.
- `apps/web/src/components/ToolWorkspace.tsx`, `ToolWorkspace.css`, `tools/OrgEvaluationPanel.tsx`: live Review Queue evaluation settings/activity/detail and fail-closed approval controls.
- `apps/web/tests/org-evaluation-rendered.spec.ts`, `org-evaluation-rendered-playwright.config.ts`, `gateway/org-evaluation-gateway.spec.ts`: focused rendered and gateway contracts.
- `apps/web/tests/packaged/packaged-ai-private-org-evaluation.spec.ts`: private signed-bundle contract, not yet executed.
- `apps/web/tests/packaged/packaged-ai-private-org-evaluation-journey.spec.ts`: gated full packaged UI/API/engine journey with owned synthetic sessions, model loan, exact-version approval, post-approval engine use, and strict owned cleanup. Registered, not executed.
- `apps/api_server/src/services/org_evaluation_recipe_schedule_effects.ts`: copied-worker recipe selection, production scheduler due-task selection, and real loopback HMAC receiver, each requiring a worker engine callback before effect receipts can qualify. Additive compiler and scheduler test seams preserve the ordinary paths.
- `apps/api_server/src/database/{migrations,postgres_bootstrap}.ts`, webhook endpoint/trigger repositories, webhook controller and wiring applier: additive recipe-target webhook storage and dispatch. A signed inbound event selects the stored legacy recipe, compiles its production prompt, preserves the bound profile and fences external payload bytes in the pending trigger.
- `org_evaluation_tool_inputs.ts`, `org_evaluation_tool_receiver.ts`, and the candidate-only `org_evaluation_mcp_fixture.ts` tool: approved pinned tarball inventory, verified tool evidence and alternative normalization, and a loopback receiver whose executable invocation stays inside disposable Docker.

## Checks

- RED: `./node_modules/.bin/playwright test -c tests/org-evaluation-rendered-playwright.config.ts` — after fixing the harness's missing local Chrome channel and production API base, 3/3 failed on absent Evaluation settings/activity controls. The first attempt stopped before assertions because the configured Playwright headless binary was absent.
- GREEN: same focused rendered command — 4/4 passed using route-backed UI fixtures. This verifies the rendered live component contract, not backend or model execution.
- `./node_modules/.bin/playwright test tests/gateway/org-evaluation-gateway.spec.ts tests/gateway/self-improvement-gateways.spec.ts --workers=1` — 6/6 passed, including legacy tool-install approval body.
- `npm run typecheck` in `apps/web` — passed.
- `npx playwright test -c tests/packaged/packaged-playwright.config.ts tests/packaged/packaged-ai-private-org-evaluation-journey.spec.ts --list` in `apps/web` — one gated live journey registered; it was not run.
- `npx vitest run src/__tests__/agent_cookbook.test.ts src/services/__tests__/org_evaluation_recipe_schedule_effects.test.ts` in `apps/api_server` — 12/12 passed. Engine dispatch is injected in the new source tests; this is not live engine proof.
- The effect adapter covers bound and default-agent legacy recipes, scheduled trigger selection, and signed task/recipe webhook receipt selection. These source tests inject an engine callback and do not prove a real engine run.
- Recipe-target webhook contract was first RED (2/2 failures: no recipe identity; mixed targets reached an unrelated FK error). After the repair, its 4/4 real HTTP/SQLite tests passed: valid/invalid HMAC, recipe prompt/profile, cross-owner denial and existing-row nullable backfill. Existing webhook/contracts and private effect helper passed 28/28 before the added owner/backfill checks. `npx tsc --noEmit -p tsconfig.json` passed afterward.
- Final focused webhook matrix: `npx vitest run src/__tests__/org_evaluation_webhook_recipe.test.ts src/__tests__/issue_1491_webhook_contract.test.ts src/__tests__/issue_829_contract.test.ts src/services/__tests__/org_evaluation_recipe_schedule_effects.test.ts` — 30/30 passed. API `npx tsc --noEmit -p tsconfig.json` and `git diff --check` passed.
- Tool-input and routed-effect source tests: `npx vitest run src/services/__tests__/org_evaluation_tool_inputs.test.ts src/services/__tests__/org_evaluation_external_effects.test.ts src/services/__tests__/org_evaluation_recipe_schedule_effects.test.ts` — 12/12 passed. The routed helper now returns the actual selected child output/session for scoring; the scheduler restores copied semantic fields after a real tick.
- Real confined tool test: `RHYTHM_EVAL_TOOL_DOCKER=1 npx vitest run src/services/__tests__/org_evaluation_tool_receiver.live.test.ts` — initially failed twice with HTTP 503. Isolated Docker output showed the synthetic CLI could not execute from Docker's temporary mount; invoking that same installed JavaScript CLI through `node` inside the container repaired it. Final 1/1 passed (19 seconds after adding parent safety vetting): exact profile/evidence bundle returned Docker `observed`/`safe`; candidate-only MCP catalog/call ran the pinned CLI inside networkless Docker; unauthorized/duplicate calls and read-only artifact write were denied; owned containers were removed. API `npx tsc --noEmit -p tsconfig.json` passed. This test does not run the private OpenCode engine.

## Notes

- GitNexus impact attempts for `LiveReviewTool`, `createLiveOrgProposalsGateway` and gateway `normalize` returned LOW/0 in the original indexed checkout; the sibling worktree was 324 commits ahead, so the index result is stale. Manual integration risk remains medium across the queue and gateway.
- No app, backend sandbox, evaluator, model, signed bundle or packaged Playwright test was run for this UI slice. The exact API implementation and real evaluation receipts remain the integration boundary.
- A default Playwright config invocation for a gateway source test indirectly launched an unguarded web build. That was an error; subsequent source checks used the focused config or `--list`, and the root agent was notified. No package was produced by that invocation.
- GitNexus impact for the added Cookbook compiler and scheduler tick seams was attempted against the original index: the controller symbol was absent (UNKNOWN) and the scheduler reported LOW/0 despite current timer callers. The index is 324 commits stale. Manual blast radius includes Cookbook run HTTP/UI and scheduler tick/trigger dispatch; default production paths were retained and focused tests passed.
- The webhook worker receiver needs a third exact loopback port in its sandbox policy; the runtime agent is wiring `RHYTHM_EVALUATION_WEBHOOK_PORT`. No real sandbox webhook dispatch was claimed from the source tests.
- The repaired HTTP path now queues a recipe target, but no live private engine dispatch or Postgres migration has been exercised yet.
- The tool receiver test is a gated automated Docker integration check, not the final manual packaged smoke. Its first failures came from this new synthetic archive/execution path, not a previously verified contract. The runtime agent is wiring the parent Docker receipt and engine MCP dispatch correlation; no tool-install proposal qualification has yet been observed.
