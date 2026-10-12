---
date: 2026-10-05
repo: rhythm
branch: codex/rhythm-primary-entry-repair-20261005
pr: null
issues: [rhythm-primary-composer-restart-repair]
status: unverified
tags: [run, rhythm, web, coordinator, composer]
---

# R5 — inert primary coordinator composer after restart

## Scope

Source-only desktop web repair after the supplied normal-app receipt showed an
already-authorized primary coordinator root open successfully with an empty
canonical history, while its ordinary SDK pointer was intentionally absent and
the persisted restart interruption left the local session status as `error`.
The existing Composer treated that ordinary lifecycle flag as a reason to
disable the textarea and send control even though the ready coordinator sender
was available.

`Composer` now separates the ordinary lifecycle disable reason from coordinator
composition. A live, active coordinator root may use its existing plaintext
coordinator sender despite the missing SDK pointer/restart error. Child and
archived protections remain in force. Profile, model, approval, reasoning, and
fast-mode controls retain the ordinary lifecycle gate; attachment controls and
drop handling retain the plaintext-only coordinator restriction. The ordinary
SDK error/closed path remains disabled when no coordinator authority is active.

No server lifecycle metadata, SDK identity, model selection, permission mode,
profile, project, root, Dayflow consent, or gateway behavior changed.

## Changed paths and pins

Worktree base: `b60dbddf6cfa87287b2c299b658180fb4dc64e96`.
The independently composed R4 delivery baseline is
`057375e657c6a65d631e1ae073eca4c97b9e5cf9`; its existing source bytes were
preserved in this worktree.

- `apps/web/src/components/Composer.tsx`
  - preimage Git blob: `718b747990c548709a1dff92f4235ba16f006afe`
  - postimage Git blob: `1be5dea83be961c57e20579f9bf88798ecc0479d`
  - postimage SHA-256: `b864073b1e1ce3d920bf6fb1ca89999f3592d6d3bb675c6d93e352ce4f66ee12`
- `apps/web/tests/coordinator-composer-draft.test.mjs`
  - preimage Git blob: `5d937a9154da7858e5988abef14d984cafd7b2fe`
  - postimage Git blob: `0d4ce52f03f1b1e8520164dbd03c12b3dbcf3422`
  - postimage SHA-256: `c19eb2a690ce547d9d5d34d148ac95f0ced9e553836e13c4b8aa29fda6529291`

## Manual impact scope

GitNexus `impact Composer` and `impact submit` both reported this isolated
checkout as unregistered. This is **UNKNOWN**, not an impact pass; no index
registration, rebuild, or original-checkout lookup was used.

Manual caller review was limited to `AgentsWorkspace` passing the scoped,
enabled coordinator sender into `Composer`, `Composer.submit`, and
`submitCoordinatorComposerInput`. The latter remains the sole coordinator
plaintext admission path and returns before ordinary `sendLiveInput`/command
handling.

## Checks

- `node --test tests/coordinator-composer-draft.test.mjs` — pass, 5/5.
  The new rendered-component cases cover an active restart-error root with no
  SDK ID (enabled textarea/send, coordinator-only message, no SDK input, file
  input disabled) and an ordinary error/no-SDK session that remains disabled.
- `node --test tests/rhythm-primary-entry.test.mjs` — pass, 9/9; preserves R4
  setup layout, repeat-entry, and same-root selection/reopen coverage.
- `npm run typecheck` — pass.
- `git diff --check` — pass.

## Remaining caveats

No browser, normal app, API, SDK, model, or database action occurred. Root must
run the existing intercepted browser check and the authorized normal-app
restart-error verification after composing these two source files. That check
must confirm coordinator plaintext sends use only the coordinator route and do
not allocate an SDK turn; browser/source evidence is not runtime acceptance.
