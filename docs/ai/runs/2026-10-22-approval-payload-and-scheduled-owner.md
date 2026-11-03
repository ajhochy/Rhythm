---
date: 2026-10-22
repo: Rhythm
branch: fix/approval-payload-keys-scheduled-owner
pr: null
issues: []
status: draft-pr
tags: [run, rhythm, security, approvals, delegation]
index: "[[Rhythm]]"
---

# Approval token mismatch and delegation ownership 403

Both failures were reported from one Secretary conversation. That conversation was the **scheduled `daily-morning-briefing` run session** (`is_system=1`, `scheduled_task_id` set, `owner_user_id` NULL) after a human replied into it; it was not an interactive root.

## Root causes (not shared)

The shared trigger was a human continuing a scheduled run. The code defects are independent.

- **A, `rhythm_create_task`: "approval token does not match".** The model's `security_payload` used the tool's argument names (`due_date`). The approval digest hashed them as given. `rhythm_create_task` consumes its API payload (`{dueDate}`), so the digests could never match. Consume already treats `due_date` and `dueDate` as the same signed argument (`requireSecurityPayloadBoundToTrustedArguments`); only the digest compared spellings. In the live DB, all **105** `task.create` approvals minted with `due_date` failed, and the 40 minted with `dueDate` succeeded. The first snake_case one was on 2026-08-10. This was latent since payload digests were introduced (`556be7625d` #1134, 2026-07-24, extended to task writes in `e0bdd587a7`, 2026-07-25). It surfaced here because the approval bypass applies only to interactive roots, so this scheduled session went through the approval gate. Not caused by em dash or apostrophe normalization, key order, or double consume: canonicalization sorts keys, and the stored previews match byte for byte apart from the key name.
- **B, `rhythm_delegate_async`: "caller session is owned by another user".** All 33 local scheduled tasks have no `created_by_user_id`. Scheduled-run sessions inherit that owner, so they have been stored ownerless since 2026-07-30 (the last owned one is 2026-07-30T16:06Z). The data transition is not pinned to a single commit; it coincides with schedules moving to local SQLite (`04b247417a`, 2026-07-28). The strict owner check (`e45769de71`, 2026-07-28; bearer identity in `040e2ecf95`, 2026-08-05) compares the operator's bearer (user 1) with NULL. The check was correct; the session's ownership data was missing.

## Fix

- A: `securityPayloadDigest` normalizes top-level field names to one spelling before hashing. Values stay exact, single use is unchanged, a payload naming one field twice is refused, and existing camelCase digests are unchanged.
- B: scheduled runs take the schedule creator or the local operator (`localOperatorUserId()`: sole paired mobile user, loopback SQLite only, null when ambiguous). This is the same rule bearer-less local session creation already used; that controller now shares the helper. An idempotent boot backfill attributes existing ownerless scheduled sessions; otherwise the write-path fix would leave old rows broken. The strict owner check is unchanged.
- `tools/dev/sandbox.sh` now forwards the documented `HUMAN_APPROVAL_*` pair. `env -i` had dropped it, so no desktop-human live suite could approve anything.

## Checks

| Check | Result |
|---|---|
| Unit regression A (`issue_1134_external_content_security.test.ts`) | RED 403 on the exact payload before the fix, then GREEN. Includes altered-value refusal, single use, and two-spellings refusal. |
| Unit regression B (`scheduled_session_operator_owner.test.ts`) | GREEN 4/4: operator rule, creator precedence, backfill scope, owner gate. |
| Neighboring approval/delegation/session suites | **90/90** across 13 files. API and web `tsc` pass. `bash -n tools/dev/sandbox.sh` passes. |
| Live Playwright, sandbox only (`apps/web/tests/contract/approval-owner-live.spec.ts`) | Final code **2/2 passed** (2.3 min). Unfixed code: both failed (legacy session owner NULL; run owner NULL). Digest fix withheld: A failed with the exact live error `Blocked: approval token does not match the exact outbound action and payload` while B passed. |
| GitNexus detect-changes | LOW, 0 affected flows. The index is stale; manual blast radius covered approval consume and minting, the scheduler owner, and session creation. |

The live run used ports 7493–7496 and 4175, a synthetic fixture, a loopback scripted model, and the throwaway approval key. The user's live Rhythm on 4001/4096 was untouched.

## Notes / follow-ups

- **Async delegation from a scheduled run stays refused by design** (#1123: interactive chat only). With ownership fixed, the reported session now gets `async delegation is only available in interactive chat sessions` instead of a misleading 403. Synchronous `rhythm_delegate` works and is covered by the live test. Allowing async delegation once a human takes over a scheduled run is a product decision.
- `rhythm_delegate_async` and `rhythm_delegate` consume the approval before the API call, so a refused delegation burns the token (approval `78a47149` was consumed at 15:24:58 and then refused).
- The web UI in browser live mode cannot list or decide approvals or load Tasks by itself. The gateway strips `Authorization` on local calls and sends the capability only on decisions; Electron supplies that privileged side. The live spec plays it explicitly.
- These fixes are on `main`. The running `test/feature-playwright-2026-10-19` build needs them cherry-picked to benefit.
