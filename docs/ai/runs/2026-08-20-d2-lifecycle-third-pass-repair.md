---
date: 2026-08-20
repo: Rhythm
branch: agent-stack/si-d2-post-apply-lifecycle
pr: 1454
issues: [1433, 1434, 1435]
status: fixes-implemented
tags: [run, Rhythm, review]
---

# D2 lifecycle third-pass repair — 5 blocking verification findings

Continuation of the D2.3–D2.5 post-apply lifecycle work (#1433–#1435), fixing
5 findings raised by an independent post-second-pass verification session
(`0ba319cf-9f36-4058-a6ee-043b4501e218`). Builds on top of the second pass's
uncommitted working-tree fixes (`docs/ai/runs/2026-08-20-d2-lifecycle-second-pass-review.md`)
rather than discarding them.

## Files

- `apps/api_server/src/services/agent_profile_projection_service.ts` —
  exported `isProjectionSettled(outcome)`: true unless `blocked`/`failed`/`missing`.
- `apps/api_server/src/services/org_proposal_apply.ts` — new exported
  `landConfigFieldWithProjection` (idempotent CAS + projection-gated landing,
  shared by repair and revert); `revertProposal`'s `isConfigFieldSnapshot`
  branch now routes through it and returns `'conflict'` (never reaches its own
  terminal `updateStatusAsync(..., 'reverted', ...)`) when the mutation lands
  but projection isn't settled.
- `apps/api_server/src/services/auto_repair_service.ts` — `applyRepairAttempt`
  split into `resumeRepairAttempt` / `createRepairAttempt` sharing
  `landAndClaimRepairAttempt` (claims `applied` only once
  `landConfigFieldWithProjection` reports `'landed'`); `runAutoRepairAsync` now
  looks up an existing dedup-keyed proposal for the next attempt number
  BEFORE calling diagnose, resuming it directly (no diagnosis call at all) if
  found.
- `apps/api_server/src/services/auto_revert_service.ts` — removed the
  separate, AFTER-the-fact "independent post-write verification" (it ran
  after `revertProposal`'s own terminal transition, which was the exact
  window finding #3 flagged); added `configFieldFingerprints` /
  `targetIdentityFingerprint` / `changeFingerprint` / `valueFingerprint`
  (SHA-256, positional NUL-separated material, never the raw value) and wired
  them into `buildAlertPayload` (`originalChange.targetFingerprint`/
  `changeFingerprint`) and `buildRepairTrail` (`field` + `valueFingerprint`
  per repair).
- `apps/api_server/src/__tests__/post_apply_lifecycle_repair_live_e2e.test.ts`
  — strengthened the final assertion: requires
  `guardrailStatus==='clear'` (not "the floor merely changed"), plus exact
  `revertStatus==='not_needed'`, `repairAttemptCount` equal to the repair-id
  trail length, that trail unchanged, no alert payload, and the original
  proposal settled `'active'`.
- Tests: `auto_repair_service.test.ts` (+2), `auto_revert_service.test.ts`
  (+2), `org_proposal_apply.test.ts` (+1) — one falsifying test per finding,
  plus the "generates an alert with the full trail" test updated for the new
  fingerprint fields.
- Contracts updated: `docs/ai/contracts/issue-1433.json` (new c12/c13, a
  `third_pass_note` on c11), `issue-1434.json` (new c14/c15,
  `third_pass_*` evidence fields), `issue-1435.json` (new c16, `blocked` —
  see Notes below; honestly recorded, not fabricated).

## Disposition of each of the 5 findings

1. **Projection outcome is part of success, not a side effect.** FIXED.
   `landConfigFieldWithProjection` is the one primitive: CAS the value (or
   detect it's already landed from a prior partial call — never re-mutate),
   then gate on `isProjectionSettled`. Repair: `blocked/failed/missing`
   returns `'conflict'` — never claims, proposal stays `proposed`, no strike
   consumed. Revert: same outcome returns `'conflict'` from `revertProposal`
   BEFORE its own terminal transition — proposal stays at its current
   non-terminal status, never contradicting a `revert_failed` event.
2. **Resume durable attempt BEFORE diagnosis.** FIXED. `runAutoRepairAsync`
   looks up `proposalsRepo.findByDedupKeyAsync` for the NEXT attempt number
   before ever calling `diagnose()`; if found, resumes via
   `resumeRepairAttempt` (which reuses the same land-and-claim primitive as
   `createRepairAttempt`) with zero diagnosis calls. Falsified: a `diagnose`
   mock that throws is proven never invoked when a durable attempt already
   exists (previously it was always called first, and its failure incorrectly
   reported `deferred` instead of resuming).
3. **Revert verification must precede terminal proposal status.** FIXED by
   the same root-cause fix as #1: `revertProposal`'s config-field branch now
   performs the CAS + projection check itself, before the `measuring ->
   reverted` transition. The old, SEPARATE post-write re-check in
   `auto_revert_service.ts` (which ran AFTER that transition already
   committed) is removed outright rather than kept as a second, redundant,
   racy verification.
4. **Full-trail fingerprints.** FIXED. Deterministic SHA-256 fingerprints
   (never raw values) added to the alert payload: `originalChange.
  targetFingerprint`/`changeFingerprint` for the original proposal's
   `ConfigFieldSnapshot`, and `field` (plain, allowlisted) +
   `valueFingerprint` for each repair attempt. Positional NUL-separated hash
   material (not object-serialization) — deterministic by construction, no
   canonical-JSON machinery needed for a fixed 2–4-field tuple. Omitted
   (never fabricated) for any snapshot shape the helper doesn't recognize.
5. **Strengthen live E2E terminal assertion.** FIXED AND LIVE-VERIFIED. The
   diagnosis context now carries bounded `post-apply-regression` signals built
   from the same D2.2 guardrail registry and minimum sample threshold; empty or
   insufficient evidence defers without diagnosis or strike.

## Checks

- `tsc --noEmit`: pass (0 errors).
- `npm run build`: pass.
- Focused: `auto_repair_service.test.ts` 17/17, `auto_revert_service.test.ts`
  11/11, `org_proposal_apply.test.ts` 111/111,
  `post_apply_lifecycle.integration.test.ts` 8/8, `post_apply_monitor.test.ts`
  green — **155/155 together**.
- Adjacent regression (14 files: `org_proposal_appliers_wiring`,
  `w1_corrective_6_boundaries/revisions`, `org_proposal_measure`,
  `post_apply_events_repository`, `post_apply_event`, `skill_schema_parity`,
  `org_settings_schema_parity`, `delegation_generator`,
  `config_doctor_core_permissions_contract`, `w1_corrective_4/5_contract`,
  `issue_981/857/831/1082_*`): **311/312** (the 1 skip is the same
  pre-existing skip the second pass documented).
- Full API suite: **697 files / 5,717 tests — 5,528 passed, 182 skipped, 7
  failed.** The 7 failures are byte-identical to the documented baseline
  (memory provenance ×2, `memory_index_rebuild` ×1, `memory_injection` ×2,
  `delegation_caller_identity` ×1, `issue_1135_audit_lock_contract` ×1) —
  unrelated subsystems, not touched this pass, not a regression (net +5
  passed / +1 skipped vs. the prior documented run matches exactly the 5 new
  tests this pass added, no unexplained deltas).
- `git diff --check`: clean. No dependency/lock file touched.
- GitNexus `detect_changes({scope:"all"})`: `changed_symbols: 0` against 23
  changed files — the worktree index remains stale (documented UNKNOWN risk
  in every prior pass too). Impact was traced manually instead: exhaustive
  `grep` for every caller of `revertProposal` / `runAutoRepairAsync` /
  `runAutoRevertAsync` across `apps/api_server/src` (53 / — / — matches
  respectively), confirming the human `/revert` path (#857,
  `org_proposals_controller.ts`), the legacy measure-revert path
  (`org_proposal_measure.ts`), and every existing test file that exercises
  these functions, then reading each call site to confirm compatible
  handling of the (unchanged) `RevertOutcome`/`RunAutoRepairOutcome` enums.
- Falsification (each fix broken, confirmed red, restored):
  - `landConfigFieldWithProjection`'s `isProjectionSettled` check removed
    (forced always-true) → both the repair-side and revert-side
    "blocked projection" tests went red (claimed/reverted immediately instead
    of `deferred`/`conflict`) → restored, green.
  - The pre-diagnosis `existingAttempt` lookup removed (diagnose called
    unconditionally, as before) → the "resumes BEFORE diagnosing" test went
    red (`diagnose` mock's throw propagated as `deferred` instead of
    resuming) → restored, green.
  - `configFieldFingerprints` forced to return `null` unconditionally → the
    new fingerprint test went red (asserted fields absent) → restored, green.
- Final sandbox live E2E: isolated ports 4297 (engine), 4298 (API), and 4299
  (gateway), backed by a synthetic SQLite fixture. The copied Claude
  credential was expired, so the disposable sandbox's most-recently-used
  diagnosis model was switched to `openai/gpt-5.6-sol`; no production config
  or data was changed. The real engine + real scheduler + real LLM consumed
  actual `post-apply-regression` signals, created one repair proposal, stayed
  `tripped` across a cron tick with no post-repair evidence, then five clean
  outcomes settled the event `clear` / `not_needed` with the original proposal
  `active`, an unchanged one-repair trail, and no alert. **1/1 passed in
  160.53s.** Sandbox teardown removed the directory and closed all three
  ports.

## Preserved behavior (verified unchanged)

- No-evidence pending; D2.2 registry/sample threshold — untouched.
- Diagnosis outage/null/timeout defers without a strike — untouched.
- Truthful non-actionable strike (real attempt, no proposal) — untouched,
  and in fact exercised live 6 times this pass (3 attempts × 2 runs).
- Idempotency key + target revision/value CAS — extended (projection-gated),
  never weakened.
- Chain-aware `expectedAppliedValue` (auto-revert's
  `resolveEffectiveAppliedValue`) — untouched.
- Protected scope refusal (`UNSAFE_WHOLE_FIELD_SCOPE_FIELDS`) — untouched,
  still enforced before any CAS/projection logic runs.
- Per-event diagnosis timeout — untouched; also correctly never invoked at
  all on a resumed attempt (finding #2), which is a strictly stronger
  guarantee than "invoked and bounded."
