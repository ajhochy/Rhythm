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

## Setup-choice layout follow-up

The supplied rendered-app reference was inspected locally. It showed the
520px setup dialog placing every profile choice and the ordinary-chat action in
one nonwrapping action row: the leading button was clipped and the last action
wrapped into an unusable narrow column.

The setup flow now keeps its server-returned opaque choices and exact setup key
unchanged, but renders the choices as a bounded, scrollable two-column grid at
desktop widths and a single column at narrow widths. Choices have at least a
48px visual target and wrap their own labels. The ordinary-chat action is a
separate 44px footer action, rather than another squeezed choice. The copy
makes the explicit selection clear: it creates one persistent Rhythm
conversation across projects; the chosen existing profile supplies its
configured model and tools; it does not change permissions. There is no client
default or implied general-coordinator specialist.

The focused intercepted-browser fixture now serves five existing long profile
labels and checks containment, grid-to-single-column reflow, and touch-target
height at 1366px, 390px, and 320px. It also changes ordinary project selection
before opening an existing server-owned primary root, verifying the same
server-returned root/history/composer path remains used.

## Changed paths and source hashes

Base commit: `b60dbddf6cfa87287b2c299b658180fb4dc64e96`.

- `apps/web/src/components/AgentsWorkspace.tsx`
  - preimage Git blob: `3c7a60083f00ea82872a250b5e555ebb302c913f`
  - postimage Git blob: `11749dd5f3d1108cd1bc4519288b2293ea6feda1`
  - postimage SHA-256: `96a9c24c19769b4ad484cceb3249f6cc97f248f305684401d457bebe9b0f8588`
- `apps/web/src/styles.css`
  - preimage Git blob: `5d7198939aa436d481badb2218c142b8f83ee5ed`
  - postimage Git blob: `e3e1009390014f51d29cd436ba6dab5bce924488`
  - postimage SHA-256: `b80012c91444d454224815f90baa3b1c7141eb8146f1d96f3362251f447697c8`
- `apps/web/tests/rhythm-primary-entry.spec.ts` (new)
  - postimage Git blob: `7086061c9261cc44bdb9482a3166bc024b822c1e`
  - postimage SHA-256: `8c18c64d96c780613d28541f210122d76bad6600eee3b1c8ccd9b0549fbba966`
- `apps/web/tests/rhythm-primary-entry.test.mjs` (new)
  - postimage Git blob: `40283631c55693452d7aa14fc757d47fd24dd8fa`
  - postimage SHA-256: `a80e1f2c63b60b4247576ba4ab5dccbeaf0f16ac49a2724147614d9de3b96fc3`

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

- `node --test tests/rhythm-primary-entry.test.mjs` — pass, 9/9 rendered
  `AgentsWorkspace` regressions: one eligible profile/root/composer/no ordinary
  prompt; explicit multi-profile choice; same-key retry; synchronous repeated
  click deduplication; ordinary-chat dismissal/reopen of the same offered
  choices; already-selected root opening; transient empty-row root-detail
  handoff; a real third-chat selection that fences a late completion; and a
  changed ordinary-project selection that still opens the authoritative root.
- The 30 existing coordinator gateway/controller cases passed before this
  final focused component correction; they were intentionally not rerun under
  the bounded-check instruction.
- `npm run typecheck` — pass.
- `git diff --check` — pass.
- Root's authorized intercepted-browser run of the earlier candidate passed
  first-use and multi-profile root/history/composer/no-prompt cases, then
  exposed the already-selected-root trigger and stale retry-copy assertion.
  The updated fixture additionally checks five long choices at desktop, 390px,
  and 320px, plus an ordinary-project change before resolving an existing
  owner root. It was not executed here because this sandbox cannot bind its
  loopback web server. Root must run it with the supplied supported browser
  executable and capture the requested light/dark preview before packaging.

No web lint command exists in this package, and no dependency/network install
was attempted.

## Boundaries and remaining acceptance

- No backend/API/SDK/engine/provider/auth gateway/session authority, mobile,
  Shell/notification, Dayflow/OpenDesign/native host, dependency, config, or
  runtime source changed. The only stylesheet change is the scoped
  `.rhythm-setup*` layout described above.
- The coordinator bearer path is untouched; this repair only consumes the
  already-supported `resolve` and `setup` results.
- No live database/API/model prompt, browser UI, application, engine, or phone
  action occurred. No commit was created.
- Root must still run the intercepted browser test where loopback binding is
  permitted, render light/dark previews at the specified desktop and narrow
  widths, then perform the authorized signed-app click/navigation/reopen
  verification. That runtime check must confirm first-use setup, visible
  profile/retry state, dismissal/reopen behavior, an already-selected root,
  canonical history, ordinary composer, no clipped controls, and absence of an
  unintended SDK/model turn.
