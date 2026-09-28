---
date: 2026-09-27
repo: Rhythm
branch: codex/finish-1576-1582
pr: 1544
issues: [1582]
status: manual-smoke-pending
tags: [run, Rhythm]
---

# Issue 1582 completion slice

## Files

- `apps/web/src/components/Transcript.tsx`
- `apps/web/src/components/Transcript.css`
- `apps/web/tests/electron-e52a-transcript.spec.ts`
- `apps/web/tests/contract/issue-1582-reasoning.spec.ts`
- `docs/ai/contracts/issue-1582-completion.json`
- `docs/ai/runs/2026-09-27-issue-1582-completion.md`

## Acceptance contract / RED

- `npm exec -- playwright test --config tests/contract/issue-1582-playwright.config.ts --grep 'production-hydration|interruption'`
  - hydration assertion initially had an invalid absent-locator negative assertion; corrected before implementation, then hydration passed independently.
  - interruption failed because no visible `Interrupted` marker existed.
- `npm exec -- playwright test --config tests/electron-e52a-playwright.config.ts --grep 'E52A-c[678]'`
  - c6 failed: one wheel-up remained pinned (`gap = 0`).
  - c7 failed: `New output` appeared after three no-content frames.
  - c8 failed: 38 `scrollTop` writes across 20 unpinned streamed frames.
- `npm exec -- playwright test --config tests/contract/issue-1582-playwright.config.ts --grep 'captured reasoning grows|manual collapse'`
  - `aria-busy=true` was absent on the streaming assistant article; keyboard collapse passed.

## Impact

- Current worktree was not registered in GitNexus. Analysis used the newest indexed Rhythm sibling `/private/tmp/rhythm-mobile-photo-chat-push` for `apps/web/src/components/Transcript.tsx:Transcript`.
- Risk: LOW. Direct caller: `AgentsWorkspace`. Seven total upstream symbols, zero indexed execution flows, affected modules: Components and Gateway.

## Implementation

- Kept the authoritative scroll implementation inline.
- Wheel-up marks the current reader position unpinned synchronously.
- Unpinned resize/stream renders skip `scrollTop` restoration; explicit session restoration and older prepend retain restoration.
- Added neutral message-level `Interrupted` text and `aria-busy` on articles with streaming blocks in both main and child render sites.
- Updated E52A appended-message frames to use the real message-info/part-snapshot/delta sequence instead of an unknown delta by itself.

## Checks

- `npm exec -- playwright test --config tests/contract/issue-1582-playwright.config.ts`
  - 10 passed: all reasoning, interruption, hydration, and StrictMode contracts.
  - 5 lifecycle harness tests failed before rendering their probe (`data-testid=messages` absent); no lifecycle implementation file was edited.
- `npm exec -- playwright test --config tests/electron-e52a-playwright.config.ts`
  - repair run 1: c1, c2, c4, c6, c8 passed; c3, c5, c7 failed.
  - repair run 2 after session restore and production-frame corrections: c1, c2, c4, c5, c6, c8 passed; c3 and c7 still show `New output` after fixture-driven unpin/reconciliation.
  - focused final check `--grep 'E52A-c[37]'`: 0 passed, 2 failed with the same false `New output` result.

## Handoff

- Resume triage confirmed the remaining reds were harness defects. E52A older fixtures now carry `2026-08-31T00:00:00Z`; the no-change frame carries the real `m29` creation instant and is canonicalized while pinned before the three reader-state assertions; the lifecycle fixture imports React through Vite `/@id/` IDs.
- Focused corrected checks:
  - `npm exec -- playwright test --config tests/electron-e52a-playwright.config.ts --grep 'E52A-c[37]'` — 2 passed.
  - `npm exec -- playwright test --config tests/contract/issue-1582-playwright.config.ts tests/contract/issue-1582-lifecycle.spec.ts` — 5 passed.
- Full browser gates:
  - `npm exec -- playwright test --config tests/contract/issue-1582-playwright.config.ts` — 15 passed.
  - `npm exec -- playwright test --config tests/electron-e52a-playwright.config.ts` — 8 passed, including c1-c5 and new c6-c8.
- B5 packaged/static gates:
  - `npm run typecheck` — passed.
  - `node --test tests/contract/issue-1582-transcript-reducer.test.mjs` — 34 passed.
  - `npm run build && npm run test:dist-smoke` — build passed; dist smoke verified `index.html` and two relative assets. Existing Vite chunk-size warning remains informational.
- B4 evidence:
  - Exact sandbox status command with the supplied sandbox/engine/fixture variables — API `:4098`, engine `:4097`, gateway `:4099` healthy; `/opencode/health` returned `status=ready`, `bridgeLive=true`.
  - RED: `node apps/web/tests/live/capture-transcript-frames.mjs --verify --require-all` failed because compaction and attachment-only/mixed were absent.
  - `node --check apps/web/tests/live/capture-transcript-frames.mjs` and `node --check apps/web/tests/live/scripted-openai-provider.mjs` — passed.
  - `node apps/web/tests/live/capture-transcript-frames.mjs --b4-only` used only a fresh harness-owned `/private/tmp/rhythm-1582-s0-*` sandbox and the local `s0` provider. Final capture passed: compaction 54 WS / 2 mid / 4 final / 2 provider calls; attachment-only 29 WS / 2 mid / 2 final / 1 provider call; attachment-mixed 30 WS / 2 mid / 2 final / 1 provider call. Every capture cleanup reported ports 6996–6999 clear.
  - Compaction evidence contains the real `session.compacted` WS frame plus persisted compaction and summary parts after `POST /agent-sessions/:id/summarize`.
  - Attachment evidence uses one tiny synthetic inline image data URI FilePart. Attachment-only records zero text parts; mixed records one marker text part followed by the file. Captured URLs replace bytes with `[omitted]`; provider receipts retain only content/attachment types and counts.
  - `node apps/web/tests/live/capture-transcript-frames.mjs --verify --require-all` — passed all ten scenarios: plain, reasoning, tool, permission, question, cancel, error, compaction, attachment-only, attachment-mixed.
  - Post-capture regression: reducer 34 passed; full #1582 browser contracts 15 passed; E52A c1-c8 8 passed.
- `AUTOMATED_READY_MANUAL_PENDING`: B1–B6 are automated and passing. Existing real captures and production-path browser replay cover reasoning growth, plain/no-reasoning, cancellation, REST/WS nested IDs, switching, timestamps, compaction, and attachment-only/mixed flows without image inspection. B7 now explicitly records the unperformed installed-app manual smoke.
- Installed-app manual smoke remains residual and was not performed. No images were opened or reviewed. No commit, push, merge, deploy, #1576, provider config, dependency/lock, PR body, project-state, or unrelated documentation changes occurred.

## Focused product repair attempt 1

- Independent UI failure contract additions:
  - E52A-c6 now drives a native `page.mouse.wheel(0, -24)`, proves the pre-stream gap remains within the 48px threshold, then requires streaming to leave the reader unpinned and expose `New output`.
  - E52A-c9 warms canonical metadata, then requires visible cost/token changes on an unpinned message to expose `New output`.
  - E52A-c10 warms the canonical tool part, then requires same-ID visible tool input/output/metadata/error changes to expose `New output`.
  - E52A-c11 holds the older page while appending output and requires the original anchor ID/offset and focus to survive while the append is announced.
- RED:
  - `npm exec -- playwright test --config tests/electron-e52a-playwright.config.ts --grep 'E52A-c(6|9|10|11)'` — c6 failed by repinning to gap `0`; c9/c10 initially needed canonical warm-up to isolate the visible-field defect.
  - Warmed `--grep 'E52A-c(9|10)'` — 2 failed because rendered usage/tool changes did not expose `New output`.
- Product repair remained inline in `Transcript.tsx`:
  - per-session `wheelUnpinned` intent survives threshold scroll events; positive wheel and jump-to-latest clear it;
  - content revision is a bounded projection of rendered message usage, block fields, visible tool fields, and attachment labels only—never whole-message JSON or attachment bytes;
  - prepend and append are detected independently from retained old edge IDs; every prepend restores the reader anchor, pure prepend stays silent, and concurrent append marks unread.
- GREEN:
  - Focused c6/c9/c10/c11 — 4 passed.
  - Full E52A c1-c11 — 11 passed.
  - Full #1582 browser contracts — 15 passed.
  - Transcript reducer — 34 passed.
  - `npm run typecheck` — passed after narrowing the rendered projection to rich transcript shapes.
  - `npm run build` — passed with the existing informational chunk-size warning.
  - `npm run test:dist-smoke` — passed; index and two relative assets verified.
- Live captures were not rerun because no wire behavior changed. Installed-app smoke remains pending. No image was opened or inspected, and the manager sandbox lifecycle was untouched.

## Integrated repair attempt 1

WAIVED: test-fixture and evidence-only repair with no product behavior change; verification is the exact nine-file clean-env gate, full clean-env API suite, API build, JSON validation, and diff check.

- Corrected contract honesty without changing B5: `issue-1582-b7` is a manual `UNVERIFIED` installed-app packaged Electron transcript smoke and is listed in `not_tested`.
- No web product/test files, captures, images, provider calls, or sandbox lifecycle were touched in this repair.
- #1576 compatibility gate repair used only the nine newly authorized API test files. First clean-env focused run: 8 files/64 tests passed with one stale DB-less AgentRunner provenance expectation; assertion-only repair followed. Exact rerun: 9 files/65 tests passed.
- Full clean-env API suite: 709 files passed, 147 skipped; 6,680 tests passed, 284 skipped. Clean-env API build passed.
- `issue-1576-completion.json` and `issue-1582-completion.json` parsed successfully; final `git diff --check` passed.
- MANUAL-SMOKE-PENDING. Installed-app packaged Electron transcript smoke remains the sole explicit #1582 manual boundary; it was not performed. No image visual inspection occurred due provider limit; tracked screenshot metadata is nonzero. Required final sandbox teardown succeeded; the sandbox was removed and diagnostics were preserved at `/private/tmp/rhythm-finish-partials-sandbox-20260927.evidence.C2M6AP`. Current changes are not committed or pushed; target draft PR is #1544.
