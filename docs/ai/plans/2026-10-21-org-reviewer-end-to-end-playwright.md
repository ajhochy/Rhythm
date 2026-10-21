---
date: 2026-10-21
repo: rhythm
status: designed-not-executed
tags: [plan, rhythm, playwright, org-reviewer, skills]
---

# Org improvement: complete user-journey test design

User request: test the organization optimizer from initial scan and suggestions through accepting improvements, using/testing skills, approval, application and revision. Explain the workflow rather than assume the user knows it. This supplements the current AI repairs/local rebuild; it does not replace them.

## Plain-language workflow

1. **Review recent work.** The current feature is Org Reviewer. It reads recent owned conversations, groups recurring problems, and checks whether the problem still exists in the current agent or skill.
2. **Suggest a concrete repair.** A valid finding becomes a proposal with evidence, a current-state proof, the exact proposed change, risk, rollback and a verification plan. Creating a proposal must leave the working agent/skill unchanged.
3. **A person decides.** Approval is the action that starts applying the proposal. Rejection leaves the target unchanged. The reviewer cannot approve its own work.
4. **Observe the actual change.** A successful request or toast does not prove deployment. The target, managed file and engine projection must agree with the approved revision.
5. **Use and assess it.** A real subsequent agent run must use the changed skill. Deployment state and measured outcome are separate: “applied” can coexist with “not measured” or “inconclusive.”
6. **Keep, revise or undo.** A regression must not be called an improvement. Reversion restores the exact approved preimage without overwriting newer human work. Another proposed revision needs fresh evidence/current-state proof and its own human decision.

## Current implementation boundaries

Source audit at the 825c-era mega worktree; these are source-backed expectations, not a newly passing end-to-end run.

The actual scan entry is **Agent Schedules → Org Reviewer → Trigger now** (`schedule-trigger`), followed by its linked run/root session. There is no separate Run Scan button. Fixture startup must prove the expected reviewer seed exists and the selected task/profile/root bindings agree; no fabricated run can substitute for this entry.

- The old optimizer execution tools/routes are retired. `POST /agent-org-optimizer/run` returns410; the current path is the least-privilege Org Reviewer, its normal schedule/manual trigger, signed review tools, and existing human queue. Do not revive legacy generators to manufacture a green scan.
- Reviewer accepts four refinement kinds: `refine-config`, `refine-scope`, `refine-skill`, `refine-task`. A skill refinement changes an **existing** skill. New-skill creation, external installation and executable-test generation are not current reviewer capabilities. `verificationPlan` is stored text.
- The current React Review Queue exposes Approve, Reject and active Revert, filters, deployment and outcome summaries. It has no queue-card revise/test/experiment declaration control. The current Skills inspector exposes content/metadata and managed editing; those controls alone do not prove the optimization loop.
- `POST /agent-org-proposals/:id/experiment` is a separate operator experiment seam. If its required declaration/testing flow is absent from the app, an API-only declaration may qualify that backend seam but cannot qualify the complete user experience.
- Flutter has a separate proposal UI. Playwright against the locally packaged Electron/React app qualifies that app only; shipping Flutter UI acceptance remains a separate surface.
- The broad existing inventory marker `self-improvement-proposals-promotion` remains incomplete. This design adds concrete subcontracts; it does not remove that marker or count the design as coverage.

## Existing evidence triage

| Evidence | Verdict and exact limit |
|---|---|
| `org_reviewer_semantic_live.test.ts` | KEEP: real-model scan/diagnosis/proposal semantic contract. An older 2026-09 run reported14/14 combined live checks. It ends at proposed and rejects during cleanup; it does not prove current packaged apply/use/retest/revert. Refresh on the final current source/model. |
| `org_reviewer_live.test.ts` | KEEP: real API/engine/signed-MCP boundary with scripted provider. C7's name mentions approval/reversion but its body tests rejection200 and invalid revert409. Do not report successful apply/revert from that title. |
| Reviewer service, proposal routes/applier/measurement tests | KEEP as source/repository contracts. They cannot establish that the current app controls invoke the whole workflow correctly. |
| `self-improvement-gateways.spec.ts` | KEEP as gateway/auth/normalization tests; REDO if offered as end-to-end proof. Its fetch and proposal states are mocked. |
| `FixtureReviewTool` / static proposal cards | Design/demo behavior only. Never use these as backend or approval proof. |
| Existing proposal catalog rendering | Scoped read-only coverage only; it cannot qualify scan or target mutation. |

## Test architecture

Use one representative complete journey and independent branch cases, so an early scan failure does not hide every downstream defect. Proposed checked file: `apps/web/tests/packaged/packaged-ai-private-org-improvement.spec.ts`, using `feature-test.ts`, the signed-build identity guard and the normal disposable fixture runner. Author through **Recon → Codify → Confirm**. Do not invent HTTP bodies, terminal statuses or timings from this design; record the actual supported contract before encoding assertions.

Two explicit evidence lanes:

- **Semantic lane:** real bounded approved model, real reviewer diagnosis, signed MCP, real queue, user decisions and real subsequent skill use. A scripted provider may prepare synthetic historical evidence through real session APIs; it must never produce the reviewer diagnosis or fabricate an outcome.
- **Deterministic boundary lane:** real packaged UI/API/engine with only provider transport loopback-scripted where needed for rejection, stale revision and failure timing. Label it transport/state-machine proof, not diagnosis quality. No `page.route` fulfillment or direct DB insertion of proposal, measurement, approved/applied status or engine result.

All runs use exact local source/bundle identity, one worker, zero retries, explicit model gates where applicable, bounded per-stage deadlines and a sanitized checkpoint receipt. Keep the global unexpected-error audit. A blocked stage reports its actual checkpoint, target hashes and failed condition; it does not wait indefinitely or reinterpret an intermediate tool step as completed review.

## Owned fixture

- Fresh disposable `.invalid` operator; only nonce-prefixed `[smoke]` records and fixture-contained managed files/workspaces.
- One existing managed skill and one ordinary agent profile bound only to it. Prefer the existing benign heading defect: required heading `Weekly summary`, current skill/profile wrongly says `Summary`.
- Two distinct owned historical sessions showing that same failure; a second already-fixed target and an injection-bearing historical entry provide negative controls. Reuse the existing semantic harness's public-API/actual-engine setup pattern; do not import operator transcripts.
- Before review, capture exact profile revision, skill DB/body/version, managed SKILL.md hash and real engine-catalog content. Demonstrate the baseline failure through an actual target run.
- Normal reviewer profile/schedule and exact signed scopes; select an available approved model only through the normal runtime metadata path. Preserve permission denials. Do not broaden the reviewer to make the test pass.
- Before/after snapshots include all unrelated fixture target hashes, so a correct fix to one target cannot hide collateral edits.
- Cleanup through supported routes only after exact owner/nonce/current-state checks. Stop and retain evidence if provenance is uncertain. The runner stops owned processes and scrubs the entire credential-bearing fixture after either outcome; original credential hashes must remain unchanged.

## Cases and observable acceptance criteria

| ID | Trigger / user action | Required observable outcome and failure boundary |
|---|---|---|
| O1 — real scan and suggestion | Start the normal reviewer through the supported app/schedule entry | One actual reviewer run reads the two owned evidence sessions and current target via signed tools; produces exactly one valid matching proposal; already-fixed/injected findings produce none. Queue/API/SQLite IDs agree. All target bytes remain unchanged before human approval. Empty/no-valid-evidence scan honestly reports no actionable findings. |
| O2 — understandable review | Open the exact proposal in Review Queue | UI identifies the target, problem, evidence, proposed repair, risk, rollback and verification expectation from the same real proposal. Missing human-readable proof is a failing usability/coverage boundary, not satisfied by an API response hidden from the user. Refresh/reload retains identity/status. |
| O3 — approval actually deploys | Cancel once, then confirm Approve on that exact card; repeat-click protection | Cancel sends no write. Confirm produces one durable decision/action for that proposal/actor, exact revision and target change. UI reflects actual durable deployment state, not optimistic accepted-request success. DB, managed skill file and both relevant engine catalogs agree. No unrelated target changes. |
| O4 — improved skill actually used | Run the ordinary target agent on a fresh owned task after apply | Real SDK/tool provenance shows the approved skill/version/content was used, and its output now satisfies the heading criterion that failed before. UI/API/engine transcript agree; no injected answer, directly edited transcript or canned diagnosis qualifies. Reload keeps the deployed revision. |
| O5 — honest testing/outcome | Observe supported post-apply test/experiment flow, and exercise its normal declaration/action where present | Actual eligible run receipts, baseline/treatment provenance, counters and guardrails back the result. “Applied,” “collecting,” “inconclusive,” “regressed” and “verified” remain distinct. Insufficient samples/time never produce a fabricated improvement. No edited clock/DB scores/statuses. A missing app control remains an explicit end-to-end gap even if its API works. |
| O6 — reject and revise | Reject a separate owned proposal; initiate supported follow-up revision with changed evidence/current target | Rejection leaves target/engine/file unchanged and persists after reload. A follow-up revision is a new validated proposal with fresh proof and its own human decision; old approval is not reused. If no supported user revision entry exists, expose that missing path rather than implement it in test setup. |
| O7 — stale human edit | After proposal, change only the owned target normally, then approve old proposal | Stale repair fails visibly; newer DB and file bytes stay byte-identical, and no successful deployment/measurement is recorded. Test skill priorBody and profile revision separately. **Confirmed focused regression:** an intervening legitimate DB+managed-file edit was overwritten when the old proposal was approved; unchanged-preimage case passed. Private real-repository regression1passed/1failed at `/private/tmp/rhythm-org-optimizer-refine-skill-recon-20261021/test.log`; no native approval claim. Minimal repair is being prepared. |
| O8 — failed change and safe undo | Exercise a failing/inconclusive owned test path, then use supported Revert on an eligible applied/active change | UI does not label failure a success; successful revert restores exact preimage and relevant engine projection. A concurrent post-apply human edit causes a visible conflict rather than overwrite. Verify actual revert eligibility/status from Recon. |
| O9 — authority and recovery | Attempt reviewer self-approval through its granted tools; test the configured human-operator auth boundary; interrupt and reopen a pending owned operation | Reviewer tools cannot apply/reject/revert a suggestion. Human decisions record the actual operator and obey the configured local/org auth boundary. Reviewer evidence remains owner-scoped; do not invent a private-per-user human queue policy—the current queue list is organization-wide and its routes intentionally support the local operator. Reopen recovers the same operation without duplicate proposal/application or indefinite spinner; actual errors retain enough context for retry. |
| O10 — requested new-skill/test lifecycle | Inspect current supported creation → executable tests → approval → use/revision entry | Current source does not implement this as part of Org Reviewer. Keep an explicit incomplete contract. Do not substitute a manually API-created skill, stored verification prose, legacy external-discovery generator or fixture card and call this requirement passed. A separate product design is needed if this automated capability is required. |

## Completion criteria and ordered work

| Order | Work | Likely files | Evidence / dependencies |
|---|---|---|---|
| 1 | Prove/refute stale skill approval and map real entry/actions | proposal appliers/validation; reviewer service; private owned regression | Source regression plus real owned backend check if a repair is needed; no speculative product change |
| 2 | Recon O1–O4 with the representative owned skill | packaged runner, private observer, existing reviewer harness patterns | Final locally signed build; actual bounded model; known baseline defect; real human UI decisions |
| 3 | Codify O1–O4 and independently Confirm | proposed packaged spec; sanitized Recon artifact | Separate reasoning pass after observed statuses/DTOs; no assertion from assumptions |
| 4 | Recon/Codify/Confirm O5–O9 independently | same spec/helpers; existing experiment/outcome APIs | Supported controls/declared experiment, real evidence bounds, separate negative fixtures |
| 5 | Report and design missing O10 / any absent app controls | this plan; feature inventory; follow-up product plan | Explicit separation of existing implementation from desired new capability; no silent policy expansion |

A complete success requires all claimed user stages to run against the same exact locally built revision, with real engine evidence and exact cleanup, and every required branch independently confirmed. Until then, status remains **designed / unverified**, with each actual failure recorded. No push, PR, merge, installation, production-data mutation or release is part of this plan.

## Source anchors

- `docs/ai/decisions/2026-09-07-org-reviewer.md`: controlling replacement/proposal-only decision.
- `docs/ai/runs/2026-10-03-org-reviewer-manual-policy.md` and `2026-10-04-org-reviewer-target-pagination.md`: manual identity/model metadata and bounded current-state proof.
- `apps/api_server/src/services/org_reviewer_service.ts:42,549,609,725,1176`: supported refinements, evidence, exact repair, signed authority, proposed-only submission.
- `apps/api_server/src/controllers/org_proposals_controller.ts:202,262,303`: human approve/revert/reject.
- `apps/api_server/src/services/org_proposal_apply_service.ts:524`; `org_proposal_appliers_wiring.ts:797,1399`; `org_proposal_measure.ts:685`: deployment, skill write/validation and rerun/outcome machinery.
- `apps/web/src/components/ToolWorkspace.tsx:1451`; `apps/web/src/gateway/org-proposals.ts:11`: actual React queue controls and gateway limits.
- `apps/desktop_flutter/lib/features/agent_optimizer/views/org_proposals_view.dart:177,313`: distinct Flutter approval/applied-change surface.
- `apps/api_server/src/__tests__/org_reviewer_semantic_live.test.ts`; `org_reviewer_live.test.ts:370`: existing semantic setup and narrower rejection-only lifecycle check.
