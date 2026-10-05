---
date: 2026-10-05
repo: rhythm
branch: codex/rhythm-primary-entry-repair-20261005
pr: null
issues: [rhythm-primary-entry-repair]
status: in-review
tags: [run, rhythm, web, coordinator, primary-entry]
---

# Rhythm primary-entry first-use repair

## Scope

Source-only repair for the desktop web Agents rail's permanent `Rhythm` entry.
The observed signed-in click received the valid closed `setup_unavailable` resolve
result, but only placed an inaccessible status message and a later menu item in
state. It never invoked the existing closed setup exchange.

`AgentsWorkspace` now immediately advances that result through the existing
server-owned setup operation. A single eligible profile proceeds to the returned
server root; multiple profiles render an explicit choice dialog. Waiting/error
state is visible, setup failure exposes an exact-key retry, and two synchronous
entry clicks are admitted as one operation. Dismissing the dialog now hides it
without discarding the local exact setup pointer; reopening the permanent entry
shows the same choices without allocating a new request. A navigation revision
also starts the existing coordinator open/history/composer path when the
server-returned root was already selected. No ordinary SDK prompt is sent by
opening.

## Changed paths and source hashes

Base commit: `b60dbddf6cfa87287b2c299b658180fb4dc64e96`.

- `apps/web/src/components/AgentsWorkspace.tsx`
  - preimage Git blob: `3c7a60083f00ea82872a250b5e555ebb302c913f`
  - postimage Git blob: `812c49dff6ab2f2d199be130d78ef64501c73903`
  - postimage SHA-256: `958e79e57772fbfd8b04c3c824d818ee8491fd2cc5339b947173c7e7953c23e2`
- `apps/web/tests/rhythm-primary-entry.spec.ts` (new)
  - postimage Git blob: `370a52122b28da6b36e44da0d91e05bf37a53045`
  - postimage SHA-256: `acf467069b9e6fdc993b0245e1a80f69cbe22ac7b6a3348cae767dfb80f3d0a0`
- `apps/web/tests/rhythm-primary-entry.test.mjs` (new)
  - postimage Git blob: `dc28b8d8adb7946c94eab8a0b4b06c270a35aa53`
  - postimage SHA-256: `15709d74ba40066cd38a29267db8363d9ac77f4b62509e57b8a7d9b0c5323af0`

`git diff --check` passes. The only pre-existing worktree artifact is the
read-only shared `apps/web/node_modules` symlink; it was not modified.

## Manual impact scope

Bounded GitNexus CLI impact queries for `openRhythmPrimary`,
`navigateRhythmRoot`, and `startRhythmSetup` returned `Repository not found` for
this isolated checkout. Risk is therefore **UNKNOWN**, not a GitNexus pass; no
index registration, rebuild, or original-checkout index was used.

Manual caller/path review covered:

- `SessionRail`'s `onOpenRhythm` primary entry and opening disable state.
- `openRhythmPrimary` resolve → setup/root navigation handoff.
- `startRhythmSetup` profile-choice, exact-key retry, and server-root paths.
- `navigateRhythmRoot`'s actor/gateway/selection fences and `selectLiveSession`.
- the already-selected server-root handoff, whose ref mutation otherwise would
  not retrigger the coordinator-open effect.
- the temporary empty live-session row emitted while a just-created root's
  detail is loading, versus a real third-session user navigation.
- the selected-root coordinator effect that opens canonical history and retains
  the normal composer.
- setup dialog Escape/close and ordinary-chat dismissal, while preserving the
  exact in-memory pending setup key and opaque offered profile choices.

## Checks

- `node --test tests/rhythm-primary-entry.test.mjs` — pass, 8/8 rendered
  `AgentsWorkspace` regressions: one eligible profile/root/composer/no ordinary
  prompt; explicit multi-profile choice; same-key retry; synchronous repeated
  click deduplication; ordinary-chat dismissal/reopen of the same offered
  choices; already-selected root opening; transient empty-row root-detail
  handoff; and a real third-chat selection that fences a late completion.
- The 30 existing coordinator gateway/controller cases passed before this
  final focused component correction; they were intentionally not rerun under
  the bounded-check instruction.
- `npm run typecheck` — pass.
- `npm run build` — pass. Vite emitted its existing chunk-size advisory only.
- Root's authorized intercepted-browser run of the earlier candidate passed
  first-use and multi-profile root/history/composer/no-prompt cases, then
  exposed the already-selected-root trigger and stale retry-copy assertion.
  The four-case fixture now also covers Escape and Keep using ordinary chat
  dismissal/reopen, but this final fixture was not executed here because this
  sandbox cannot bind its loopback web server. Root must run it with the
  supplied supported browser executable.

No web lint command exists in this package, and no dependency/network install
was attempted.

## Boundaries and remaining acceptance

- No backend/API/SDK/engine/provider/auth gateway/session authority, mobile,
  Shell/styles, Dayflow/OpenDesign/native host, dependency, config, or runtime
  source changed.
- The coordinator bearer path is untouched; this repair only consumes the
  already-supported `resolve` and `setup` results.
- No live database/API/model prompt, browser UI, application, engine, or phone
  action occurred. No commit was created.
- Root must still run the intercepted browser test where loopback binding is
  permitted, then perform the authorized signed-app click/navigation/reopen
  verification. That runtime check must confirm first-use setup, visible
  profile/retry state, dismiss/reopen behavior, an already-selected root,
  canonical history, ordinary composer, and absence of an unintended SDK/model
  turn.
