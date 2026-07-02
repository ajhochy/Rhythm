---
date: 2026-07-02
repo: Rhythm
branch: mega-850-optimizer-runloop
pr: null
issues: [850]
status: verified
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# feat(org-optimizer/#850): live run-loop trigger tool (rhythm_run_org_optimizer)

Branch `mega-850-optimizer-runloop`, based on `codex/mega-2026-07-02`. Closes
the "Optimizer live run-loop not built" risk — the seeded org-optimizer agent
now has a tool that actually drives the audit→generate→persist→auto-apply
pass, server-side, in one operation.

## Files changed

- NEW `apps/api_server/src/services/org_optimizer_run_service.ts` —
  `runOrgOptimizer()`: checks the #746 cold-start window first (skip, no
  snapshot built); builds `OrgAuditSnapshot`; runs `scope_hygiene_generator` /
  `recipe_generator` / `webhook_wiring_generator` against it through a
  dedup-aware, capped `AgentOrgProposalsRepository` proxy (stops creating new
  rows once `maxProposalsPerRun`, default 20, is hit → `capped: true`); calls
  `delegation_generator`/`new_agent_generator` with an explicit empty signal
  list (documented no-op — this run loop has no LLM-driven redo/coverage-gap
  detector in scope); skips `external_discovery_generator` entirely (decision
  doc §6: separate, less-frequent schedule, composed outside this module).
  For every proposal created THIS run, auto-applies only if BOTH the row's
  own `risk` field AND a fresh `classifyProposalRisk` call agree `'low'`
  (double gate on top of `org_proposal_apply.applyProposal`'s own independent
  re-check — triple defense-in-depth), then immediately measures anything
  that reached `measuring`. Returns `{ auditRunId, skipped, capped,
  proposalsCreated, byKind, byRisk, byOutcome }`. Never throws.
- `apps/api_server/src/services/skill_extractor.ts` — added
  `isEngineColdStart()` (public alias of the existing private
  `isCuratorThrottled()`) and `_resetEngineReadyForTests()` (test-only reset
  of the module-level `_engineReadyAt` timestamp). No behavior change to the
  existing curator throttle.
- NEW `apps/api_server/src/controllers/org_optimizer_run_controller.ts` + NEW
  `apps/api_server/src/routes/org_optimizer_run_routes.ts` — thin
  `POST /agent-org-optimizer/run` seam (AGENT_LOCAL bypass posture matches
  `org_proposals_routes.ts`). Registered in `app.ts` inside the
  `agentExecutionEnabled` gate, next to `/agent-org-proposals`.
- NEW `apps/mcp_server/src/tools/orgOptimizer.ts` —
  `rhythm_run_org_optimizer` MCP tool, routed at `RHYTHM_AGENT_URL` (:4001,
  local agent server — dual-endpoint rule), calling the new route. Registered
  in `apps/mcp_server/src/index.ts`.
- `.mcp-roles/org-optimizer.mcp.json` — added `rhythm_run_org_optimizer` to
  the role's `mcpServers.rhythm.allowedTools` (the ONE tool this profile can
  call that triggers a write path — documented in the file's own
  `description` field as the deliberate exception to "no direct write tool",
  since the tool itself performs no privileged write; the run loop's own risk
  gates are what's authoritative).
- NEW `apps/api_server/src/__tests__/issue_850_contract.test.ts` (10 tests) +
  NEW `docs/ai/contracts/issue-850.json` — acceptance-contract pass before
  implementation; all 10 confirmed RED pre-implementation, GREEN post.

## Checks run

- `cd apps/api_server && npx vitest run src/__tests__/issue_850_contract.test.ts`
  → 10/10 pass.
- `npx vitest run org_optimizer_run org_audit org_proposal issue_850 issue_830
  issue_831 skill_extractor` → 10 files / 102 passed, 1 skipped (pre-existing).
- `./node_modules/.bin/tsc --noEmit` (api_server) → clean.
- `./node_modules/.bin/tsc --noEmit` (mcp_server) → clean.
- `npm run build` (api_server) → clean. `npm run build` (mcp_server) → clean.
- Full `npx vitest run` (api_server) → 205 files / 1751 tests pass, 1
  intentional skip (up from 204/1741 on the branch tip — net +1 file/+10
  tests as expected).
- `bash tools/release/smoke_org_optimizer.sh` (#831 epic-wide safety guard) →
  exit 0 — auto-path-revert, gate-invariants (all 6 high-risk kinds refused),
  note-required-gate, and fail-injection detection all PASS against this
  change.
- All 15 `.mcp-roles/*.mcp.json` files JSON-valid.
- **Falsification**: temporarily disabled BOTH the run-loop's own risk gate
  (`org_optimizer_run_service.ts`) AND `org_proposal_apply.applyProposal`'s
  independent `classifyProposalRisk` check, then re-ran the c1 high-risk test
  (which drives a REAL `webhook-wiring` gap through 3 seeded sessions, not a
  pre-seeded proposal) — it went RED (`byOutcome":{"autoApplied":2...}`,
  high-risk row no longer `proposed`), proving the test actually catches a
  "high-risk slipped through auto-apply" regression. Both files restored
  byte-identical (diffed clean against a pre-patch backup) before the final
  green run above.
- GitNexus `detect_changes`/`impact` were not runnable against this exact
  worktree (`agent-a181f38342f83618c`) — no matching indexed repo variant for
  this path; the main-checkout and other worktree indices are stale relative
  to this branch's tip. Compensated with tsc + full-suite + build +
  falsification + the #831 epic-wide safety-guard smoke above instead of
  skipping verification.

## Notes

Decisions made:
- `new_agent_generator`/`delegation_generator` are invoked with an empty
  signal list every run rather than skipped outright, so the "all six
  generators considered" documentation discipline (matching
  `org_proposal_appliers_wiring.ts`'s own precedent) holds — this is a
  correct, conservative no-op, not a silent omission. A future issue that
  builds a redo/coverage-gap signal detector plugs in without touching this
  run loop's control flow.
- `external_discovery_generator` is intentionally never called from this run
  loop — decision doc §6 requires its own separate, less-frequent schedule;
  wiring it into every audit-cadence call would violate that throttle. The
  seeded "Org External Discovery" weekly task (#830) is the correct trigger
  point for it, not this tool.
- Added `isEngineColdStart()`/`_resetEngineReadyForTests()` to
  `skill_extractor.ts` rather than duplicating the 90s-window constant and
  timestamp in the new module — single source of truth for the #746
  cold-start signal across both the skill curator and the org optimizer.
- The per-run proposal cap is enforced via a repository-proxy wrapper
  (`makeCappedProposalsRepo` / `makeDedupAwareProposalsRepo`) rather than a
  change to `AgentOrgProposalsRepository` itself, keeping the cap a
  run-loop-local concern the generators are unaware of.

Deviations from spec: none against the issue's ownership boundaries — no
edits to the generators' own logic, `org_proposal_apply*.ts`,
`org_audit_service.ts`, `org_proposal_appliers_wiring.ts`, or
`migrations.ts`.

Concerns / follow-ups:
- `maxLlmCallsPerRun` is accepted on the options interface for API parity
  with the seeded prompt's stated cap but has no enforcement point in v1 (the
  generators invoked here make no LLM calls of their own; recipe refinement's
  scorer calls are naturally bounded by the small capped proposal count).
  Flagged in the module doc comment — a future generator that adds LLM calls
  needs an actual counter threaded through.
- GitNexus impact analysis could not be run against this worktree (see
  above) — recommend re-indexing after this branch merges so future edits to
  `org_optimizer_run_service.ts` get real blast-radius analysis.
- `node_modules` were symlinked from the main checkout (`apps/api_server`,
  `apps/mcp_server`, and repo-root) for local test/build runs; NOT committed.
- No PR opened per the dispatching instructions ("NO PR" — commit + push
  only); branch `mega-850-optimizer-runloop` is left for the maintainer to
  fold into the mega integration branch.
