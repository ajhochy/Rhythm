---
date: 2026-09-15
repo: Rhythm
branch: feature/ios-end-to-end
pr: 1493
issues: [ios-mobile-ui, mobile-ci-e2e]
status: blocked_on_deploy
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

## Ship

Triaged the Server CI failure on `feature/ios-end-to-end` at `f25abeed` and
resolved it without touching product code. Classification: infrastructure/
timing flake in a test that already lives on `main` — **not** a regression
from this branch.

Evidence: (a) `f25abeed` touches zero `apps/api_server` files; (b) both
`apps/api_server/src/__tests__/workflow_failure_signal_extractor.test.ts` and
`apps/api_server/src/services/workflow_failure_signal_extractor.ts` are
byte-identical to `main` (the test file was last touched in `0bc46a5e`,
already on `origin/main`); (c) Server CI passed on this same branch at
`57b99510` (run 34908760452) with identical extractor code.

Root cause: `detectStaleRedoSignals` (`workflow_failure_signal_extractor.ts:528`)
stable-sorts a group by `createdAt` and reads `sorted[last]` as the "latest"
attempt, then applies the #936 stale-fixed safeguard. `AgentSessionsRepository
.listAll` is `ORDER BY created_at DESC`, so when the failing test's two
sessions (`s1` closed, `s2` error) are inserted within the same tick, the
stable sort keeps DESC order and `sorted[last]` resolves to `s1`, tripping the
safeguard and suppressing the stale-redo signal — the observed "expected
undefined to be defined" at test line 764. The sibling test in the same
`describe` block backdates `s1` by 60s for exactly this reason; the failing
test omits that guard. Local run: stale-redo tests passed 3/3, consistent with
an intermittent same-tick collision that only fires on a fast/loaded runner.

Action taken (flake path, used exactly once): `gh run rerun --failed
35038680724`, watched with `--exit-status` → 0. Both checks are now green at
`f25abeed`: Server CI run 35038680724 = success, Mobile CI run 35038680725 =
success. PR #1493 rollup: `foundation` = SUCCESS, `server-checks` = SUCCESS,
`live-postgres-bootstrap` = SUCCESS. The PR is open, still draft, head
`f25abeed`, local and origin in sync. The Mobile CI `foundation` job that had
failed on every push since 2026-09-13 is confirmed fixed by `f25abeed`'s E2E
web change.

No product code, tests, or docs were modified in this step. No deploy actions;
no live ports (4001/4096) or other lineages' sandboxes touched; nothing
merged, force-pushed, or deleted.

**CI runs (head f25abeed1b5da18570b96bd6bbe950842defd6f5):**

| Workflow | Conclusion | Run |
|---|---|---|
| Mobile CI | success | https://github.com/ajhochy/Rhythm/actions/runs/35038680725 |
| Server CI | success | https://github.com/ajhochy/Rhythm/actions/runs/35038680724 |

**Follow-up filed, not fixed here** (pre-existing on `main`, out of scope for
a non-regression fix on this branch):
`apps/api_server/src/__tests__/workflow_failure_signal_extractor.test.ts:764`
("issue-933-c7: stale-redo … reworking the same issue # signals when the
latest attempt is still not clean") needs the same one-line backdate as its
sibling test: `rawUpdate('agent_sessions', s1.id, { created_at: new
Date(Date.now() - 60_000).toISOString() })` before extraction. Worth a GitHub
issue so it stops randomly reddening unrelated PRs.

PR #1493's body was deliberately not edited in this step (the flake path does
not authorize a body edit).

## Deployment handoff

Deployment (image publish, NAS container recreate, desktop relaunch) is out of
scope for this workflow — AJ performs it. Required before the live acceptance
gate can re-run:

1. Run the GitHub workflow **"API Image Publish (GHCR)"**
   (`api_deploy_synology.yml`) on `feature/ios-end-to-end` and wait for it to
   complete.
2. On the NAS (`ssh <user>@192.168.50.231`; `cd /volume1/docker/Rhythm/api_server`):
   `sudo docker compose -f docker-compose.synology.yml --env-file .env.production pull`,
   then `sudo docker compose -f docker-compose.synology.yml --env-file .env.production up -d rhythm-relay`
   (required even after Watchtower — Watchtower recreates containers with the
   **old** environment, so the new `RHYTHM_RELAY_PUBLIC_URL` in `.env.relay`
   only takes effect via `compose`).
3. Verify: `curl -s https://api.vcrcapps.com/health` (commit must equal
   `f25abeed1b5da18570b96bd6bbe950842defd6f5`) and
   `curl -s https://api.vcrcapps.com/relay/health`.
4. Relaunch `/Applications/Rhythm.app` (Cmd+Q, then reopen) so its local API on
   `127.0.0.1:4001` comes back up and restores the Mac relay uplink (relay
   health should then show `macOnline:true`).
5. Re-run the live acceptance stage from the top so Step 1 readiness checks
   can pass and Step 2 (simulator build/verify) can proceed.

## Accept

**Status: BLOCKED.** All three readiness checks failed, so per the acceptance
procedure no build/install/launch/simulator interaction was performed and
criteria 2–7 could not be attempted.

Observations:

- Hosted API commit: `https://api.vcrcapps.com/health` returned
  `9c027b527ba18c147e2f9f875b0f593b70cd95f5` (builtAt 2026-09-13T17:00:07Z),
  required `f25abeed1b5da18570b96bd6bbe950842defd6f5` — **FAIL** (relay-fix
  deploy has not happened).
- Relay mobile-gateway health: `macOnline:false`, `lastUplinkAt
  2026-09-14T23:13:45.386Z`, host `34de4a8b-79b0-4df5-a468-bf2a7842a905`,
  `status:ready` — **FAIL** (required `macOnline:true`; unchanged from the
  prior readiness snapshot). `/relay/health` shows the same: `status ok, role
  relay, macOnline false`.
- Desktop `http://127.0.0.1:4001/health` (single read-only GET, per hard
  rules): curl exit code 7, connection refused — **FAIL** (consistent with the
  desktop OOM tracked in PR #1494).
- No simulator, build, install, launch, git, or server actions were taken —
  correctly withheld under the BLOCKED branch of the procedure. No screenshots
  captured (Step 2 never started); screenshot dir reserved at
  `/private/tmp/rhythm-ios-acceptance/`.

This confirms the deployment-side blockers are still unresolved as of this
check: the image is not published / relay container not recreated, and the
desktop app (hence port 4001) is still down.

Remaining before this gate can pass:

- Re-run Step 1 readiness checks after AJ completes the deploy actions above.
- Step 2: build/codesign/install/launch verification of criterion 1 (sign-in
  without pairing) and criterion 6-lite (redesigned recovery card / general
  UI) — not yet attempted.
- Criterion 2 (real chat list load, counts/timing) — blocked on hosted commit
  + relay uplink.
- Criterion 3 (open 3+ real conversations, transcript rendering, scroll/
  selection preserved) — blocked.
- Criterion 4 (responsiveness timing: cold open, list→conversation, scroll
  smoothness) — blocked.
- Criterion 5 (network interruption / background-foreground reconnect test) —
  blocked.
- Criterion 6 full pass (light/dark appearance, Dynamic Type clipping check) —
  blocked, needs a working session to exercise real screens beyond the static
  recovery card.
- Criterion 7 (AJ-only designated-conversation send test) — out of scope for
  this verifier regardless of readiness; AJ must perform it.
- VoiceOver/contrast accessibility pass on the redesigned screens — not
  covered by this acceptance run at all; would need a separate pass.
- Close-out run doc recording PASS/FAIL per criterion — not written since the
  gate never reached Step 2; this section is the current close-out state until
  a rerun happens.
