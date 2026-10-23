---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-coordinator-approval-resume-20261006
pr: none
issues: []
status: source-complete-unverified-composed
tags: [run, rhythm]
---

# Coordinator goal approval resume — native-anchor client seam (source only)

Authority: Astra review `…first-design-astra-review.json` (sha `8556b470…a3`) and `../native-anchor-followon-preparation.json`, read in full. Preimage = Builder's frozen 13-path patch (`850e4b13…5d92`). Design: `../native-anchor-followon-design.json`. No commit; no runtime, live approval, goal retry, packaging, or other checkout. Only `opencode_client_service.ts` and `agent_approval_continuation_service.ts` changed in production; every other first-packet postimage and the three read-only files (`coordinator_conversation_contract.ts`, `model_provenance_repository.ts`, `agent_approvals_repository.ts`) are byte-identical; no further seam was needed.

## Behavior

- One optional INTERNAL 12th `promptAsync` context, kind `coordinator_goal_approval_resume_v1`, strictly qualified against literal provenance (`approval_continuation` / `agent_config` / route null / `goal_approval_resume_<32 hex>` / same SDK session) and refused when combined with the managed, foreground or callback contexts. Any mismatch returns false before any mint, row or SDK call.
- The client mints the request's native user-message id with the existing `mintPromptAnchor`, persists the EXACT dispatch row with that `sdk_user_message_id` before exposure (mint or write failure refuses exposure), puts the SAME id in the SDK body, and keeps the existing accepted/rejected settlement. Authority no longer depends on `linkOldestUserMessage`.
- The producer's synchronous validator runs before the mint, after the mint, and again AFTER the last awaited history/authority guard; there is no await between that final check and the SDK invocation. It covers the approval decision/expiry/consumption, action/digest, goal revision, root/profile/owner/project/SDK, taint, live SDK mapping and permission controls. Generic approval wakes pass no context and are unchanged.

## Commands and results (repo root)

- **Red first** (new anchor tests added to `coordinator_goal_approval_resume.test.ts`, run against the first frozen client/producer): `npm --prefix apps/api_server test -- --run src/__tests__/coordinator_goal_approval_resume.test.ts` → **26 failed / 43 passed** (messageID absent from the body, no row anchor, late guard mutation still reached the SDK, mint failure still sent, every typed-context refusal still sent).
- **Green** after the correction → **69/69**. First-packet tests no longer call the heuristic linkage (and still pass); one first-packet expectation ("unlinked wake is a hold") was replaced by "an active message that is not the wake's anchored id is a hold".
- Affected existing API suites → client (`services/opencode_client_service.test.ts`, `__tests__/opencode_client_service.test.ts`), `issue_1123_contract`, approval continuation/delivery, `core_boundary_callback`, navigation, `coordinator_core_followon`, three Dayflow suites, `issue_1134_external_content_security`, `c3_backend_followon` → 13 files, **253/253**.
- `npm --prefix apps/api_server run build` → pass. `git status`/hash review: only the two production files, the resume test and this record changed this turn. Not run: MCP (unchanged, typechecked by Builder), the four memory baseline failures, broad suites.

## Honest limits

- Stand-ins, disclosed: the SDK transport (its request body is asserted), the engine's native mint, the engine's active-tool inspection, the stream bridge and the child dispatcher. Real: approval routes/decision, producer, `OpencodeClientService.promptAsync`, provenance repository, delayed existing history guard (via a real nonreuse marker), verifier, repositories, consumer, atomic admission.
- The real fork mint endpoint and a real engine-assigned user-message identity are unproven here; installed behavior unproven.
- Validation cannot observe changes after the SDK call is issued; the consumer's mandatory proof before consumption bounds that.
- GitNexus unavailable. Manual analysis: `promptAsync` callers pass at most 11 args (new 12th is only set by the producer); the new branch is entered only when `approvalResume` is present; `maybeMintDayflowPromptAnchor` is skipped only for it (it already required routeAuthed true); the producer is the only constructor of the context.
