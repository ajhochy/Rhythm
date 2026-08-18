---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: []
status: pass
tags: [run, Rhythm, post-m1, phase-1, electron, parity]
---

# Phase 1 host trust closed to 11/19, and the parity corpus re-based

Unit D (Codex) implemented the Electron host gaps; the orchestrator audited, repaired one regression,
supplied the packaged evidence Codex cannot produce, and corrected three generator defects. Nothing
committed.

## Scoped off an audit, not off the criterion text

Two of the three "gaps" would have been dead code, and their tests were source-text regexes that dead
code satisfies:

- `main.mjs` **spawns no child processes**, so `post-m1-p1-c4d`'s owned-child registry would guard an
  empty set. Recorded `not_tested`, re-opens when the host takes over spawning the local API/engine
  the way Flutter's `ApiServerService` does.
- The host **never calls `dialog.*`**, so the dialog half of c4b would guard a surface that does not
  exist. Split out as `post-m1-p1-c4b-dialog`, `not_tested`, re-opens on the first native-dialog call.

What was real: no single-instance lock, and no validation of an incoming deep-link URL even though
`rhythm://` is a registered privileged scheme.

## Implemented

`validateDeepLink` in `policy.mjs` fails closed and **reuses the existing `validateRequest`** rather
than growing a second traversal check beside it. `deepLinkFromArgv` is a pure exported function, so
the argv path is behaviorally testable without launching Electron. `main.mjs` acquires the
single-instance lock, quits when it loses, and routes `second-instance` and `open-url` through one
shared validation funnel.

`post-m1-p1-c4c` stopped being a source-text match: its lock/deep-link string regexes became
behavioral argv cases, with one narrow source assertion left only for the Electron-only binding that
cannot be observed without a launch.

## Regression the orchestrator caught and fixed

The unit placed `app.requestSingleInstanceLock()` at module top level, **above** the
`app.setPath('userData', …)` redirect. `requestSingleInstanceLock()` makes Electron materialize the
userData directory to place its lock, so the default path was created before the redirect:

```text
not ok 6 - slice-7-c6: packaging is deterministic, gitignored, and leak-free
  slice-7-c6: stale persistent userData exists before the smoke:
  /Users/ajhochhalter/Library/Application Support/rhythm-electron-shell
```

This is the documented Electron userData trap, and `slice-7-c6` caught it exactly as designed. Fixed
by moving the redirect (and the smoke-dir cleanup registration) above the lock, so an instance that
yields still reaps what it created. The leaked directory was removed;
`~/Library/Application Support/Rhythm` — the live app's data — was never touched. Packaged suite
returned to 6/6.

## Packaged evidence for `post-m1-p1-c4e`

A pure-function test cannot prove a single-instance lock, so the orchestrator added
`apps/electron/test/post-m1-phase-1-packaged-host.test.mjs`: two launches of the **packaged** binary
against ONE shared userData (Electron keys the lock on userData — separate dirs would both win and
prove nothing), asserting exactly one host runs and the yielding launch exits 0.

First version was a race: a cold first launch could finish its ~1.2s smoke before the second started,
both would emit receipts, and one run failed that way. Rewritten to retry at 250/120/60 ms gaps and
to treat "both ran" as **inconclusive, never a pass**. Stable 3/3 afterwards.

Mutation-proved, twice — replacing `app.requestSingleInstanceLock()` with a constant `true` and
rebuilding:

```text
not ok 1 - post-m1-p1-c4e: a second packaged launch yields to the first...
  never observed two overlapping launches contend for the lock, so single-instance behaviour is unproven:
  gap 250ms: both launches ran, so they never overlapped
  gap 120ms: both launches ran, so they never overlapped
  gap 60ms:  both launches ran, so they never overlapped
```

Reverted and repackaged; passes again.

## Two Phase 1 criteria were never red

- **c3c/c3d** drove `?state=update-error` / `?state=provider-error`, which `ToolWorkspace.tsx` does not
  define. Re-pointed at the real vocabulary (`unavailable`, `server-error`) and asserted a live region
  rather than pinning `role="alert"`, since `unavailable` is legitimately a status. Every other
  constraint kept: visible action, ≤280 characters, no disclosure. Both **pass** — the app already had
  bounded, actionable, redacted failure states.
- **c2a** flipped fail → pass with no product change. Re-ran isolated: 2/2 at 12.0s and 12.2s against a
  20s global budget. It was a load timeout, not missing behaviour. Given `test.setTimeout(60_000)`
  following the `tasks.spec.ts` precedent, so a slow machine cannot masquerade as a product gap.

## Phase 1 disposition

```text
pass 11 · red 3 (c2c, c2d, c3b) · pending 3 (c1b live, c2e/c3e packaged manual) · not_tested 2
```

## Corpus re-based — three generator defects

None of these changed the total review queue (708 before and after); they changed where the work is.

1. Flutter now read from `origin/main` (`9fa2761e`), fails loudly on a bad ref.
2. `categoryFor` matched stems with a trailing `\b`, which is dead against `_` and plurals:
   `facilit` could never match `facilities`, `\bnotification\b` never matched `notifications/`,
   `\blive artifact\b` never matched `live_artifacts_*`. 175 review rows left the catch-all bucket.
   **`live-artifacts` went from 1 mapping to 78.**
3. `apps/electron` was never a scanned surface, so M1's own shell and package evidence was invisible.
   Added: 14 rows, all retained test declarations.

Re-weighted program: **858 units. Phase 10 is 28.7%, not 48.4%. Phase 5 is 25.3%** and becomes the
second-largest block, mostly `mcp-skills-commands` rising 104 → 195. `profiles-providers-models` and
`ownership-isolation` are still genuinely 0, so Phase 2's BUILD framing survives; Phase 8's does not
survive unexamined and is flagged in the plan.

## Checks

```text
node --test apps/electron/test/post-m1-phase-1-host-policy.test.mjs      2 pass 0 fail
node --test apps/electron/test/post-m1-phase-1-packaged-host.test.mjs    1 pass 0 fail (3/3 stable, mutation-proved)
node --test apps/electron/test/electron-shell.test.mjs                   5 pass 0 fail
node --test apps/electron/test/electron-unsigned-package.test.mjs        6 pass 0 fail
npx playwright test --config tests/post-m1-phase-1-fixture-playwright.config.ts  5 pass 3 fail (intended RED)
node --test tools/validation/test/desktop-parity-matrix.test.mjs         6 pass 0 fail
node --test tools/validation/test/desktop-parity-flutter-ref.test.mjs    2 pass 0 fail
generator: sources=10930 mappings=10930 behaviors=17 review_required=708 flutter_sha=9fa2761e
```

## Still open

- c2c/c2d: focus does not return to `account-button` / `nav-more` after menu activation.
- c3b: an edited session setting does not survive renderer reload.
- c1b (live readiness), c2e (packaged keyboard/VoiceOver), c3e (packaged relaunch) — orchestrator-run,
  not yet performed.
- OS-level URL-handler registration (`setAsDefaultProtocolClient`, `CFBundleURLTypes`) is deliberately
  out of scope; until it lands, only CLI/argv-delivered URLs exercise the deep-link funnel.
- The new packaged single-instance check is not yet a `verify-all.mjs` component; wire it in together
  with c2e/c3e so all Phase 1 packaged checks join the runner in one change.
