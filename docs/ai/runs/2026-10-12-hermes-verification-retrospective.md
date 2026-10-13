---
date: 2026-10-12
repo: Rhythm
branch: feat/hermes-authenticated-approvals-20261012
pr: null
issues: []
status: approval-regated-pass-notification-repair-active
tags: [run, Rhythm, retro, adherence]
smoke_result: blocked-actual-hermes
verification_claimed: approval-8live-39API-191MCP-pass-notification-15-tests-pass
divergence: true
overall_score: partial
expected_chain: parent-authorized-contract-implementation-independent-gate-repair-regate-handoff
observed_chain: approval-fail-repair-pass-notification-fail-repair-active-retrospective
skipped_skills: unknown-full-stage-transcript-not-reviewed
---

# Hermes verification retrospective

## Context

Parent approved this narrow post-failure learning slice. This writer owns only this new note; project-state, the approval run, product/tests and notification repair belong to other owners. Existing skills remain unchanged. No tests, services, servers, network, restarts or Git mutations were invoked for this retrospective.

Evidence read: [approval run](2026-10-12-hermes-authenticated-approvals.md), `apps/api_server/src/__tests__/hermes_approvals_repair_live_e2e.test.ts`; notification worktree `hermes-event-notify-20261012` run `docs/ai/runs/2026-10-12-hermes-event-notify.md`, `tools/dev/hermes_notify_acceptance.mjs` and `tools/dev/test_hermes_notify_subscriber.py`. Independent verifier outcomes below are supplied parent receipts, not new executions by this writer. The chain fields summarize this authorized slice, not a certified full orchestrator manifest audit; missing transcript is not evidence of skipped stages.

`divergence` records passed checks contradicted by independent behavioral probes, **not** a completed Hermes manual smoke followed by failure. Actual Hermes smoke remained blocked throughout.

## Failures — observed versus expected

| Criterion / claimed coverage | Expected | Observed | Category |
| --- | --- | --- | --- |
| Approval AC3 freshness; initial 8 live / 39 API / 191 MCP passed | Explicit malformed expiry refuses list/read/decision without mutation | Verifier `cd20939e` accepted `expires_at=''` through official SDK → built MCP → real API and persisted approval. Whitespace and `not-a-date` refused. | C2 wrong contract: omitted boundary value |
| Freshness regression | Exact current invalid-card hash must still reject freshness, not merely reject an outdated hash | Repair test independently reconstructs wire hash including malformed expiry; checks refusal and unchanged pending status, actor, nonce and continuation. | C2 corrected |
| Mixed signed desktop / relay races | One immutable durable winner, replay refused, one real continuation | Both opposite-decision races passed; **only desktop winners were observed**. Assertions allowing relay winners do not establish that outcome was exercised. | P evidence limit |
| Notification watchdog; 15 tests reproduced by verifier `aabdebd3` | Healthy continuing heartbeats must not suppress watchdog checks at 600/1200 seconds | Actual runner over 1365 simulated seconds requested only `/events` and `/stream`; neither watchdog check occurred. | C2 wrong contract: runner scheduling unproven |
| Notification replay conflict | Different event IDs sharing a cursor fail closed without crashing subscriber | Independent conflicting-ID/same-cursor probe crashed. | C2 wrong contract: conflict shape omitted |
| Notification trust schema | Malformed field types are rejected safely | Independent `kind=[]` raised TypeError; `version=True` was accepted. | C2 wrong contract: type boundary omitted |
| Final durable receipts | Run note contains final commands/results before handoff claims | Notification note still said final journal/restart/neighbor checks would follow, with no final receipts. This disproved the claim that those receipts were already recorded; it does not prove every claimed execution never occurred. | W adherence: evidence missing |
| Actual Hermes/Pi wakeup, visible update and browser-closed behavior | Real original-session behavior and visible receipt | Honestly NOTRUN/BLOCKED; durable fixture transcript explicitly is **not Hermes**. | P explicit blocked boundary, not a false-green claim |

## Root causes

- Approval fallback treated a falsy explicit expiry as absent. Empty string therefore inherited generic freshness instead of failing closed. Live transport fidelity was real, but the input matrix omitted the decisive value.
- Freshness and hash binding are separate predicates. A stale-hash rejection can conceal a broken expiry guard; the repair isolates freshness with the exact current hash.
- Notification checks covered useful adapter/inbox behavior but did not establish watchdog progress in the actual long-running stream path. Healthy heartbeats demonstrated that transport liveness is not evidence of independent scheduler progress; exact repair mechanism remains the active owner's work.
- Replay tests covered duplicates/forged parent binding, not different-ID cursor collisions. Schema negatives did not cover container-valued `kind` or Python boolean-as-integer version behavior. Malformed input exposed crash/acceptance paths instead of safe rejection.
- Handoff assertions outran durable run receipts. Passing test totals cannot substitute for criterion-level evidence or for recording the final result.

Affected workflow surfaces: acceptance-contract/coding-agent for the C2 coverage gaps; verification/handoff logging for W. These are observed gaps, not demonstrated defects in skill text. No generic framework or new infrastructure is warranted by this slice.

## Changes

- Approval owner made the minimal shared truthy → nullish expiry correction: only null/undefined get the generic ten-minute fallback; explicit empty/malformed values parse invalid and fail closed. Original frozen acceptance checks were preserved.
- Added nine live expiry/mixed-desktop race checks. The expiry matrix was RED before the product patch: **1 failed / 6 passed**, with empty expiry accepted and nonce consumed. After repair: **9 passed**; the two added races exercised actual signed HTTP versus SDK/built MCP and real engine continuation.
- Independent re-gate `b4147781`: **PASS, 17 live / 39 API / 191 MCP**, plus an independent expiry probe. Earlier passes are historical, not proof that the original candidate was sound.
- Notification repair `b6448c4f` is **ACTIVE in its separate worktree**. No repair result or final readiness conclusion is available here.
- This retrospective adds documentation only. It does not alter the passed approval code fingerprint, source ownership, acceptance assertions, existing skills or concurrent state updates.

Exact approval RED/GREEN/live/regression commands and recorded output remain in the linked approval run under “Focused repair round1”; this note does not invent independent probe commands absent from the supplied receipts. The notification run documents earlier commands/results but lacks the promised final receipts at the time read.

## Prevention

1. For security fallback inputs, distinguish absent, empty, whitespace, malformed, expired and valid values. Exercise the shared guard through the real entry point and assert no durable side effects on refusal. Use an exact current invalid-card hash when testing freshness.
2. Verify timers through the actual runner with a healthy never-ending stream and simulated time across both deadlines. A helper-level watchdog pass or continuing heartbeat is insufficient evidence of scheduled checks.
3. Include distinct-ID/same-cursor conflicts and wrong JSON types in the existing subscriber checks; rejection must preserve progress and avoid process-ending exceptions. Validate exact types before enum membership/version comparison.
4. Persist final command, output, criterion status and candidate identity **before** handoff. Keep implementation passes, independent re-gates and blocked smoke separate; report observed race winners, not all branches the assertions permit.

These are lessons for the next scoped repair/verification, not edits or instructions to expand current source ownership. Keep fixes in existing guards/runner/tests; no extra global policy, service or framework proposed.

## Remaining boundary

Approval's independent gate passed for the tested local synthetic scope; this is not deployment approval or actual Hermes UX completion. Notification remains failed-gate/repair-active pending independent re-verification. Actual Hermes/Pi session wakeup, visible delivery and browser-closed behavior remain blocked, and a fixture transcript must never be relabeled as that proof. No real cards, credentials, traces, production actions or deployment evidence are included.

## Files / Checks

- Sole file written: `docs/ai/runs/2026-10-12-hermes-verification-retrospective.md`.
- Validation is a local, file-scoped whitespace diff check only; no behavioral checks were rerun for this doc-only slice. Check receipt is returned to the parent.
