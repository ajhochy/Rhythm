---
date: 2026-08-08
repo: Rhythm
branch: ui/desktop-mobile-session-polish
pr: 1337
issues: [ui-mobile-agents-session-list]
status: pass
tags: [run, mobile]
---

## Files

- `apps/mobile/components/chat/chat-list.tsx`
- `apps/mobile/tests/chat/chat-list.test.tsx`
- `docs/ai/contracts/ui-mobile-agents-session-list.json`

## Contract

- Contract: `docs/ai/contracts/ui-mobile-agents-session-list.json`
- Focused command: `cd apps/mobile && npx jest --runInBand tests/chat/chat-list.test.tsx`
- Before implementation: FAIL — 8 acceptance tests failed because compact rows, disclosures, hierarchy metadata, and hierarchy accessibility labels did not exist.
- Repair acceptance before implementation: FAIL — 3 new regressions failed: missing independent row-open control, unavailable one-pass `flattenChats` contract, and muted metadata contrast.
- Repair acceptance after implementation: PASS — 1 suite, 11 tests.
- Final repair acceptance before implementation: FAIL — child title still used `palette.muted`; row-open had neither `alignSelf: 'stretch'` nor a 44pt minimum height.
- Final repair acceptance after implementation: PASS — 1 suite, 13 tests.

## Checks

- `cd apps/mobile && npx jest --runInBand tests/chat/chat-list.test.tsx --silent` — PASS (13/13).
- `cd apps/mobile && npm run lint` — PASS with 3 pre-existing warnings in `.expo/types/router.d.ts`, `agent-chat-service.ts`, and `tests/global-event-stream.test.ts`.
- `cd apps/mobile && npm run typecheck` — PASS.

## Notes

- `ChatList` owns a local `Set<string>` for collapse state. Search bypasses it for matching rows and clearing search restores it.
- Repair: the row is a non-accessible 56px container with independent 48px native `Pressable` controls for open, disclosure, and overflow. Disclosure does not navigate. Metadata now uses `palette.text`; no color token was added.
- Repair: `flattenChats` now has one post-order walk: every record is visited once, descendant/running totals are accumulated while rows are emitted only when visible, and search continues to bypass collapse.
- Final repair: child titles now use `palette.text` in both theme palettes; their existing regular weight preserves hierarchy. Row-open stretches through the 56pt row, centers its text, and keeps the sibling 48pt controls untouched.
- GitNexus impact: `ChatList` LOW (one direct caller, `AgentsScreen`), `flattenChats` LOW (one direct caller, rows), and `FlatChat` LOW (one direct importer, `apps/mobile/app/(tabs)/agents.tsx`); no affected execution flows.
- No provider, service, API, persistence, dependency, fake-server, E2E, or Flutter files changed.

## Final visual evidence

- [PR #1337 UI smoke evidence](../evidence/2026-08-08-pr-1337-ui-smoke.md) records the final UI/UX reviewer PASS and the residual nonblocking VoiceOver traversal follow-up for offscreen dashboard task rows only.
