---
date: 2026-08-11
repo: Rhythm
branch: mobile/smart-client-rebuild
pr: TBD
issues: [1270, 1308, 1311, 1364, 1366, 1363, 1247, 1175]
status: complete — awaiting manual smoke
tags: [run, Rhythm]
---

# Mobile smart-client rebuild — RN transport restored

## What this run actually was

Mega PR #1368 (merged) landed the **server-side** halves of the mobile
workstream but lifted the **React Native client-side** halves off the branch in
`f4c7c352` ("chore(mega): lift mobile RN-app transport off the mega PR"), to
keep the contract fingerprint locked to non-mobile fork-SDK ops. This run
restores that RN transport onto main.

The revert commit preserved the pre-revert tree at branch
`mobile/2026-08-10-rebuild`, which turns out to be **main's own first parent**
(main = that commit merged with the mega branch). So the restore target was
exact and unambiguous: `git diff main mobile/2026-08-10-rebuild -- apps/mobile`
is precisely the lifted work. No re-derivation was needed.

## Scope note — the plan doc does not describe this work

`docs/ai/plan-mobile-smart-client.md` was handed over as "the rebuild
approach." It is not. It is a *proposed* phased plan (Phases 0–4) for making
the phone a client of the api_server mirror instead of a raw-engine proxy,
mapped to issues **#1378 / #1379**, with four open decisions explicitly listed
as needing a call before Phase 1/2 land. It shares no issues with the six named
in this task.

**Call made:** implemented the actual deliverable — the RN transport rebuild for
the six named issues, which is what the requested PR title describes. Did not
start Phase 0–3 of the smart-client plan. Those are a separate, larger,
still-undecided body of work (see "Follow-ups").

One incidental overlap: the restored #1247 SSE-handshake permission replay is
the same shape as the plan's Phase 2 "reconnect replay" idea, at the fake-server
test-harness level.

## Files

Restored from `mobile/2026-08-10-rebuild`, applied per issue so each commit is
independently green. `apps/mobile/providers/opencode-provider.tsx` is touched by
three separate issues; main's copy was verified byte-identical to `54a20348^`,
so the three original per-issue diffs for that file replayed in sequence and
applied cleanly (`--3way`, no conflicts). Final `opencode-provider.tsx` is
byte-identical to the preserved branch.

| Commit | Issue | Substance |
|---|---|---|
| `02bb1c24` | #1270 | New-chat creation hard-failed unless a profile was literally named "Secretary"; now falls back to the first selectable profile. Shared `NO_SELECTABLE_PROFILE_MESSAGE` between the provider throw and the sheet copy. |
| `9598621d` | #1308, #1311 | Both attachment guards (picker + base64 read) hard-coded `10 * 1024 * 1024` independently of `MOBILE_ATTACHMENT_LIMIT_BYTES`, which the api_server gateway body-limit contract cross-validates. Now import the constant. |
| `ab900d8f` | #1364, #1366 | Scope-generation fencing + exact-session pinning; `open-project-session` resolves the exact session via scoped `session.get` **before** owner-unscoped discovery (which deliberately excludes registered project sessions, so its `undefined` is not authoritative). Includes follow-up `8cc593cc`. |
| `ea114f9b` | #1247 | Fake-server replays `pendingPermissions` on SSE subscribe + its contract test. |
| `263bac55` | #1175 | `eas.json` `ascAppId` restored; preflight guard added. |

### Two findings beyond a straight restore

1. **`eas.json` lost `ascAppId` (`6796011479`).** The revert reset `eas.json`
   to a *pre-#1175* state, undoing `8f815d05`. Without it,
   `eas submit --non-interactive` prompts for the App Store app and fails in CI.
   Nothing asserted the field, which is how it was dropped unnoticed — the iOS
   preflight only checked that `submit.production.ios` *existed*, so an empty
   `ios: {}` passed. Tightened to require a non-empty `ascAppId`, and verified
   the guard fails on the reverted shape and passes on the restored one.
2. **`issue-1247.test.mjs` was orphaned.** It had no npm script on the
   pre-revert branch, so nothing ever ran it. Added `test:contract:1247`
   (matching the 1224/1225/1233 convention) and wired it into `test:ci:static`.

### Contract anchors — deliberately NOT touched

The revert intentionally kept four anchors on mega. All four verified identical
to main on this branch, and identical to the pre-mega branch (they never
diverged):

- `apps/mobile/contracts/rhythm-opencode-contract.json` — **136 ops**
- `apps/mobile/contracts/rhythm-opencode-classifications.json`
- `apps/mobile/lib/pairing/paired-host-store.ts`
- `apps/mobile/tests/rhythm-opencode-contract.test.mjs`

**No fingerprint bump, no re-pair.** This satisfies the plan doc's hardest
constraint even though the plan itself wasn't implemented.

## Checks

Baseline on main before any edit: tsc clean, jest 15 suites / 53 tests.

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `eslint .` | exit 0 (2 pre-existing warnings, 0 errors) |
| `jest` | **61/61**, 16 suites (was 53/15 — `session-lifecycle-tier` + `session-service` restored) |
| `npm run test:ci:static` | **exit 0** (full suite) |
| `contract:check` | exit 0 |
| `test:contract` | passed |
| `test:paired-host` | passed (23 scenarios) |
| `test:pairing-compatibility` | 0 fail |
| `test:contract:1247` | 1/1 |
| `msp-002-profile-first-sessions` | 9/9 |
| fake-server self-test | passed |
| **`playwright test`** | **71/71 passed** (2.2m) — the suite #1364's regression broke |
| api_server `mobile_gateway_surface` + `issue_1169_mobile_opencode_proxy` | 17/17 |
| api_server `session_binding_cleanup` (#1363) | 3/3 |

`#1363`'s binding-repair CLI tool (`session_binding_cleanup.ts`) was never
reverted — it is server-side and already on main. Verified intact, not
re-applied.

Also confirmed on main and left alone: the server halves of #1308/#1311, where
main's `sanitizedUpstreamError` **supersedes** the original 4xx-passthrough fix
(it preserves the upstream status instead of synthesizing 502).

Test processes cleaned up; regenerated `.proof/**/*.png` screenshots reverted.

## Notes

- Manual smoke is still outstanding — everything above is automated evidence.
  The device-level behavior to check is #1364's ready state: create a new chat
  and confirm it reaches "Start a new task" rather than flashing missing-session.
- The plan doc `docs/ai/plan-mobile-smart-client.md` was untracked; committed
  with this run log so the PR carries its own context.

## Follow-ups

- **#1378 / #1379 (the actual smart-client plan) remain unimplemented.** Its
  four open decisions still need a call before Phase 1/2 can land — chiefly
  mirror authority vs. live backfill, and whether genuinely-new mobile-native
  DTOs get a contract version separate from the engine fingerprint.
- No guard exists preventing a future branch-split from silently dropping RN
  files again. The `ascAppId` guard closes one instance; the general case
  (a revert quietly reverting shipped fixes) is unaddressed.
