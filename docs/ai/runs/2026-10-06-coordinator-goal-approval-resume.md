---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-coordinator-approval-resume-20261006
pr: none
issues: []
status: source-complete-unverified-composed
tags: [run, rhythm]
---

# Coordinator goal approval resume — producer + exact consumer + coupled admission (source only)

Authority: Sol plan `coordinator-goal-approval-resume-sol-plan.md` (sha `5f2a1684…47e2`), Astra review (`PLAN_APPROVED_FOR_SAME5A_SOURCE_REPAIR`) and `../source-preparation-and-reservation.json`, read in full. Design checkpoint recorded BEFORE implementation in `../approval-resume-source-design.json`. Base `6e339972…`. No commit; no live approval request/decision/consume, goal retry, API/engine/app/model runtime, credential or private-content read, grant/profile/consent change, package or signing. The four read-only files (`opencode_client_service.ts`, `coordinator_conversation_contract.ts`, `model_provenance_repository.ts`, `agent_approvals_repository.ts`) are byte-identical; **no extra seam was needed** (`../additional-seam-review-request.json` was not written).

## Files (pre/post sha256 in `../approval-resume-worker-handoff.json`)

Production (8 of the 9 approved; `server.ts` needed no change and is byte-identical): `services/agent_approval_continuation_service.ts`, `services/coordinator_foreground_mcp_authority.ts`, `repositories/coordinator_conversations_repository.ts`, `services/coordinator_conversation_model_status_service.ts`, `services/coordinator_conversation_service.ts`, `controllers/external_content_security_controller.ts`, `services/external_content_security_service.ts`, `apps/mcp_server/src/tools/coordinatorConversation.ts`.
Tests: new `__tests__/coordinator_goal_approval_resume.test.ts` (41); changed expectations in three protected/existing tests, identified below.

## Behavior

- **Producer** (`agent_approval_continuation_service`): for an APPROVED approval only, the repository proves from current rows that it is the current primary root's approved, unconsumed, unexpired `delegation.start-async` approval, decided by `user:<owner>`, bound to the current taint, whose stored digest uniquely selects one captured, unlinked, uncommanded `{goalId}`. Only then the wake carries provenance `approval_continuation / agent_config / routeAuthed null` with the strict reason code `goal_approval_resume_<32 hex of sha256(approvalId LF goalId LF goalRevision)>` (53 chars, within the existing `^[a-z][a-z0-9_]{0,63}$` allowlist — no marker parser/schema change; never `c2_foreground`, never the callback marker) and server-derived `goal_id` + `approval_id` lines. The qualification is recomputed inside the existing `promptAsync` `beforeDispatch` hook; a mismatch throws, the client sends nothing and the continuation returns to `queued`. Generic, rejected, pending, stale-taint and ambiguous approvals keep the previous wake byte-for-byte.
- **Consumer** (`coordinator_foreground_mcp_authority` + repository): new distinct `goal_approval_resume` binding. It needs the verified signed call, the active native tool (`getCurrentTrustedMcpToolCall`, real `userMessageId`), exactly one accepted dispatch for that user message with the recomputed code, and an independent re-read of the approval (decision, actor, action, digest of the signed goal, bound agent, taint, expiry, unconsumed), the goal (captured/unlinked/uncommanded, current revision) and the current primary root/SDK; re-read after the engine await. `resolve()` (status/callback) is unchanged, so the status tool and child callback stay status-only; `startGoal` uses foreground OR this action-bound kind (only when the signed call carries an approval id).
- **Coupled admission** (`…model_status_service`, `…conversation_service`, repository, security service): the signed envelope is verified (`coordinator_agent_goal` scope), parsed to strict `{goalId, approval_id?}`, bound, re-proved (`bindingCurrent` + root/profile) and only then `repository.reserveGoalDelegationAuthorized` runs the existing reservation and, for a fresh `reserved` outcome, the synchronous `consumeCoordinatorGoalApproval` (unchanged `consumeApproval` taint/approval/digest/expiry/one-use rules) inside ONE outer SQLite transaction. A refusal rolls both back (goal not poisoned); `approval_required` returns a bounded held response with the exact fixed `security_action "delegation.start-async"` and `{"goalId":…}`. Replays find the existing command (no second consume); a consumed + uncertain dispatch stays a durable `uncertain` hold with no refund. After consumption `isCurrent` accepts the consumed token only with the exact command key (hash incl. the approval id) that this transaction created.
- **Obsolete route**: `POST /agent-approvals/consume` with action `delegation.start-async` and a proof tool name of `rhythm_start_coordinator_goal` fails closed BEFORE verification (no nonce/token burned). All other action/tool pairs unchanged.
- **MCP**: `rhythm_start_coordinator_goal` no longer calls the generic consume preflight; it posts only the signed envelope.

## Commands and results (repo root)

- **Red first** — `npm --prefix apps/api_server test -- --run src/__tests__/coordinator_goal_approval_resume.test.ts` before any production edit: **15 failed / 26 passed** (failures include: exact approved resume not started, clean-foreground tainted-without-token started with no gate, injected-consume never reached, consumed+uncertain hold, obsolete route returned 200, drift cases that reserved without binding proof). The pre-fix cause is also asserted as a passing characterization: the real `resolveForeground` rejects the approval-origin wake message. This is a source reproduction, not an executed production failure.
- **Green** — same file → **41/41**.
- MCP: `npm --prefix apps/mcp_server test -- src/tools/__tests__/coordinatorConversation.test.ts` → 6/6.
- Changed/related API suites → `issue_1134_external_content_security` + `issue_1392_approval_continuation` 22/22; `core_boundary_callback`, `coordinator_core_followon`, `coordinator_conversation_{navigation,vertical,service,context,runtime_adapters}`, `c3_backend_followon`, `coordinator_calendar_project_context`, `dayflow_coordinator_server_composition_contract`, `issue_1123_contract` all pass (navigation + resume 60/60 after the one fixture change below); approval suites `issue_1392_bypass_approval_gate`, `issue_1392_approval_delivery`, `issue_1226_trusted_boundaries`, `unattended_scheduled_auto_approve`, `issue_895_agent_approvals`, `issue_1382_approval_lanes`, `human_approval_signature`, `approval_not_required_on_clean_session` → 38/38.
- `npm --prefix apps/api_server run build` → pass (tsc incl. tests, after the last edit). `npm --prefix apps/mcp_server run build` (`tsc --noCheck`, as scripted) → pass. An `npm exec tsc --noEmit` MCP type-check was blocked by the permission layer and not run, so the MCP edit is not strictly type-checked beyond its vitest run. `git diff --check` → clean.
- Not run: the four known memory baseline failures, the 342 group, broad suites, live/`.live.` tests.

## Changed existing/protected test expectations (every one)

1. `issue_1134_external_content_security.test.ts` — the previous turn's goal-pair block asserted the obsolete route ADMITS the pair (clean 200, token consumed once, replay 409). Those become "fails closed, nothing consumed, nonce not burned"; its negative and generic-regression cases are kept.
2. `coordinator_conversation_navigation.test.ts` — `SOL core: actual signed goal boundary…` builds an isolated hand-built schema with no security tables, so the new in-API gate cannot run there. It now injects the CLEAN-session outcome through the new optional `approvals` dependency of `CoordinatorConversationModelStatusService` (production defaults to the real service). One line.
3. `apps/mcp_server/.../coordinatorConversation.test.ts` — the goal tests asserted the generic consume preflight; they now assert a single direct post of the signed envelope (incl. approval id pass-through, held-text pass-through, fail-closed cases).

## Honest limits

- Source/synthetic only: real approval routes, producer, client provenance, verifier, repositories, SQLite; stand-ins are the SDK transport, the engine's active-tool inspection, the stream bridge and the child dispatcher. Installed/actual approved-wake delivery, the real bridge's native-user linkage timing, the real engine tool-call identity and the real child remain UNPROVEN until builder's isolated runtime proof.
- `beforeDispatch` is the nearest existing freshness seam; the client awaits its history guard between that hook and the SDK call, so a stale wake can in principle still be exposed. It cannot gain authority because the consumer re-proves everything before token use.
- Late native-user linkage relies on the bridge's existing oldest-unlinked-dispatch rule (as the child callback does); if it cannot link, the resume is a hold.
- A user can still approve while the goal gets a new revision; the resume then holds (reason code includes the revision) and a fresh approval is needed.
- GitNexus unavailable; manual caller review: `resolve()` callers (status) unchanged; `startCodingWorkflow` has one production caller (`startGoal`) which always passes `authorize`; `consumeApproval` is called unchanged by the new wrapper and by the generic route; no other caller of the obsolete goal exception remains.
