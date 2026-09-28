---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: null
issues: [1552, 1553, 1554]
status: investigation-complete
tags: [run, Rhythm, transcript-ux]
---

# Transcript / delegated-task card defects — exploration and issue filing

Exploration only, per instruction. No product code changed, no PR.

## Files

- Read: `apps/web/src/components/Transcript.tsx`, `apps/web/src/styles.css`,
  `apps/web/src/gateway/sessions.ts`, `apps/api_server/src/services/opencode_stream_bridge.ts`.
- No files modified.

## Checks

- Ran `apps/web` fixture dev server on :5199 in this worktree (node_modules symlinked from the
  main checkout, removed afterwards). Did not touch the user's running app, :4001 or :4096.
- Reproduced the broken child-session card in the fixture transcript; measured the live element
  at 1440 / 1024 / 780px viewports via Playwright.
- Read live session data from `http://localhost:4001/agent-sessions/*/messages` to decide whether
  the zero-cost footer is a data bug.

## Notes

Root cause of the one-word-per-line title: **`apps/web/src/styles.css:289`** declares
`grid-template-columns: 8px minmax(0, 1fr) 14px` on `.child-chip`, but the markup
(`Transcript.tsx:32`) renders only two children. The title `<span>` lands in the fixed **8px**
track (measured: 8px wide, 117px tall at every viewport width) and the chevron lands in the
`1fr` track meant for the text, so it floats mid-card. The companion rule at line 290
(`> span:nth-child(2)`) also misses — the span is `:nth-child(1)` — so `<strong>` and `<small>`
stay inline and the status concatenates onto the title (`regressionrunning`). One rule, three
symptoms; wrong since the first commit of `styles.css` (246e8e7b). Not width-dependent.

Zero-cost footer: **not a data bug.** Completed messages carry real tokens (31159/22,
21090/405, cache read 107k …) and Anthropic sessions carry real cost ($0.09–$0.11). Only the
in-flight message reports 0/0/0, and `openai/gpt-5.6-*` reports `cost: 0` because it is
plan-priced. The defect is that the UI renders placeholder zeros as if final, and prints raw
floats (`Cost $0.10543375`).

Empty "Reasoning" row: the engine emits `reasoning` parts before their text arrives (1 of 23
parts empty in the sampled live session); the renderer draws a 40px bordered, clickable row
for them regardless.

## Issues filed

- #1552 — child-chip grid/markup mismatch (wrap + chevron + jammed status; one root cause)
- #1553 — empty Reasoning rows, hard-coded "Reasoning" label, unrendered markdown
- #1554 — usage footer placeholder zeros + unformatted cost

All labelled `transcript-ux` (label created), `bug`, `frontend`.
