---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-mobile-canonical-backend-20261006
pr: none
issues: []
status: source-complete-unverified-composed
tags: [run, rhythm]
---

# Optional calendar/project-session final exposure + future-time correction (source only)

Authority: `docs/ai/review/2026-10-06-calendar-dev-context-correction-astra-review.md` and `…-calendar-dev-context-sol-verification.md` (read in full). Frozen optional packet `93954dfb…9327` is corrected here; the earlier accepted release snapshot/runtime was not touched. The queued automatic-Dayflow API C0 follow-on was NOT started. No commit; no live Google/provider/SDK/model/API/engine/app/device operation; no sync, timer, framework, body, grant or goal-admission change; callback authority and `startGoal` untouched.

## Files (pre/post sha256 in `2026-10-06-calendar-final-exposure.sha256`)

Changed: `contracts/coordinator_conversation_contract.ts`, `services/coordinator_conversation_context.ts`, `services/coordinator_conversation_runtime_adapters.ts`, `services/coordinator_conversation_service.ts`, `services/coordinator_conversation_model_status_service.ts` (only the signed wrapper's final render seam), and `__tests__/coordinator_calendar_project_context.test.ts` (Sol's four reds were already applied and are unchanged; one case added). `repositories/calendar_shadow_events_repository.ts` and `server.ts` needed no change.

## Behavior

- **Internal bounded proof.** `attachOptionalSourceProof`/`optionalSourceProofCurrent` (contract file) keep a synchronous check in a WeakMap keyed by the prepared projection — never serialized, never in a response/fingerprint/persisted value. The assembler's sanitized copy inherits the adapter's proof.
- **Calendar proof:** exact owner account id/owner/external id/status/lastSyncedAt + raw selection (same key as the during-read check), via the account's existing SYNCHRONOUS local read, plus the same eight-row window query compared with the prepared rows. No synchronous account read ⇒ proof fails ⇒ withheld.
- **Project proof:** every selected session re-read by id (exact owner/project/root/nonsystem/chat/nonarchived, status, name, activity, profile id), its project's current archive state and name, the injected `ownerProjectAccess`, and the profile's label/executability. No pager scan.
- **Final render:** `modelStatus` now returns `{text, finalize}`; `finalize()` synchronously re-proves and re-renders the SAME bounded JSON after the service's last binding await, and the signed wrapper calls it again after ITS last `authority.isCurrent` await and the sync scope check, then re-checks the 3,800-byte bound. An optional source whose proof fails loses ONLY its own observations (calendar → `changed_during_read`, new analogous project state `changed_during_read`, coverage `unknown`, counts 0); core status and the unaffected source stay. The JSON is rebuilt, never cut or redacted.
- **Foreground/callback:** `foregroundCoordinatorContextCurrent` and `prepareCallbackContext`'s `assembleFingerprint` (hence callback `current()`) now also require every observed optional source's proof synchronously after their last await. The semantic fingerprint (no ticking age) is unchanged.
- **Future time:** the five-minute future-skew grace and the clamp to age 0 are removed; any sync time after `now` is `invalid_sync_time` with null age.

## Commands and results (repo root)

- **Red first** — `coordinator_calendar_project_context.test.ts -t "Sol:"` → 4 failed / 26 skipped (future sync observed with age 0; project archive, session owner transfer and calendar selection each retained `Dev session`/`Standup` after the final binding await).
- **Green** — same selector → 4 passed / 26 skipped.
- **New wrapper case** `actual signed wrapper: an optional source changed during ITS final authority await loses only its own observations` (real `CoordinatorConversationModelStatusService.status`, real service/assembler/adapters/SQLite; archives `proj-a` during the wrapper's final authority read, root binding still valid; asserts core status available, project observations gone with state `changed_during_read`/coverage `unknown`, calendar `Standup` retained, ≤3,800 B). Verified genuinely red by temporarily making the wrapper return the pre-final text (failed on `Dev session`), then restored.
- Affected set → `coordinator_calendar_project_context` (31 incl. original 26 + 4 Sol + 1 wrapper), `coordinator_conversation_{context,runtime_adapters,service,navigation,vertical}`, `core_boundary_callback`, `coordinator_core_followon` → **89/89**.
- `npm --prefix apps/api_server run build` → pass (after the final edit). `git diff --check` → clean. Not run: the 342 group and all closed baselines.

## Honest limits

- The proof is local and eventual: it detects a change visible in the same SQLite sources, not a Google-side change; account binding stays `unproven`, external completeness `unknown`, and an in-place reconnect before the first read remains undetectable. A change in the narrow window between the final synchronous check and the response (no await remains) is not possible in-process but a concurrent process write can still land after it.
- Proof granularity is intentionally strict (any change to a selected row's name/status/activity/profile or the project's name withholds that whole source for that response); a harmless concurrent status tick will withhold project observations rather than show stale ones.
- A projection from a custom adapter without a proof is treated as unknown and withheld; only the two in-tree adapters attach proofs.
- Source/synthetic-harness only: no real model/HTTP signed call, composed server, live Google data or installed app. Automatic qualified Dayflow bodies and full native Dayflow remain separate and unfinished. GitNexus unavailable; manual caller review: `modelStatus` (signed wrapper and foreground paths only), `foregroundCoordinatorContextCurrent`, `prepareCallbackContext`, the single `createCoordinatorConversationContextAdapters` composition.
