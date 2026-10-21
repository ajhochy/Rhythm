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
