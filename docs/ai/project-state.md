# Project State

## Current focus

Post-#812 stabilization plus the first org-self-optimizer foundations (epic
#816) and designated obsidian write access. Memory-vault epic #801 is DONE
(all sub-issues #802–#808 shipped inside #812) and closed.

## Active branch / PR

Four open PRs from the 2026-07-02 run awaiting manual review/merge:

- #836 — local Ollama/Qwen provider (opt-in, cloud-first), branch
  `codex/local-ollama-wip-2026-07-01`.
- #837 (draft) — #817 `agent_org_proposals` store + lifecycle state machine,
  branch `issue-817-org-proposals-store`. Server CI green.
- #838 (draft) — #818 `denied_tool_events` deny-path telemetry, branch
  `issue-818-denied-tool-log`. Server CI green.
- #839 (draft) — #834 obsidian write grant for secretary + worship-planning,
  branch `issue-834-obsidian-write-designated`. Server CI green.

Pre-existing: #832 (org-optimizer plan docs), #835 (local MCP sidecar, draft).

- #844 (tokens-04) — tiered model routing (budget-aware resolver policy),
  branch `mega-844-model-routing` (based on `codex/mega-2026-07-02`). No PR
  opened per dispatch instructions — pushed branch only, awaiting mega-branch
  integration.

## In progress

- Nothing executing. All 2026-07-02 tracks are gated, CI-green, and parked in
  draft PRs for human review (except #844, pushed branch-only, no PR).

## Risks / known issues

- **Merge-order conflict:** #837, #838, and #839 each append to
  `docs/ai/project-state.md` on their own branches. Merge in any order and
  resolve project-state.md in favor of THIS snapshot (branch
  `docs/state-2026-07-02-run`); each branch's own `docs/ai/runs/` file does
  not conflict.
- #838 logs `agent_config_id` as null from the bridge seam; org-optimizer-03
  must join `session_id → agent_sessions` for the per-profile dimension.
- #839 mirrors librarian's grant, which includes `obsidian_delete_file` +
  `obsidian_execute_command` — reviewer flag in the PR body; trim if unwanted.
- `agent_profile_sync*.test.ts` can time out under full parallel vitest load;
  green in isolation (pre-existing flake).
- 12 npm dependency audit findings (1 low, 8 moderate, 3 high) still open.
- Open hygiene issues: #768 (remove cowork MCP), #814 (pin rhythm MCP server
  version).

## Test status

Per-branch verification gates all PASS (2026-07-02):

- #817 @ 836e303ef: tsc + prod build + full vitest 178 files/1539 tests;
  falsification real; Server CI run 28602245964 exit 0.
- #818 @ 4e49efc72: tsc + prod build + full vitest 179 files/1530 tests;
  `mcp_dispatch_guard.ts` byte-identical (guard purity preserved); Server CI
  run 28602454039 exit 0.
- #834 @ 055dd15da: 13/13 role files valid JSON; tsc + prod build + full
  vitest 178 files/1523 tests; alignment/guard suites 77 tests; Server CI run
  28602742779 green.
- mem-vault-01 re-verification on origin/main: 23/23 targeted memory tests,
  tsc clean, falsification confirmed load-bearing.
- #844 @ (branch `mega-844-model-routing`): tsc clean; full vitest 186
  files/1585 tests green (0 regressions vs the mega base); targeted contract
  suite (issue_844_contract + agent_model_resolver + usage_budget_service +
  model_routing) 22/22; falsification of the override-precedence branch
  (issue-844-c4) confirmed load-bearing (temporarily disabling the
  modelOverride bypass in resolveTieredModel made the test fail as expected,
  then reverted).

## Next step

1. Human review + manual merge of #836–#839 (resolve project-state.md in
   favor of this snapshot), then manual smoke per checklist.
2. Next epic #816 issue: org-optimizer-03 (read-only org audit + signal
   collector, #819) — now unblocked by #817 + #818. #820 (risk predicate) and
   #821 (auto-apply) follow, implementing the locked full-autonomy-with-
   rollback policy (see decisions/2026-07-02-autonomy-and-vault-intent.md).

## Recent coding-agent runs

### 2026-07-02 — #820 + #821 (org-optimizer-04/05: risk predicate + auto-apply)

- Files modified:
  - `apps/api_server/src/services/org_risk_classifier.ts` (new) — #820:
    `classifyProposalRisk(proposal): 'low' | 'high'`, the single
    source-of-truth predicate; `requiresSecurityNote(kind)` helper. Pure
    function, fail-closed default, change-shape override (a mislabeled
    proposal whose `changeJson` performs a hard-ruled privileged mutation is
    escalated to high regardless of stated `kind`).
  - `apps/api_server/src/services/org_proposal_apply.ts` (new) — #821:
    `applyProposal` (snapshot -> mutate -> `measuring`, re-validates risk
    itself, refuses high-risk), `revertProposal` (replays
    `before_snapshot_json`, sets `reverted`, row retained for dedup).
  - `apps/api_server/src/services/org_proposal_measure.ts` (new) — #821:
    `measureProposal` — mechanical keep/revert for tighten-scope/prune-scope
    (hygiene + functional guard: never keep a prune that removed an
    actually-exercised tool/server) and LLM-scored keep/revert for
    refine-skill/consolidate-skill/refine-recipe (reuses
    `skill_refiner.scoreSkillBody`, strict `post > baseline`, ties revert).
  - `apps/api_server/src/__tests__/org_risk_classifier.test.ts` (new) — 11
    contract tests for #820.
  - `apps/api_server/src/__tests__/org_proposal_apply.test.ts` (new) — 9
    contract tests for #821 (covers both apply and measure).
  - `docs/ai/contracts/issue-820.json`, `docs/ai/contracts/issue-821.json`
    (new).
- Checks run:
  - `npx vitest run org_risk_classifier` — 11/11 pass.
  - `npx vitest run org_proposal_apply` — 9/9 pass.
  - `npx vitest run org_risk org_proposal agent_org_proposals` — 39/39 pass.
  - `./node_modules/.bin/tsc --noEmit` — clean, 0 errors.
  - `npx vitest run` (full suite) — 184 files / 1583 tests, all pass.
  - Falsification: #820 — flipped the fail-closed default from `'high'` to
    `'low'`; issue-820-c3 failed as expected, restored. #821 — disabled the
    functional guard (`removed.some(...)` short-circuited to `false`);
    issue-821-c3b and issue-821-c4 failed as expected, restored.
- Decisions made: only one apply-target kind is wired in v1 —
  `agent_configs.allowedMcpsJson` / `allowedSkillsJson` scope mutations
  (covers tighten-scope/prune-scope, the two mechanical low-risk kinds with a
  concrete live-system field to snapshot/mutate/restore).
  `refine-skill`/`consolidate-skill`/`refine-recipe` proposals carry their
  own prior/revised body pair in `changeJson` and are measured by the LLM
  scorer, but this v1 does not wire them to a live SKILL.md/recipe write —
  that integration is left for whichever future issue actually generates
  those proposal kinds (org-optimizer-06+). `exercisedTools` (the functional
  guard's telemetry source) is a stubbed default (empty set) pending a real
  join against `denied_tool_events` / tool-use telemetry — real wiring is a
  follow-up, not blocking #821's acceptance criteria (which only require the
  guard to be injectable and correctly gate keep/revert).
- Deviations from spec: none from the two issues' acceptance criteria as
  written. Both issue bodies' "Policy update (2026-07-02)" sections
  (full-autonomy-with-rollback) were already reflected in the #817 state
  machine and repository this branch is based on; no additional policy code
  was needed beyond the predicate + apply/measure logic itself.
- Concerns: `measureScopeChange`'s `exercisedTools` default returning an
  always-empty set means an UNWIRED real deployment would currently treat
  every prune as passing the functional guard — safe in the sense that it
  never falsely blocks a good prune, but it means the guard provides no real
  protection until a real telemetry source is wired in. This should be
  called out explicitly before org-optimizer-03's audit/signal-collector
  starts generating real prune-scope proposals in production.

### 2026-07-02 — #822 (org-optimizer-06: scope-hygiene generator)

- Files modified:
  - `apps/api_server/src/services/generators/scope_hygiene_generator.ts`
    (new) — `generateScopeHygieneProposals(snapshot, deps)`. Consumes ONLY
    `OrgAuditSnapshot.gaps` (kind='prune-scope'|'tighten-scope', parsed from
    their documented evidence-string formats) and
    `OrgAuditSnapshot.skillOverlapCandidates` (already filtered by
    `org_audit_service.ts`'s own 0.5 Jaccard threshold, not re-filtered
    here) — never re-derives its own "unused tool" candidates from
    `profiles`/`drift` directly, so it can never disagree with the audit
    service's own exercised/live computation. Produces `change_json` shaped
    exactly as `org_proposal_apply.ts`'s `AgentConfigScopeChange`
    (`{agentConfigId, field, remove}`) for tighten/prune, and
    `{skillIdA, skillIdB, titleA, titleB, similarity}` for consolidate-skill
    (order-independent dedup key over the sorted id pair). Every candidate
    is risk-classified via the real `classifyProposalRisk`, with one hard
    override: a prune-scope gap flagged user-authored by the injectable
    `isUserAuthoredScopeEntry` predicate (default: always false — the
    snapshot carries no per-name authorship bit) is escalated to
    `risk='high'` regardless of what the predicate says, so a user-set
    scope entry (#785 overlay) is never silently auto-pruned through the
    low-risk auto-apply lane. Dedup-checks `existsByDedupKeyAsync` before
    every `createAsync`. Never throws — a malformed gap evidence string is
    logged and skipped, not fatal to the run.
  - `apps/api_server/src/__tests__/scope_hygiene_generator.test.ts` (new) —
    7 contract tests for #822.
  - `docs/ai/contracts/issue-822.json` (new).
- Checks run:
  - `npx vitest run scope_hygiene_generator` — 7/7 pass.
  - `npx vitest run scope_hygiene org_audit agent_org_proposals` — 35/35
    pass.
  - `./node_modules/.bin/tsc --noEmit` — clean, 0 errors.
  - `npx vitest run` (full suite) — 197 files / 1663 tests, all pass (0
    regressions vs the mega base).
  - Falsification: temporarily changed
    `const risk = userAuthored ? 'high' : computedRisk;` to
    `const risk = computedRisk;` (disabling the user-authored escalation).
    issue-822-c5 failed as expected (`expected 'low' not to be 'low'`);
    reverted, 7/7 green again.
- Decisions made: apply-side wiring for all three kinds this generator
  emits already exists and needs no new registration —
  `org_proposal_apply.ts`'s `applyAgentConfigScopeChange` already consumes
  this generator's exact tighten/prune `change_json` shape, and
  `org_proposal_measure.ts`'s `measureScopeChange` already measures them.
  No `registerProposalApplier`/`registerProposalValidator` (#826 seam)
  registration was added or needed — these three kinds are `risk='low'`
  (except an escalated user-authored prune) and flow through the direct
  `proposed -> applied` auto-apply lane, not the human-gate queue's
  registered-applier path.
- Deviations from spec: none from the issue's acceptance criteria as
  written.
- Concerns / flagged for #830/#831 wiring round: this generator's
  `consolidate-skill` payload does NOT include `priorBody`/`revisedBody` —
  drafting an actual merged skill body is a separate, not-yet-built LLM
  step (this generator only detects and proposes the *pairing*). As a
  result, `org_proposal_measure.ts`'s `measureBodyRefinement` will see
  `isBodyRefinementChange() === false` for these rows and resolve to
  `'skipped'` (parked in `measuring`, never guessed keep/revert) until a
  future issue wires a body-drafting step ahead of measurement. This is
  intentional and out of #822's scope (proposal generation only) but should
  be closed before consolidate-skill proposals are expected to actually
  reach `active`/`reverted` in practice.
