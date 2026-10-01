---
date: 2026-09-29
repo: rhythm
branch: mega/2026-09-29-electron-orgreviewer
pr: 1594
issues: []
status: pass
tags: [run, rhythm]
---

# Optimistic user message pinned below the agent reply (Electron transcript)

Symptom (live Electron, Auto session): typed "yes" messages rendered at the bottom of the
transcript, under the agent output that answered them, and new ones kept stacking there.

## Files

- `apps/web/src/gateway/transcript-reducer.ts`: `mergeTranscriptPage` no longer re-seeds a
  `local-user-*` row whose id is already an alias target (a confirmed optimistic copy).
- `apps/web/tests/contract/transcript-optimistic-user-replay.test.mjs`: new regression test.
- `apps/web/tests/fixtures/transcript/optimistic-user-auto.jsonl`: captured frames (`kind: captured`)
  for one Auto-session "yes" turn, taken on this branch at 5437cc92.

## Root cause

`store.tsx` re-seeds the stored transcript from the React `session.messages` on every event
(`reduceSessionTranscript` → `mergeTranscriptPage(stored, session.messages)`), inside a
`setSessions` updater that also writes `transcriptStatesRef`. When that updater runs a second time
against the same pre-update session (React replays updaters; StrictMode does it every time), the
ref already holds the aliased state (`aliases[msg_…] = local-user-…`, local row removed). The replay
re-inserts the local row from the stale snapshot. The engine row is unchanged, so `upsertPart` /
`message.updated` return early and `aliasUser` never runs again. `order()` ranks `local-user-*`
last, so the copy is pinned under every later message.

The wire is not at fault. Frames captured in the sandbox (API 6998, engine 6997, scripted provider
6996) for a Fixed and an Auto session are the same shape: user `message.updated` (no parts), then
user `message.part.updated` text "yes", then the assistant. Auto sends no `modelOverride`. Without
replay, the real reducer aliases the copy correctly in both modes.

Reproduced in the real renderer (a Vite harness with FixtureProvider, Transcript and Composer against the sandbox, driven by Playwright):
- No StrictMode: fixed/auto × {plain 3-turn, "yes" sent while busy, "yes" while a permission was pending} all ordered correctly.
- StrictMode (updater replay): Auto run ended with `local-user-…` "S0:plain — first turn" left at the bottom (1 of 6 sends).
- After the fix, under StrictMode: 12 sends across fixed and auto, no local rows left.

Not proven: which production trigger replays the updater in the packaged Electron build. The
packaged build loads `rhythm://app` from dist, so StrictMode double-invoke does not apply there.
The fix covers any replay or stale snapshot, whatever the trigger.

## Checks

- `node --test tests/contract/transcript-optimistic-user-replay.test.mjs tests/contract/issue-1582-transcript-reducer.test.mjs`: 36/36 pass.
  Mutation: with the original reducer, the replay case fails ("no optimistic copy survives confirmation").
- `node apps/web/tests/live/capture-transcript-frames.mjs --verify`: frozen #1582 fixtures still verify.
- `cd apps/web && npx tsc --noEmit -p . && npm run build`: pass.
- `cd apps/electron && npm test`: 455 tests, 451 pass, 0 fail.
- `tests/transcript-reasoning-usage.test.mjs` fails on the base commit and with this change (module resolve `./AttachmentThumbnail`). It fails before and after, and does not involve this change.
- GitNexus `impact(mergeTranscriptPage)`: HIGH (2 direct callers: `store.tsx` mergeSessionTranscript, `remote-sessions.ts`). Remote pages never carry `local-user-*` rows, so the guard does nothing on that path.

## Notes

- A read-only look at the live engine DB for the affected user parts was denied by the permission classifier and was not pursued.
- Renderer-only change. The Electron app must be rebuilt to pick it up. No api_server change.
