---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-mobile-canonical-backend-20261006
pr: none
issues: []
status: source-complete-unverified-composed
tags: [run, rhythm]
---

# Signed coordinator goal admission repair (source only)

Authority: `docs/ai/plans/2026-10-06-coordinator-goal-signed-admission-repair-plan.md` (sha `50fc7276…10d`) and its Astra review, read in full, plus `../goal-signed-admission-preparation.json`. No commit; no live API/engine/model/app/UI/runtime operation; no MCP, security-service, `trusted_mcp_call`, other route, OpencodeClient, bridge, auth, router, fork, mobile or UI edit. Wire alignment and C2 not started.

## Files (pre/post sha256 in `2026-10-06-coordinator-goal-signed-admission.sha256`)

- Production: `apps/api_server/src/controllers/external_content_security_controller.ts` (only).
- Test: `apps/api_server/src/__tests__/issue_1134_external_content_security.test.ts` (new `describe` block, 8 cases; the existing 9 are unchanged).

## Behavior

- `consume` now picks its expected tool through `expectedConsumeToolName`: only when action is exactly `delegation.start-async` AND the untrusted `proof.toolName` is exactly `rhythm_start_coordinator_goal` is that fixed literal used; every other action/tool pair uses the unchanged `SECURITY_ACTION_TOOLS` mapping. The unchanged real `verifyTrustedMcpCall` then verifies signature, arguments hash, age, pinned key and the `approval-consume` nonce scope against that literal. No alias, caller-provided expected tool, retry or fallback.
- For that pair only (`requireCoordinatorGoalShape`): signed args must be exactly `{goalId, approval_id?}`, `goalId` a nonempty string ≤256, `approval_id` (if present) a nonempty string ≤256; payload exactly `{goalId}` equal to the signed goal; a consume-body `approvalId`, if supplied, must equal the signed `approval_id` (an unsigned replacement is rejected). All violations are 403. `requireSecurityPayloadBoundToTrustedArguments` and the approval/taint/replay `consumeApproval` path run unchanged afterwards. The envelope is not altered, so the downstream goal service still verifies it under its own `coordinator_agent_goal` scope.

## Commands and results (repo root)

- **Failing before** — `npm --prefix apps/api_server test -- --run src/__tests__/issue_1134_external_content_security.test.ts` (new cases added, controller unchanged) → 4 failed / 13 passed. The 4 positives (clean exact pair; approved token consumed once; fresh-envelope replay positive; approval-bound positive) failed with the production message `trusted Rhythm MCP caller is required for rhythm_delegate_async: trusted MCP call payload mismatch`. The negative cases passed trivially before the change.
- **Green after** — same command → **17/17** (9 existing + 8 new). One interim failure was my own helper counting a wrong approval status column (`consumed_at`), fixed in the test only.
- Covered through the actual route server, real verifier, isolated DB and the existing synthetic signer (fresh signature per case): clean exact pair 200 allowed; tainted without token 403; exact approved token consumed once then 409 replay with `consumed_at` count 1; other signed tools on this action and the goal tool on other actions 403; altered proof tool name / signature / arguments hash 403; expired proof 403; same-envelope nonce replay 403; substituted goal, extra signed fields (cwd/target/profileId/prompt/model/goalID), extra payload fields, missing/empty/oversized/non-string goal 403; unsigned, mismatched and oversized approval id 403 with the approval left unconsumed and still usable; generic `rhythm_delegate_async` clean 200 / tainted-without-token 403 and the legacy tool signed over goal-shaped args still taking the generic path.
- `npm --prefix apps/api_server run build` → pass. `git diff --check` → clean.
- Protected pins: every non-owned pinned path from the preparation file (including the chat source/tests/run record and wire docs) re-verified with `shasum -a 256 -c` → no mismatch. Not run: the 342 group, closed baselines, other suites.

## Honest limits

- Source tests drive the real consume route with a synthetic signer; they do not prove the real MCP producer, engine, hosted identity, the downstream `/coordinator-agent/start-goal` goal authority, a single child, or the callback. Builder's bounded real API/engine fixture remains the only qualification, after Sol's review. A subsequent independent authority/grant failure there is a hold, not scope for this change.
- Several negatives (wrong tool/action, altered proof, extra fields) also reject before the change; they guard the repaired path against widening rather than demonstrating a RED→GREEN transition.
- The existing MCP producer test stubs consume and was not touched; no producer→route integration case was added (would need a new fixture).
- GitNexus unavailable; manual caller review: `consume` is the only user of the new selector; `taint` and `SECURITY_ACTION_TOOLS`/`EXTERNAL_CONTENT_TOOLS` exports are unchanged.
