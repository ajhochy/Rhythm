---
date: 2026-09-15
repo: Rhythm
branch: feature/ios-end-to-end
pr: 1493
issues: [ios-mobile-ui, mobile-ci-e2e]
status: ready_for_verification
tags: [run, Rhythm]
---

# iOS mobile bootstrap recovery finished and web E2E restored

## Files

- `apps/mobile/components/settings/paired-mac-section.tsx` — a signed-in
  bootstrap failure now adds an explicit primary "Retry connection" action that
  calls `retryBootstrap`. Manual pairing stays reachable as a secondary action
  instead of being replaced, so a Rhythm Cloud outage is never a dead end, and
  the action stays pressable even with a stale host on record.
- `apps/mobile/app/(tabs)/settings.tsx` — passes `bootstrapState` and
  `onRetryBootstrap` through to the section.
- `apps/mobile/components/chat/chat-list.tsx` — the empty state keys off
  `isAccountBootstrapFailure(...)` rather than only `unsupported`, so every
  terminal failure shows "Computer connection unavailable" + "Retry connection"
  instead of a false "No chats yet". The offline-cache warning is suppressed
  only while that recovery state is actually on screen (`rows.length === 0`),
  so cached chats keep their offline banner.
- `apps/mobile/lib/pairing/mobile-environment-contract.ts` — owns the
  `AccountBootstrapState` union and `isAccountBootstrapFailure`, the single
  predicate both surfaces use.
- `apps/mobile/lib/pairing/paired-host-store.ts` — bootstrap failure copy keeps
  the transport-sanitized detail (`ApiError`/`PairedHostError` message only) and
  appends the recovery sentence. `apply()` also clears `bootstrapState` once a
  host is on record, so a manual pairing after a failed discovery no longer
  leaves the stale failure in front of the real reachability state.
- `apps/mobile/tests/settings/paired-mac-section.test.tsx` (new),
  `apps/mobile/tests/chat/chat-list.test.tsx`,
  `apps/mobile/tests/contract/ios-account-connect.test.mjs`,
  `apps/mobile/tests/paired-host.test.mjs` — cover all four failure states on
  both surfaces, a stale cached host, cached chats during a failure, message
  sanitation, and pairing clearing the stale bootstrap state. The last two were
  mutation-checked (they fail when the guard is removed).
- `apps/mobile/tests/contract/e2e-ui-labels.test.mjs` (new),
  `apps/mobile/package.json`, `apps/mobile/tests/app-config.test.mjs` — new
  `test:e2e:labels` guard, wired into `verify:foundation` immediately before
  `test:e2e:web` (and into the pinned script string that `test:app-config`
  asserts).
- `apps/mobile/tests/e2e/*.spec.mjs` (11 files) — locator names realigned with
  the shipped UI: 5x tab `Agents`->`Chats`, 17x `Agents menu`->`Chats menu`,
  2x heading `Agents`->`Chats`, 1x `Paired Mac`->`Mac connection`,
  4x `getByRole('tab', { name: /Agents$/ })`->`/Chats$/`, the ambiguous
  `getByText('Connection')` narrowed to the `Connection Connected` button, and
  the Add-provider option addressed as a `radio` (the redesign's `NativeSelect`
  renders options with `accessibilityRole="radio"`, not `button`).

No `apps/api_server` change: the root cause is entirely in `apps/mobile`.

## Checks

- `npx jest tests/settings tests/chat --runInBand` — 7 suites, 44 tests passed.
- `node --test tests/contract/ios-account-connect.test.mjs` — 8/8 passed.
- `node ./tests/paired-host.test.mjs` — exit 0 (24 scenarios).
- `node --test tests/contract/e2e-ui-labels.test.mjs` — 3/3 passed; 3/3 failed
  before the spec fix and 1/3 under a mutation, so the guard is not vacuous.
- `npm run test:e2e:web` full suite, run 1: 63 passed / 8 failed, run 2: 65/6,
  run 3: 66/5. Each round removed one class of deterministic drift.
- `npm run test:e2e:web -- tests/e2e/pairing.spec.mjs` — 9/9 passed (9 failed
  before manual pairing was restored alongside the retry action).
- `npm run test:e2e:web -- tests/e2e/issue-1237-paired-reachability.spec.mjs` —
  5/5 passed after the `apply()` fix (c1 failed in all three full runs before).
- `npm run test:e2e:web` full suite, run 4 (local, `retries: 0`): 68 passed /
  3 failed, all three the overflow-menu stall below — no drift left.
- `CI=1 npm run test:e2e:web` (exactly what the `foundation` job runs, so
  `retries: 2`): **exit 0** — 65 passed, 6 flaky (every one recovered on retry),
  0 failed, 5.8 min.
- `npm run test:ci:static` — exit 0.
- `npm test` — 31 suites, 122 tests passed.
- `git diff --check` — clean (exit 0).
- GitNexus `impact` before each edit: `PairedMacSection` LOW (1 caller),
  `ChatList` LOW (1 caller), `PairedHostStore.apply` MEDIUM (5 direct callers,
  Pairing module; the change is additive). `detect_changes` reports 24 changed
  symbols across 19 files, all under `apps/mobile`.

## Notes

### Mobile CI root cause (job `foundation`, run 34908760174)

Not auth or bootstrap gating. Commit 9c027b52 renamed the user-facing strings of
the E2E-visible UI — tab title `Agents`->`Chats` (`app/(tabs)/_layout.tsx`),
overflow anchor `Agents menu`->`Chats menu` and screen header `Agents`->`Chats`
(`app/(tabs)/agents.tsx`), settings section `Paired Mac`->`Mac connection`
(`components/settings/paired-mac-section.tsx`) — and updated the Jest test for
the overflow menu but not `tests/e2e/**` (`git diff 0bc46a5e..HEAD --
apps/mobile/tests/e2e` was empty). Every spec then timed out on locators for
names nothing renders. The E2E cloud-session path was never intercepted: in E2E
mode `RhythmAccountProvider` seeds `signedIn`, `app/index.tsx` redirects to
`/(tabs)/agents`, and the CI failure snapshots all show `tab "  Chats"
[selected]` with a populated chat list.

The fix is the spec realignment plus `test:e2e:labels`, which derives the tab
titles and menu labels from the app source and fails in under a second instead
of after a 15-minute Playwright run.

### Two defects the label fix exposed

1. In E2E web `expo-secure-store` has no web backend, so the cloud token read
   throws and bootstrap always lands in `retryableError`. The recovery slice
   replaced the "Pair a Mac" button with "Retry connection", which removed the
   only manual escape hatch and failed 9 pairing specs. Both actions now render,
   retry first — also the correct behaviour during a real Rhythm Cloud outage.
2. After a manual pairing, `bootstrapState` kept its earlier failure value, so
   Chats showed "Computer connection unavailable" instead of the paired-but-
   unreachable offline card (`issue-1237-c1`). `apply()` now clears it whenever
   a host is on record.

### Flaky, not drift

Six specs (`flows.spec.mjs:278`, `:291`, `:319`, `:338`,
`issue-1172-deltas.spec.mjs:37`, `issue-1174-parity.spec.mjs:60`/`:149`) each
failed in some full runs and passed in others; `:278` and `:319` both pass on
their own (27 s), and the CI-equivalent run recovered all of them on retry. The symptom is always
the same: the click on an overflow anchor focuses it but the Paper menu never
mounts — the boot/interaction stall the Playwright config already documents
(#1287) and covers with `retries: 2` in CI. Local retries are 0, so they surface
here. Worth a separate look: the failures cluster right after a test that runs a
full assistant turn, which suggests fake-server event backlog rather than pure
CPU starvation.

### Known gap (out of scope)

`bootstrapState === 'environmentSelection'` (an account with more than one
enrolled computer) has no UI: `environments` and `connectEnvironment` are
exposed by the provider but consumed by no screen, so such an account would see
a false "No chats yet". Not a failure state, so it is outside this slice; it
needs a computer-picker design. AJ's account has one enrolled computer.
