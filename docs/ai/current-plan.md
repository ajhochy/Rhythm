# Current plan — AI feature repairs and local qualification

- [x] Preserve b7d5 failures, separate product defects from test-authoring errors, and repair reload observers without weakening behavior assertions.
- [x] Independently confirm b7d5 router19, checked Hermes1, natural Once1, and focused reload10 as separate scopes.
- [x] Reproduce MCP readiness and background model eligibility failures with deterministic contracts; implement narrow candidates.
- [x] Commit825c reviewed candidate and rebuild/sign mega app locally under shared10GiB guard.
- [x] Commit Tasks/Dayflow/skill-approval repair batch20471a238e and rebuild/sign locally again.
- [x] Run checked canonical MCP live test against20471 isolated sandbox (1/1); exact source, real API/engine/stdio, scripted provider transport only.
- [x] Finish prior full serial API gate:8839passed/0failed/392gated skips before the Org skill guard.
- [x] Refresh full API gate against20471 including the Org skill guard:8845passed/0failed/392gated skips.
- [x] Run825c expanded86 selection:80passed/6failed,0skip/flaky.
- [x] Independently rerun86 against signed20471:86passed/0failed/0skipped/0flaky after two pre-action observer corrections; preserve earlier84/2 and825c80/6 receipts.
- [x] Independently confirm current20471 routing/conversation23, Coordinator1, Hermes1, naming1 and naturalOnce1; exact fixture cleanup captured. Initial intermittent lost-draft failure remains unexplained.
- [x] Observe real background extraction on eligible Luna, codify and independently Confirm1/1 on20471; useful learned draft creation remains separate.
- [ ] Continue closing78 remaining active behavior markers using Recon → Codify → Confirm; no aggregate pass until required coverage is proven.

No push, PR, merge, installation or release. Retain one active task worktree and only current/previous reviewed build artifacts; preserve unrelated work.

## Added scope: complete Org Reviewer/skill improvement journey

Intent: prove a user can start a review, understand a real suggested improvement, decide whether to accept it, exercise the changed skill/agent, inspect test results, and apply, reject, revise or revert through the supported current workflow.

Scope: source-backed design, existing-test triage, disposable packaged Recon, checked Playwright and independent Confirm; preserve all existing AI repair/rebuild work. Current Org Reviewer, proposal deployment, measured outcomes, and skill-version lifecycle must be mapped separately. Hard constraints: exact local signed build, real API/engine/signed MCP, nonce-owned fixtures/cleanup, existing human authority, bounded approved models, no operator-data mutation or external installation.

Design tension: a deterministic fixture should isolate a known repair, while the semantic lane must still let a real reviewer discover it rather than inject the expected proposal. Cheapest meaningful proof: one recurring owned skill/profile defect, one actual reviewer proposal, human UI approval, one real target use that demonstrates the repaired behavior, then exact rollback. Broader measurement/revision branches stay explicit until exercised.

Clarification interview: user explicitly does not know the intended workflow and asked us to investigate it; derive existing semantics from accepted decisions/current source and identify missing paths instead of asking them to invent internal states. No product-policy change is inferred.

- [x] Trace supported current reviewer/skill lifecycle and retired optimizer boundaries.
- [x] Triage current source/API/fixture/packaged tests; write observable criteria and independent branch cases.
- [x] Publish plain-language workflow and test design in `docs/ai/plans/2026-10-21-org-reviewer-end-to-end-playwright.md`.
- [ ] Repair confirmed stale skill approval overwrite with focused and live owned behavioral proof.
- [ ] Recon the representative journey on a fresh owned fixture, then Codify and independently Confirm; preserve failures as failures.
- [ ] Continue original repairs, full backend gate, local rebuild and native reruns.

- [x] Add and independently Confirm checked profile policy persistence and no-turn session binding1/1.
- [ ] Qualify new reviewer dispatcher and shared permission-order candidates live, commit candidate, rebuild/sign locally and rerun native checks.

## Current136e execution and test scope

- [x] Commit Reviewer dispatcher/order/session/identity repair candidate136e; real API boundary8/8, related source196/196 and WS fixtures52/52.
- [x] Build and sign136e locally; exact source and deep strict codesign confirmed.
- [ ] Finish the real-model packaged Reviewer journey first, then Codify/Confirm its observed behavior and repair remaining review UI/lifecycle gaps.
- [ ] Continue current-app Grid/history/skill/worktree/retention probes and focused regressions.
- User-directed: use change-focused backend/caller/live/Playwright checks per build. Full136e backend sweep deliberately stopped130; defer the full aggregate to final integration rather than repeat it on every build.

## User steering: pre-review candidate testing; Harness² research first

Intent: the Reviewer should generate2–3 alternatives, test isolated candidates with subagents, record results, compose supported changes and independently retest the exact final against the original before it reaches human approval. All improvement types, including tools and permissions, are in scope. User raised a token-spend limit; numeric cap remains undecided. Existing repair/coverage work remains tracked above.

Hard constraints: no live-target mutation during evaluation, no self-approval, immutable candidate/result identity, fresh-target check at eventual apply, shared bounded model usage, original preserved when no measured improvement. Design tension: broader exploration consumes more tokens and can overfit the diagnostic task; independent validation needs reserved budget. Cheapest proof is one real isolated defect and candidate composition, followed by a separate baseline/final comparison and human UI decision.

Clarification interview: answered all improvement types; token limit requested for consideration. Latest instruction explicitly requires researching Google Research Harness² before building anything. Research-only checkpoint: [primary-source findings and acceptance outline](plans/2026-10-21-harness2-reviewer-research.md). No implementation, new paid test cycle or rebuild is authorized by this checkpoint itself.

## Implementation: pre-review candidate evaluation (authorized)

The user approved implementation across all improvement types, including tools and permissions, a configurable whole-run token limit, local rebuild and packaged Playwright proof. The prior research-only hold is lifted. Reuse the current task checkout and preserve all prior repairs.

Acceptance: original and2–3 candidate configurations execute independently; composition records supported portions; the exact final runs a separate comparison against the original; only a qualified final becomes a proposed human queue row. Live targets stay unchanged until human approval. Every existing proposal kind needs an effect adapter; unavailable evidence cannot count as improvement. A durable shared token budget covers generator, original, candidate children, composition, judge, final validation and retries, with capacity reserved for validation and concurrency/restart accounting. UI configures the cap and shows progress, versions, results, spend and failure/inconclusive reasons. Budget exhaustion or missing usage produces no ready proposal.

Clarification: all types and token configuration are explicit. Use a conservative editable default rather than blocking on a numeric preference. No push/PR/merge/release/install; local build/test authorization remains.

| Order | Slice | Likely files | Required proof | Depends on |
|---|---|---|---|---|
|1| Durable evaluation records and shared token reservations |new evaluation model/repository/settings plus SQLite/Postgres schema| concurrent reserve/settle/restart/unknown usage and immutable results contracts |none|
|2| Isolated effect execution for all proposal kinds |new evaluation runtime/adapters; existing applier/engine projection seams| original/candidate separation, real permission/tool effects, no live writes |1|
|3| Propose/probe/compose/final verification and queue gate |new evaluation coordinator; Reviewer submit and approval seams| exact final provenance; negative outcome/budget cases never queue or apply |1,2|
|4| Review UI and configurable token cap |org-proposals gateway/contracts, Review Queue components| UI config save/reload, progress/results, exact tested approval |1,3|
|5| Local integration and qualification |live/API and packaged Playwright; local build script| focused RED/GREEN, sandbox behavior, exact locally signed bundle and UI/API/engine evidence |all|

Tests/contracts precede implementation. Changes to existing symbols require GitNexus impact attempts plus manual analysis where the index is stale/unindexed. Full backend sweep only at final integration.
