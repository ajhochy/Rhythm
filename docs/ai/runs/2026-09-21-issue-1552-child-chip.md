---
date: 2026-09-21
repo: Rhythm
branch: qwen/issue-1552-child-chip
issues: [issue-1552]
status: ready_for_verification
tags: [run, Rhythm, issue-1552, css, ui]
---

# Issue #1552: delegated-task (child-chip) card layout fix

## Summary

Fixed the `child-chip` (child-session) card two-part CSS regression in
`apps/web/src/styles.css`. Root cause had **two** independent defects:

1. **`.child-chip` declared three tracks** (`grid-template-columns: 8px minmax(0, 1fr) 14px`)
   for a button that renders only **two** children (`<span>` + chevron `<svg>`). The title
   `<span>` landed in the 8px first track and wrapped one word per line; the chevron
   landed in the 1fr second track and floated mid-card.
2. **`.child-chip > span:nth-child(2)`** targeted the chevron (second child), never the
   content span (first child), so the span never became a grid container and `<strong>`
   title / `<small>` meta stayed inline and ran together ("…regressionrunning").

**Fix (two selectors only):**
- `.child-chip`: `grid-template-columns: 8px minmax(0, 1fr) 14px` → `minmax(0, 1fr) 14px`
  (two tracks for two children).
- `.child-chip > span:nth-child(2)` → `.child-chip > span:nth-child(1)` (content span = first child).

The haiku sibling fix (nth-child(2)→(1) only) was insufficient: it left the title in the
8px track, so the card was still broken. Both defects are fixed here.

## Phase 0 — acceptance contract (RED before fix)

Contract test: `apps/web/tests/contract/issue-1552-child-chip.spec.ts` — renders the REAL app
in fixture mode (no live backend) and measures the REAL `.child-chip` from the REAL
`styles.css` across **1440 / 1024 / 780**. The chip is seed block `b-children`
(`data-testid="open-child-session-coverage-child"`, title "Volunteer coverage audit",
meta "working · 1m 42s") in the default fixture session. Five clauses:

- **c1** — two-track grid source, no 8px placeholder, span rule not nth-child(2),
  `display:grid`.
- **c2** — title/meta separated: content span is computed `display:grid` and meta renders
  on a row below the title.
- **c3** — chip holds a meaningful width (>200px) and the title track is wide (>80px) at
  all three viewports.
- **c4** — chevron flush within 12px of the chip right edge and vertically centered
  (within 4px) at all three viewports.
- **c5** — rendered-width regression: computed `grid-template-columns` has exactly 2 tracks
  with a wide first track.

**RED command (cwd `apps/web`, buggy CSS):**
`RHYTHM_E2E_PORT=4973 npx playwright test tests/contract/issue-1552-child-chip.spec.ts --workers=1`
→ exit 1, **5 failed** (before any implementation edit). Failures map 1:1 to the two root
causes: c1 source, c2 `spanDisplay≠'grid'`, c3 title-container ≤80px, c4 chevron not
flush/centered, c5 `trackCount=3`.
Contract JSON: `docs/ai/contracts/issue-1552.json` (criteria + RED recorded).

## Phase 1 — impact analysis

Dispatch pre-recorded impact as **LOW** (Transcript: 1 direct dependent). The change is
CSS-only in `apps/web/src/styles.css`, which carries no graphed symbols; the only consumer
is the `Transcript` component that renders `.child-chip`, and a style change cannot alter
its API. Staying within that pre-approved LOW footprint (two selectors, no shared JS).
GitNexus was not connected in this worktree at run time, but the two-selector CSS delta
matches the recorded LOW analysis, so no re-approval was required.

## Phase 2 — implementation + GREEN

Two confined edits to `styles.css` lines 289–290 (see diff below). No other file.
**GREEN (after fix, cwd `apps/web`):**
`RHYTHM_E2E_PORT=4973 RHYTHM_DIST_PORT=4974 npx playwright test tests/contract/issue-1552-child-chip.spec.ts --workers=1`
→ exit 0, **5 passed (11.3s)**.

### CSS diff
```
-.child-chip { … grid-template-columns: 8px minmax(0, 1fr) 14px; … }
-.child-chip > span:nth-child(2) { display: grid; }
+.child-chip { … grid-template-columns: minmax(0, 1fr) 14px; … }
+.child-chip > span:nth-child(1) { display: grid; }
```

## Phase 3 — Electron renderer evidence + isolated sandbox

**Renderer evidence:** the contract renders the real layout in headless Desktop Chromium
(the renderer that measures the Electron `webContents`). A screenshot is written on GREEN:
`docs/ai/runs/artifacts/issue-1552/evidence/child-chip-1440.png` (single-line title,
`working · 1m 42s` beneath, chevron flush right, two tracks).

**Isolated sandbox (fresh synthetic fixture + unique ports):**
- Generated a fresh synthetic fixture:
  `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-1552-fixture-run2` → **exit 0**,
  read-only `rhythm.db` + `opencode.json` (mcp map present), 0400 perms.
- Guard test **without starting any service / build**:
  `bash tools/dev/sandbox_guard_test.sh` → **19 passed, 0 failed**.
- `sandbox_bootstrap_test.py` → **FAILED** with an environment fact, preserved not bypassed:
  `test_node_abi_preflight_and_runtime_resolution` — a stock
  `/Users/ajhochhalter/.local/bin/opencode` shadows the (not-yet-built) fork engine. This is
  the degraded / guard-degraded state the dispatch says to preserve; running `sandbox.sh up`
  would build+launch engines and use that stock binary.

**Runtime renderer evidence: BLOCKED (sandbox identity validation blocks / degraded).**
Per the dispatch, no live service was started/contacted. Renderer layout evidence is
therefore the deterministic fixture-mode Playwright render above; the runtime (live-electron)
evidence is marked blocked. No `sandbox.sh up` was run.

## Changed files (owned scope only)

| File | Change |
|---|---|
| `apps/web/src/styles.css` | lines 289–290: two selector edits (3→2 tracks; nth-child(2)→(1)) |
| `apps/web/tests/contract/issue-1552-child-chip.spec.ts` | new: rendered-width regression, 5 clauses |
| `docs/ai/contracts/issue-1552.json` | new: contract (criteria, modes, statuses, RED/GREEN, not_tested) |
| `docs/ai/runs/artifacts/issue-1552/evidence/child-chip-1440.png` | new: rendered screenshot |
| `docs/ai/runs/2026-09-21-issue-1552-child-chip.md` | new: this note |

## Commands run

- Phase 0 RED: `cd apps/web && RHYTHM_E2E_PORT=4973 npx playwright test tests/contract/issue-1552-child-chip.spec.ts --workers=1` → 5 failed.
- Phase 2 GREEN: `cd apps/web && RHYTHM_CAPTURE_EVIDENCE=1 RHYTHM_E2E_PORT=4973 RHYTHM_DIST_PORT=4974 npx playwright test tests/contract/issue-1552-child-chip.spec.ts --workers=1` → 5 passed.
- Whitespace: `git diff --check` clean; no trailing whitespace in untracked files.
- Guard (no service): `bash tools/dev/sandbox_guard_test.sh` → 19 passed.
- Fixture: `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-1552-fixture-run2` → exit 0.
- Bootstrap: `python3 tools/dev/sandbox_bootstrap_test.py` → FAILED (degraded env; stock opencode shadow).

## No commits

Per instructions, changes remain uncommitted for orchestrator / verification-gate handoff.
No `git push`, no `gh pr`. Verification-gate may run `npx playwright test
tests/contract/issue-1552-child-chip.spec.ts --workers=1` (fixture mode, no live service)
as the GREEN confirm.
