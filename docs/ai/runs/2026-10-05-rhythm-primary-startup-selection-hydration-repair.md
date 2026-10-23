---
date: 2026-10-05
repo: Rhythm
branch: codex/rhythm-primary-entry-repair-20261005
status: in_review
tags: [run, rhythm, web, coordinator]
---

# Primary entry startup selection hydration repair

## Scope

Incremental source-only delta after frozen R7 UI source `25fb7147b6cee8f3e7e6a70b23e75090ac0d068e`.

- `AgentsWorkspace.tsx` accepts a selection transition only when the already-fenced `resolve` response is a `resolved` primary conversation and its exact server-returned session and project IDs equal the current selection. This covers startup catalog hydration from an empty placeholder to the same owner primary root.
- Any other changed selection still takes the existing cancellation path, including setup/unavailable results, foreign/non-primary responses, and a genuine third-chat selection.
- The rendered primary-entry regression begins at an empty startup placeholder, hydrates the exact returned root while `resolve` is deferred, and asserts the coordinator opens without an ordinary prompt or a misleading selection-change/failure notice.

## Source freeze

| Path | R7 blob / SHA-256 | Current blob / SHA-256 |
| --- | --- | --- |
| `apps/web/src/components/AgentsWorkspace.tsx` | `29f08f22b77822073a21123f02a9ac91a15307b6` / `d9e1275e47aa294898199795d3c1cfddeaddb42dae612bc54265e66b6fe5b130` | `ebf92e0e16871c7f2677fb08ae293621a6cece44` / `dcedc25f22dc6ee343f91f3a665389ecd1c5d5fe3088f22be15532cec81e5130` |
| `apps/web/tests/rhythm-primary-entry.test.mjs` | `7bf7c00d707bdb96ee4a8937115c57b2f17bbffa` / `df9d07e3ae7551cc816c6bd1308ac493e7692f29d3398d05a4e489ba572130b8` | `90492917b71d6ffd25d29fb10880809c51b1adbb` / `d95db15530b5928071a3818676290a719658248128444e63639e07480ac67379` |

## Checks

- `node --test tests/rhythm-primary-entry.test.mjs` — 12 passed.
- `npm run typecheck` — passed (`tsc -b`).
- `git diff --check` — passed.

## Boundaries and remaining validation

No browser, normal app, API, SDK, model, database, or runtime action was performed. GitNexus impact is `UNKNOWN` for this isolated checkout because it is unregistered; the manual caller review was limited to `openRhythmPrimary`, `navigateRhythmRoot`, the coordinator-open effect, and the rendered primary-entry test. Root must compose these two application/test bytes and rerun the actual normal-app reload + immediate Rhythm-entry click; that is the remaining acceptance gate.
