---
date: 2026-09-07
index: "[[Rhythm]]"
repo: Rhythm
branch: feature/org-reviewer
pr: 1492
issues: []
status: draft_pr/manual_smoke_pending
tags: [run, rhythm]
---

# Org Reviewer replacement

Automated verification passed on 2026-09-08. Draft PR [#1492](https://github.com/ajhochy/Rhythm/pull/1492) is open and contract c11 passed. AJ's manual smoke remains pending; GitHub CI results are tracked on the PR. No merge, deployment, main edits, or direct live database access occurred.

## Files

- `apps/api_server/src/controllers/org_reviewer_controller.ts`, `routes/org_proposals_routes.ts`, and `services/org_reviewer_service.ts`: signed, owner-scoped context reads and closed proposal submission using existing validation, risk, security-note, serialization, and repository deduplication helpers. Submission creates proposed records only.
- `apps/mcp_server/src/tools/orgReviewer.ts`, registration, and security role-graph coverage: exactly `rhythm_read_org_review_context` and `rhythm_submit_org_review_proposal`, with untrusted-content scanning/fencing and explicit repair/proof schemas.
- `apps/api_server/config_seeds/skills/review-agent-org-health/SKILL.md`, `services/org_reviewer_seed.ts`, and legacy optimizer/discovery startup paths: one owned skill/profile and Monday 08:30 America/Los_Angeles schedule; competing generators retired without removing the human queue lifecycle.
- `services/agent_runner.ts`, `services/opencode_agent_writer.ts`, and `services/auto_promotion_gate.ts`: exact reviewer identity, default permission mode, enforced native delegation denial, and exclusion from automatic proposal promotion. Ordinary profiles retain their existing behavior.
- API reviewer route/service/isolation tests, real signed MCP and real-model semantic suites, MCP tool/security tests, and existing regression expectations cover the new path and retirement behavior.
- [Decision](../decisions/2026-09-07-org-reviewer.md), [acceptance contract](../contracts/org-reviewer.json), [project state](../project-state.md), and [manual smoke checklist](../../testing/org-reviewer-manual-smoke.md).

## Checks

All final source checks below exited 0. Normal-suite skipped tests are not used as live behavioral evidence.

| Check | Final command / evidence | Result |
| --- | --- | --- |
| API full suite | From `apps/api_server`: `npx vitest run --fileParallelism=false` | 6,102 passed, 245 skipped; 654 files passed, 125 skipped; 439.26 s; start 2026-09-08 10:22:05 PDT |
| API typecheck/build | From `apps/api_server`: `npx --no-install tsc --noEmit`; `npm run build --silent` | Both exit 0 |
| MCP full suite | From `apps/mcp_server`: `npm test -- --run` | 188 passed, 2 skipped; 32 files passed, 2 skipped; 3.98 s; start 2026-09-08 10:22:18 PDT |
| MCP typecheck/build | From `apps/mcp_server`: `npx --no-install tsc --noEmit`; `npm run build --silent` | Both exit 0 |
| Complete live acceptance | `bash /private/tmp/run-org-reviewer-live.sh src/__tests__/org_reviewer_live.test.ts src/__tests__/org_reviewer_semantic_live.test.ts --fileParallelism=false` | 14/14 passed, 2 files, 206.73 s; start 2026-09-08 10:18:41 PDT |
| Existing optimizer safety guards | `bash tools/release/smoke_org_optimizer.sh` | All safety guard checks passed; initial IPC EPERM resolved by authorized rerun |
| Repository issue gate | `ai-workflow checks --level issue` | Exit 0 after authorized Flutter SDK-cache access; Flutter analysis/format and API/MCP typechecks passed |
| Remaining PR stages | Existing full PR-gate Flutter, fork, and mobile stages | Passed; no source changes in these areas afterward |

- The live launcher used only `tools/dev/sandbox.sh`, isolated API 4098/engine 4097, a synthetic read-only fixture, and temporary HOME/DB. Each run checked API health, engine health, actual MCP routing for both API destinations, and the checkout's built MCP entrypoint before fixture mutations. Engine build: `0.0.0-feature/org-reviewer-202609080048`.
- The real scheduled `openai/gpt-5.6-sol` reviewer produced one concrete proposal from duplicate failure sessions, suppressed fixed/injection findings, inspected actual dispatch overrides, and retained evidence, current proof, exact repair, rollback, and observable verification.
- Signed live checks also proved ownership, closed fields, core `search` rejection as an MCP grant, deduplication, stale-proof refusal, weekly retirement, exact scheduled skill scope, a successful scheduled context read, and separate denials for unrelated MCP mutation, shell approval, and delegation. Forbidden actions left target and proposal state unchanged.
- Existing human lifecycle baseline: `npx vitest run src/__tests__/org_proposals_routes.test.ts src/__tests__/org_proposal_apply.test.ts` passed 138/138 before implementation; these tests are included in the final passing API suite. The live human rejection path also passed.
- Auto-promotion regression: authorized `npx vitest run src/services/__tests__/auto_promotion_gate.test.ts src/services/__tests__/auto_promotion_all_kinds.integration.test.ts` passed 36/36. Verified outcomes and enabled global trust do not auto-apply reviewer proposals.
- Final API lint command exited 0, but remains the existing TODO placeholder rather than additional lint coverage. Final gate logs are retained in `/private/tmp/org-reviewer-gate-api-latest.log`, `/private/tmp/org-reviewer-gate-mcp-latest.log`, and `/private/tmp/org-reviewer-gate-report.md`.

## Notes

### Workflow and scope evidence

- Base: `origin/main` at `0bc46a5e`; clean checkout before creating `feature/org-reviewer`. Existing proposal helpers were inspected before product edits. The mandatory workflow used acceptance-contract, coding-agent, verification-gate, failure-triage, smoke-test-writer, and project-state-updater.
- Initial route RED: `npx vitest run src/__tests__/org_reviewer_routes.test.ts` executed after loopback access was authorized: 2/2 failed with 404 instead of 401/403, before product implementation. The real sandbox c12 baseline independently failed on the same missing seam. Restricted `listen EPERM` attempts were infrastructure failures, not product RED evidence.
- GitNexus upstream impact was LOW for seed/registration/projection/retirement helpers, with dynamic startup callers also inspected manually. Shared AgentRunner `_runOnce` and `run` impact was HIGH; the user was warned before the reviewer-only identity/permission changes.
- `node .gitnexus/run.cjs detect-changes --scope staged --repo Rhythm --limit 30` and `--scope compare --base-ref main` exited 0: 42 files, 16 indexed symbols, zero indexed affected processes, LOW reported change risk. New reviewer symbols are absent from the index; manual review and real behavioral checks supply their scope evidence. This does not supersede the HIGH AgentRunner warning.

### Repair-loop findings

- Service regressions caught evidence-age, truncated-context, diagnostic-recursion, ordinary scheduled-evidence, closed repair, and existing-queue deduplication problems. Fixes retained the real repositories and validation registry; final service coverage passed, including normalized root-cause deduplication across repair wording.
- Early live infrastructure attempts exposed a relative restart path and an MCP fixture destination still pointing to live port 4001. The attempted synthetic read returned 404 and made no mutation. The launcher was corrected and the harness now checks both actual MCP URLs before setup; product routing defaults were not changed.
- Scheduled readiness completed as `completed_no_op`, as the scheduler's mutation classifier specifies. The harness now accepts that terminal state while retaining actual queue/proof assertions. Exact skill-scope checks use the real scheduled session; interactive direct-SDK fixtures bypass the ordinary WS scope synchronization.
- Adding a positive scheduled read exposed AgentRunner's unconditional persisted `bypassPermissions` and identity mismatch. The product fix restricts default mode and the projected identity to the reviewer; ordinary-agent regressions passed.
- The deterministic schedule fixture omitted `agentKind`, so the API defaulted it to the profile ID. It now explicitly uses `opencode`, matching the seed and semantic schedule. Denial checks now inspect each forbidden action's actual `unavailable tool` error rather than searching a whole transcript. Authorization and unchanged queue/target assertions were preserved.
- The first real-model attempt was explicitly unverified until AJ authorized the existing OpenAI credential for the isolated sandbox. Only that provider entry was copied with restrictive permissions; values were never printed. No scripted completion was accepted as semantic evidence.
- Semantic fixture setup initially used an unnecessary model PATCH, then read the session-detail envelope incorrectly. It now polls the endpoint's `session` object and asserts the real engine-recorded session/profile/provider/model without writing fabricated state or weakening provider authorization.
- The first completed real-model review passed 2 criteria and failed 2: the tool description omitted accepted proof-source labels, and the model supplied a trailing newline where the server requires exact leaf text. The interface now exposes source enums and exact leaf/hash guidance, and supports a nullable overview selector. Evidence validation stayed strict. The final complete real-model and signed suites passed 14/14.
- Restricted IPC/listener/Flutter-cache checks were rerun with the necessary authorization. No follow-up issue was opened; all in-scope failures were repaired and reverified.
- Workflow retrospective: `.agent-stack/postmortems/2026-09-08-retro-org-reviewer.json`; root owns the final retrospective and PR description.

### Handoff and cleanup

- Sandbox cleanup command: `source /private/tmp/org-reviewer-sandbox.env; tools/dev/sandbox.sh status; tools/dev/sandbox.sh down` exited 0, reported no sandbox listeners, and removed the temporary sandbox. The copied OpenAI credential is absent; the original credential was unchanged.
- Human smoke remains pending in [the manual checklist](../../testing/org-reviewer-manual-smoke.md). Ordinary desktop launch uses the live API port and is not the isolated sandbox test.
- Draft PR [#1492](https://github.com/ajhochy/Rhythm/pull/1492) verified at creation with `gh pr view`: `isDraft=true`, `baseRefName=main`, `headRefName=feature/org-reviewer`, `headRefOid=2c1eaa9c6720e666eaa22250d89931f1de9b8565`. Contract c11 passed. Remote CI was running at PR creation; subsequent results are available on the PR. Merge and deployment remain outside this task.
