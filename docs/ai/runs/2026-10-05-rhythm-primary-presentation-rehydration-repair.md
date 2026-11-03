---
date: 2026-10-05
repo: rhythm
branch: codex/rhythm-primary-entry-repair-20261005
pr: null
issues: [rhythm-primary-presentation-rehydration-repair]
status: in-review
tags: [run, rhythm, web, coordinator, primary-entry, presentation]
---

# R19 — primary coordinator presentation and decision-rehydration repair

## Scope

This is a source-only follow-up to the supplied normal-app receipt for the
existing Secretary primary root. The receipt established that the server root,
coordinator open/status/history, canonical empty history, and coordinator
composer were ready; it did not establish a failed SDK turn. The renderer still
showed ordinary `Error`, a false pending-decisions connection error, and a stale
primary-entry failure/selection notice.

The repair is limited to desktop web coordinator presentation and the ordinary
pending-decision rehydration boundary:

- SDK-less roots clear only their own stale locally cached decisions and skip
  the ordinary permissions query. SDK-backed permission failures still surface.
  An `AbortSignal`/read fence makes a late previous-selection failure inert.
- The selected-session effect aborts its prior decision read on selection,
  account, gateway, or SDK-identity change. Reconnect retains its existing
  behavior, but ignores a late result unless the same SDK-backed session is
  still current.
- A coordinator-ready, SDK-less primary root displays `Ready` only when the
  actual current coordinator conversation is the matching primary root, the
  coordinator phase is ready, and there is no real connection hold. Ordinary,
  child, archived, held, offline/unavailable, and non-coordinator sessions keep
  their existing presentation.
- The permanent entry no longer starts a second detail handoff when the
  server-returned root is already selected. Its late open continuation also
  cannot replace an already-current authoritative ready result or another
  selected chat.
- Coordinator composer copy now says `Message Rhythm about your work…`, not a
  misleading per-project scope.

No server status, SDK identity, profiles, permissions, project/root selection,
gateway authorization, Dayflow behavior, or ordinary SDK sender changed.

## Changed paths and pins

Base commit: `b60dbddf6cfa87287b2c299b658180fb4dc64e96`.
The worktree intentionally retains Root-composed R4/R5 changes. Their source
bytes were not reverted; paths with an R4/R5 predecessor list that predecessor
below.

- `apps/web/src/pending-decisions.ts`
  - base blob: `da3538461af6e5419b220c2d9a4e9b887a709578`
  - postimage blob: `d0f154628ab0b0052024a31b42d8b32bc884f686`
  - postimage SHA-256: `1b679de5df5e29110a02adb9bf0f8bd56b5c82b299c3fd12d630fddf83165733`
- `apps/web/src/store.tsx`
  - base blob: `3621e97a1e793a729d0a908d89f33568b9fe663c`
  - postimage blob: `3f820ec0d70a495f6ad1323f0829b8fe1ff16369`
  - postimage SHA-256: `f97abcd8983abfbba133123d5fab23631369bb37a61ac8b99b2d36f96261729c`
- `apps/web/src/components/AgentsWorkspace.tsx`
  - R4 predecessor blob: `11749dd5f3d1108cd1bc4519288b2293ea6feda1`
  - postimage blob: `3a722ee8c6ef9a36265c8fb0c04f036bc806d023`
  - postimage SHA-256: `5f4fe8e3a2aca7c60ec5eec48f2b8578e5bc4dbaace5f2429d5588d1e5ed48a0`
- `apps/web/src/components/Composer.tsx`
  - R5 predecessor blob: `1be5dea83be961c57e20579f9bf88798ecc0479d`
  - postimage blob: `ee23e15b0df5a629a7538895fc6afb63f28f76a4`
  - postimage SHA-256: `febbffec185af664e66fb4d95a9e9e658f96bc188c76f6452ba5247b76d6d08c`
- `apps/web/tests/coordinator-conversations.test.mjs`
  - base blob: `e2cd69890b99f9f1328605e17c2a0f9ac50adb19`
  - postimage blob: `3581450dec0b563fd062227c416b8640f3c909f9`
  - postimage SHA-256: `24cbea9f5e7114c869a7fdea6c412194efcd63a98396195e802b7ad3e7687a5f`
- `apps/web/tests/rhythm-primary-entry.test.mjs`
  - R4 predecessor blob: `40283631c55693452d7aa14fc757d47fd24dd8fa`
  - postimage blob: `dcdcbb49f1c131b5b4771f0afe409ba35881796d`
  - postimage SHA-256: `83a9a19b7e7a991670129bcd1d1363805a7c0d5d666ee4934c341682985f2942`
- `apps/web/tests/coordinator-composer-draft.test.mjs`
  - R5 predecessor blob: `0d4ce52f03f1b1e8520164dbd03c12b3dbcf3422`
  - postimage blob: `8f16c3af6e79f8482e49e94d8c806e2c8d3f1be3`
  - postimage SHA-256: `b5ac15d017fd9b67b9888e519b6cbb65216b34862a2c359211a0d9c089210d18`

The pre-existing shared `apps/web/node_modules` symlink remains unmodified.

## Manual impact scope

Bounded GitNexus upstream impacts for `rehydrateDecisions`,
`navigateRhythmRoot`, `sessionPresentation`, and `Composer` returned
`Repository not found` for this isolated checkout. This is **UNKNOWN**, not an
impact pass; no index registration, rebuild, or original-checkout lookup was
performed.

Manual caller/path review covered:

- selected-session and reconnect calls to `rehydrateDecisions` in `store.tsx`;
- `pending-decisions`' existing event/read reconciliation maps and ordinary
  permission/question routing;
- `SessionRail` → `openRhythmPrimary` → `navigateRhythmRoot` → coordinator
  open/history path, including its actor/gateway/selection generation fences;
- the Agents header's `sessionPresentation` use and current coordinator state;
- the coordinator Composer plaintext sender, which still returns before the
  ordinary SDK input path.

## Checks

- `node --test tests/coordinator-conversations.test.mjs tests/rhythm-primary-entry.test.mjs tests/coordinator-composer-draft.test.mjs` — pass, 27/27.
  New coverage proves an SDK-less coordinator root makes zero ordinary pending
  permission reads, a late aborted previous-session decision failure is ignored,
  an already-selected primary root does not make a second detail selection or
  paint a false failure, the ready SDK-less root displays `Ready`, and the
  coordinator placeholder is owner-wide.
- `npm run typecheck` — pass (`tsc -b`).
- `git diff --check` — pass.

No web lint command is available in this cached package; no dependency or
network install was attempted. The pre-existing rendered-test deprecation
notices did not fail the focused test run.

## Remaining validation and limits

No browser, normal app, API, SDK/model turn, database, service, or package
operation occurred. Root must run the existing intercepted browser fixture with
an SDK-less primary-root permission read rejected, then verify that reopen keeps
the ready header/notice and owner-wide placeholder while ordinary SDK-backed
permission failures still remain visible. Root alone owns normal-app and
package validation; this source result is in review, not product/runtime
acceptance.
