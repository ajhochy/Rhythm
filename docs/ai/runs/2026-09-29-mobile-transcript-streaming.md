---
date: 2026-09-29
repo: Rhythm
branch: mobile/transcript-delta-streaming
pr: 1587
issues: [ST-1]
status: pass
tags: [run, Rhythm]
---

# Mobile transcript streaming ST-1

## Files

- `docs/ai/contracts/mobile-transcript-streaming.json`
- `apps/mobile/tests/chat/transcript-streaming.test.ts`
- `apps/mobile/tests/chat/transcript-streaming-provider.test.tsx`
- `apps/mobile/tests/agent-chat-event-dedupe.test.ts`
- `apps/mobile/lib/opencode/transcript-events.ts`
- `apps/mobile/providers/opencode-provider.tsx`
- `apps/mobile/providers/services/agent-chat-service.ts`

## Checks

- FAIL (required red repair contract): `npm test -- --runInBand tests/agent-chat-event-dedupe.test.ts tests/chat/transcript-streaming.test.ts tests/chat/transcript-streaming-provider.test.tsx`
  - `st1-r1` received `message.part.delta:session-current:message-current` for all three exact-shape anonymous deltas instead of `null`.
  - Provider 100-delta and 20%-loss tests both remained at 0 visible characters because later anonymous same-message deltas were discarded before reduction.
- FAIL (required red contract): `cd apps/mobile && npm test -- --runInBand tests/chat/transcript-streaming.test.ts`
  - 6/6 tests failed at `expect(subject).toBeDefined()` because the mobile transcript event reducer does not exist.
- PASS: `npm test -- --runInBand tests/chat/transcript-streaming.test.ts tests/chat/transcript-streaming-provider.test.tsx` — 7/7.
- PASS final contract rerun after all test/doc edits: same command — 7/7; post metrics remained 104 ms, event 100, 1 commit, 0 pre-idle GETs, reconciliation true.
- PASS repair contract: `npm test -- --runInBand tests/agent-chat-event-dedupe.test.ts tests/chat/transcript-streaming.test.ts tests/chat/transcript-streaming-provider.test.tsx` — 12/12. The real anonymous SDK-shape deltas have no synthetic ID; 100/100 anonymous same-message chunks reached the reducer. Explicitly identified deltas and unrelated stable recovery events remained deduped.
- PASS final repair contract rerun after stable provider-lifecycle integration and evidence edits: same command — 12/12; metrics 104 ms, event 100, 1 commit, 0 pre-idle GETs, reconciliation true.
- PASS provider loss/reordering evidence: 20 of 100 anonymous deltas withheld, remaining 80 delivered in reverse order, visible pre-idle length 80 with 0 message GETs, then `session.idle` performed one authoritative GET and the full `SessionMessageRecord[]` deep-equaled the 100-character authoritative result.
- PASS provider lifecycle evidence: a queued first-session delta survived a current-session switch, advanced only the first-session preview to `-first`, and left the second transcript unchanged; unmount before 75ms produced 0 delayed transcript commits.
- PASS baseline: `ST_PROVIDER_REVISION=baseline npm test -- --runInBand tests/chat/transcript-streaming-provider.test.tsx` using the parent event cases.
  - First visible text: none before idle; first visible event: none; React transcript commits: 0; messages GETs pre-idle: 1; final authoritative reconciliation: true.
- PASS post: `npm test -- --runInBand tests/chat/transcript-streaming-provider.test.tsx` with the same 100-delta protocol.
  - First visible text: 104 ms; first visible event count: 100; React transcript commits: 1; messages GETs pre-idle: 0; final authoritative reconciliation: true.
- PASS: combined changed chat contract with ST-1 — 75/75:
  - `npx jest tests/chat/create-chat-fast-path.test.tsx tests/chat/create-chat-provider-cache.test.tsx tests/chat/chat-list.test.tsx tests/chat/session-configuration-sheet.test.tsx tests/chat/chat-content-scroll.test.tsx tests/chat/transcript-streaming.test.ts tests/chat/transcript-streaming-provider.test.tsx --runInBand --silent`
- PASS: `npx jest tests/chat/chat-content-scroll.test.tsx --runInBand --silent` — 8/8 auto-scroll.
- PASS repair combined chat/ST-1: `npx jest tests/chat/create-chat-fast-path.test.tsx tests/chat/create-chat-provider-cache.test.tsx tests/chat/chat-list.test.tsx tests/chat/session-configuration-sheet.test.tsx tests/chat/chat-content-scroll.test.tsx tests/chat/transcript-streaming.test.ts tests/chat/transcript-streaming-provider.test.tsx tests/agent-chat-event-dedupe.test.ts --runInBand --silent` — 80/80.
- PASS final reruns after all product changes: combined chat/ST-1 80/80; offline/reconnect 8/8; event/fetch safety 11/11; stable recovery contract 6/6; typecheck; lint with the same 3 pre-existing warnings and 0 errors.
- PASS: `npx jest tests/contract/issue-1387-false-offline-after-send.test.tsx --runInBand --silent` — 8/8 offline/reconnect.
- PASS: `npx jest tests/open-session-cache-first.test.ts tests/session-message-merge.test.ts tests/global-event-stream.test.ts --runInBand --silent` — 11/11 fetch generation, message merge, and event transport.
- PASS: `node --test tests/issue-1172-acceptance.test.mjs` — 6/6, including stable recovery dedupe.
- PASS: `npm run test:fake-server:self`.
- PASS: `npm run typecheck`.
- PASS with 3 pre-existing warnings and 0 errors: `npm run lint`.
- PASS: `git diff --check` and `git diff --no-index --check /dev/null <owned-untracked-file>` for all five owned untracked files.
- PASS repair diff check: `git diff --check` plus `git diff --no-index --check /dev/null <owned-untracked-file>` for all six owned untracked files; final status contains only the eight ST-1 product/test/evidence files.
- PASS final focused gate: repair contract 12/12; provider lifecycle rerun with `--detectOpenHandles` 4/4; disposable current-source project-reset probe confirmed a queued batch does not publish after `selectProject` clears project state.
- PASS final performance protocol (three identical repetitions): parent first-visible none, commits 0, pre-idle GETs 1, reconciled true; post first-visible 101–104ms, commits 1, pre-idle GETs 0, reconciled true.
- PASS final Mobile CI foundation: exact `CI=true EXPO_PUBLIC_E2E_MODE=1 npm run verify:foundation`; all static/security/foundation stages passed and Playwright passed 71 with 1 documented skip.
- FULL MOBILE JEST: 261/265 passed. The four failures in issue-1387 offline cold-relaunch/catalog tests reproduced with identical assertions on parent `6af3563c` and are classified exact base-red, outside ST-1.
- `GITNEXUS-FALLBACK: detect_changes failed (Not connected); used git status, git diff --name-only, full owned diff review, and tracked/untracked whitespace checks.`

## Notes

- Commit `86e28522` is pushed on `mobile/transcript-delta-streaming`; draft PR #1587 is open, stacked on the PR #1585 branch `mobile/chat-list-compact-project-create`.
- Pre-existing dirty file `apps/mobile/package-lock.json` is outside ST-1 ownership and will not be changed.
- `GITNEXUS-FALLBACK: query/impact were unavailable (Not connected); used exact-reference grep.` The local `handleEvent` closure has one SSE-loop invocation path and publishes through `messagesBySession` to transcript/usage/preview consumers. Assessed MEDIUM: shared provider state, but the approved edit is limited to three transcript event cases plus a pure helper; idle refresh, status, pending interactions, reconnect, and fetch-generation paths remain unchanged.
- Repair impact: `GITNEXUS-FALLBACK: impact/context for getStableRecoveryEventId were unavailable (Not connected); exact-reference grep found provider SSE dedupe and dedupeRecoveryEvents plus issue-1172 tests.` Assessed LOW for a `message.part.delta`-only anonymous-event exception; explicit IDs and non-delta message/part/request recovery identities remain unchanged.
- A fixed 75ms window starts on the first queued event, so continuous deltas cannot postpone commits. Explicit stable event IDs continue to deduplicate duplicate SSE envelopes before reduction. Anonymous `message.part.delta` events deliberately receive no recovery identity: `messageID` and `partID` address a mutation but do not identify a chunk, so repeated anonymous chunks are delivered even when text is identical. Duplicate/lost anonymous chunks are not guessed away; lossy/non-replayed SSE remains provisional and `session.idle` flushes pending work then retains the authoritative messages GET. Snapshot events are authoritative in arrival order; deltas append in arrival order only when their message, part, field, and session already match. Unknown deltas are ignored rather than fabricated. Provider-level replacement deep-equaled after 20% synthetic loss and reverse-order delivery.
- Final verification started the isolated synthetic-fixture sandbox on `:4098/:4097/:4099`, confirmed API and engine readiness plus both health endpoints, and stopped it after the gate. The credential-free fake OpenCode server self-test and provider-controlled SSE stream supplied the transcript behavior evidence.
- Visual/accessibility artifact: not applicable because this slice changes provider state/event handling and adds no rendered layout or interactive control. Existing auto-scroll behavior is covered by its maintained 8/8 suite and the Mobile CI browser gate.
- Final gate status: full required mobile verification ran. Focused 12/12, combined 80/80, and Mobile CI foundation gates are green; full mobile Jest has only four exact parent-red issue-1387 failures. The provider lifecycle suite also exits cleanly under `--detectOpenHandles`.
- Automated verification passed for commit `86e28522`. Manual native streaming/auto-scroll smoke remains outstanding; the PR is not merged, deployed, or released.
