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

### 2026-07-02 — #829 (org-optimizer-13: webhook-wiring generator, gated, fenced)

- Files modified:
  - `apps/api_server/src/services/generators/webhook_wiring_generator.ts`
    (new) — turns `org_audit_service`'s `webhook-wiring` gaps into
    `agent_org_proposals` rows (`generateWebhookWiringProposals`, idempotent
    via `dedup_key = gap.gapId`), always `risk: 'high'`, with a
    `provenanceJson` security note (triggerSource/targetScope/
    hmacSecretSetup/ssrfAllowlistConstraints — satisfies
    `hasSecurityNote`/`requiresSecurityNote`) and a `changeJson` payload
    naming a wiring target + a fenced `targetPromptTemplate`. Also exports
    `fenceInboundPayload(content, sourceHint?)` — a byte-identical mirror of
    `apps/mcp_server/src/untrusted_context.ts`'s `untrustedContext()` fence
    contract (same delimiters + directive), needed because `apps/api_server`
    cannot import across the `apps/mcp_server` package boundary (separate
    `tsconfig.json` rootDir). And `registerWebhookWiringApplier(registry)` —
    the seam org-optimizer's #830 wiring issue calls once at startup to
    register `applyWebhookWiring` (the approval-only apply step) onto
    `org_proposal_apply_service.ts`'s existing `registerProposalApplier`
    plugin registry, per that file's documented extension point. The applier
    creates the `agent_webhook_endpoints` row EXCLUSIVELY via
    `AgentWebhookEndpointsRepository.createAsync` (same path `POST
    /agent-webhooks` uses) — never a hand-rolled INSERT — so the HMAC-SHA256
    secret `agentWebhookController.receive()` verifies against is generated
    identically for optimizer-proposed and manually-created endpoints.
  - `apps/api_server/src/__tests__/issue_829_contract.test.ts` (new) — 12
    contract tests, one per acceptance criterion (5 criteria, several with
    multiple angles): gap→proposal (c1, incl. dedup-idempotency and ignoring
    non-webhook-wiring gaps), security-note content + queue-gate
    compatibility (c2), never-auto-applied (c3, both via
    `classifyProposalRisk` and via asserting the generator itself never
    calls `createAsync`), approval routes through the existing HMAC/SSRF
    create path with `createAsync` mocked + fails closed on a missing target
    (c4), and the fence contract itself plus its presence in the generated
    prompt template (c5).
  - `docs/ai/contracts/issue-829.json` (new) — machine-readable contract,
    5/5 criteria mapped to tests, `not_tested: []`.
- Checks run:
  - `npx vitest run src/__tests__/issue_829_contract.test.ts` — 12/12 pass
    (confirmed failing with "Cannot find module" for all 10
    generator-dependent tests before the generator file existed).
  - `./node_modules/.bin/tsc --noEmit` — clean, 0 errors.
  - `npx vitest run` (full suite) — 197 files / 1668 tests pass. One
    unrelated flake (`scoped_by_default.test.ts`, an ephemeral-port `fetch`
    HTTP-parse error under parallel load) reproduced once, then passed clean
    in isolation — pre-existing flake class, not caused by this change (see
    the already-documented `agent_profile_sync*.test.ts` flake note above).
  - Falsification: dropped the fence call in `buildTargetPromptTemplate`
    (inlined `Payload: {{payload}}` with no delimiters) — issue-829-c5's
    "template routes payload through the fence" assertion failed exactly as
    expected (`expected '...' to contain '<<<UNTRUSTED_EXTERNAL_CONTENT>>>'`
    with the actual unfenced string surfaced in the diff); restored and
    re-verified 12/12 green.
- Decisions made: `fenceInboundPayload` is a local mirror of
  `untrustedContext()` rather than a cross-package import, because
  `apps/api_server` and `apps/mcp_server` are separate TypeScript projects
  (each with its own `tsconfig.json` `rootDir: src`) with zero existing
  cross-imports between them — introducing one would be a new architectural
  seam outside this issue's ownership boundary (dispatch instructions
  restricted me to the one new generator file). The mirror is called out
  explicitly in the module doc as a "keep in sync manually" contract rather
  than silently duplicated code. `registerWebhookWiringApplier` takes an
  explicit `{ registerProposalApplier }` registry parameter (not a direct
  import-and-call against `org_proposal_apply_service.ts`) per the dispatch
  instructions' ownership boundary — #830 (the review-queue wiring issue) is
  expected to call it once at startup; nothing calls it yet, so the applier
  is inert (registered nowhere) until #830 lands, matching "never
  auto-applied" for the current state of main.
- Deviations from spec: none. All 5 acceptance criteria have a mapped,
  passing, falsification-verified contract test.
- Concerns: the generator does not yet know a concrete
  `targetScheduledTaskId`/`targetRecipeId` at proposal time (the audit gap
  only carries a recurring task-title pattern, not a bound scheduled task or
  recipe) — `buildWebhookWiringProposalInput` currently defaults
  `targetScheduledTaskId` to the pattern title itself as a placeholder
  target so the apply-time validator (`validateWebhookWiring`, already
  registered in `org_proposal_apply_service.ts`) has something to check
  against. A human reviewer must confirm/replace this with a real scheduled
  task id via the review-queue UI (org-optimizer-11) before approving in
  practice; the contract tests exercise both the "has a target" happy path
  and the "missing target rejects" fail-closed path, but do not model the
  review-queue's edit-before-approve UX itself (out of scope, not yet
  built). `registerWebhookWiringApplier` is unregistered dead code until
  #830 wires it in — flagged so #830's implementer knows to call it.
