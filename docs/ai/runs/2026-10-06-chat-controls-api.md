---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-mobile-canonical-backend-20261006
pr: none
issues: []
status: source-complete-unverified-composed
tags: [run, rhythm]
---

# Chat-controls parity — API-only settings and dispatch repair (source only)

Authority: `docs/ai/plans/2026-10-06-chat-controls-parity-reviewed.md` (sha `08d6a7e4…4d47`) and `docs/ai/review/2026-10-06-chat-controls-parity-astra-review.md`, read in full. Pins read from `../chat-controls-api-preparation.json`. No commit; no live API/model/app/device/runtime/package/sign/server operation; no web/mobile/fork file touched; automatic Dayflow API C2 not started. Root source/runtime composition (a34) is unaffected.

## Files (pre/post sha256 in `2026-10-06-chat-controls-api.sha256`)

Application (only the five allowed paths): `services/coordinator_conversation_service.ts`, `server.ts`, `routes/mobile_gateway_routes.ts`, `services/mobile_profile_catalog.ts`, `services/mobile_session_state_scope.ts`. New tests: `__tests__/coordinator_chat_controls_parity.test.ts`, `__tests__/mobile_coordinator_settings_scope.test.ts`. No other application path was needed.

## Behavior

- **Actual foreground dispatch.** The C2 foreground closure moved out of `server.ts` into the exported `createCoordinatorForegroundSender` (service file) so it is testable; `server.ts` only injects its existing collaborators. The model sent is the authorized SESSION model (fixed: stored session model; Auto: stored session model, else the profile model), re-confirmed through the ordinary `resolveModelForSessionTurn` (no `sessionId`, so nothing is persisted; no router, no per-turn override). The persisted `thinkingBudget` is forwarded as `reasoningConfig:{type:'enabled',budgetTokens}` and `fastMode:true` only when the session explicitly has it on — the ordinary WS shape; absent/false adds nothing, so no tier is ever raised automatically. Provenance keeps `origin prompt_api / requestedSource session` because the protected client requires it.
- **Profile scope independent of model.** Agent, profile system prompt, tool grants, role allowlist push and skill/memory prefaces are still selected by `session.profileId`; only the model-equality terms were removed from the profile-scope comparison (`resolved.model` and profile-default equality). The profile is never edited.
- **Selection.** `currentServerRootSelection`/`currentRootSelection`/`currentManagedSelection`/`ensureManagedSelection` gained an opt-in `allowSessionModel` (default false). It is true only for resolve/open of an existing root, foreground send + its context/contract/CAS re-checks, model-status, the signed status scope fence, and callback context. Finite plan/managed/goal-start paths keep the strict profile-equality proof.
- **CAS across awaits.** `sameSelection` now also compares `thinkingBudget` and `fastMode`; the sender's `valid()` re-reads owner/project/root (including `archivedAt`), profile enabled/agent/locked, session model/mode, reasoning, Fast and owner-project access at: before scope, after profile-scope/allowlist/stream/model resolution, and at each `prepare`/`before_sdk`/`sdk_exposure` validation, plus the service's `reservationCurrent`.
- **Settings port.** `PATCH /sessions/:id/state` resolves `findBySdkSessionId` first; otherwise the id is accepted only as the exact local id of the owner's current primary root (new strict `canUpdateMobileLocalPrimaryState`: exact owner and project, nonarchived nonchild nonsystem chat, independent `findMirroredPrimaryRoot` identity match; no NULL/blank project fallback). No SDK id is created and no ordinary-session fallback exists. On that path `profileId`, `permissionMode` and `opencodeAgentId` must equal the stored values (else 400, nothing written); only provider/model/modelMode/thinkingBudget/fastMode are written. Optional `fastMode`: absent preserves the server value, a boolean sets it, anything else is 400 — on both paths. Responses (`safeMobileSessionProfileState`) now include `fastMode`.
- **Opening/reading.** Open, resolvePrimary and status create no SDK/turn and change no setting (asserted).

## Commands and results (repo root)

- **Red first.** `mobile_coordinator_settings_scope.test.ts` → 8 failed / 11 passed (the 11 are 404/holds that the pre-change code also gave); `coordinator_chat_controls_parity.test.ts` → all failed (`createCoordinatorForegroundSender` did not exist).
- **Green.** Both files → **60/60** (19 settings + 41 parity).
- **Affected existing set** → `coordinator_conversation_{service,setup_scope,navigation,vertical,context,runtime_adapters}`, `core_boundary_callback`, `coordinator_core_followon`, `coordinator_calendar_project_context`, `mobile_routing_scope`, `issue_1286_projectless_profile_state`, `dayflow_coordinator_server_composition_contract` → **110/110**.
- `npm --prefix apps/api_server run build` → pass (after the last edit). `git diff --check` → clean.
- Protected hashes: every pinned non-owned path (APD/core/C3/lazy/optional, opencode_client_service, stream bridge, memory/auth/Dayflow, mcp_server, docs) re-verified with `shasum -a 256 -c` against the preparation pins → no mismatch. Not run: the 342 group and closed baselines.

## Honest limits

- Source/synthetic only. The real `CoordinatorConversationService`, `createCoordinatorForegroundSender`, `OpencodeClientService.promptAsync` foreground gates, repositories and ordinary resolver run; the SDK transport (the serialized body is asserted), the fork's native-message-id mint, the profile-scope resolver and the stream bridge are stand-ins. This proves the request handed to the SDK, **not** the served provider/model/reasoning/tier, any real provider, or the installed app.
- `startGoal`/finite/managed paths stay held when the session model differs from the profile default (strict selection kept by design); a user with a non-default Rhythm model can chat but cannot start a goal until that scope is separately approved.
- Auto never routes through Kev; with no stored session model it requires the ordinary resolver to return the profile model (an unauthenticated profile provider holds rather than silently falling back).
- `server.ts` runs `main()` at import and cannot be imported by tests; its wiring of the factory is verified by `tsc` and by the factory's tests, not by an executed composed server.
- Archived-session check was added to the foreground sender only; other pre-existing paths still rely on project-level archive checks.
- Rhythm model choice is a SESSION setting; there is no turn-only Rhythm override (per Astra's accepted scope).
- GitNexus unavailable; manual caller review of `currentRootSelection`/`currentServerRootSelection`/`ensureManagedSelection`/`sameSelection` call sites: only the sites listed above were switched to `allowSessionModel`.
