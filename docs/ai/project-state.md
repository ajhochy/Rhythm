# Project State

## Current focus

Nine open pull requests are consolidated on
`codex/mega-open-prs-2026-06-28` for one full-stack local smoke.

## Active branch / PR

- Integration branch: `codex/mega-open-prs-2026-06-28`, based on current
  `origin/main`.
- Included source PRs: #754, #757, #758, #790, #799, #800, #809, #810, and
  #811.
- Draft mega PR: #812.

## In progress

- Human smoke is in progress against the rebuilt debug app.
- The app is running with `RHYTHM_LOCAL_SMOKE=1`; local API is on `:4001` and
  the staged mega-branch engine is on `:4096`.

## Risks / known issues

- #758 is defense-in-depth; the bundled-fork event-stream regression remains a
  separate concern tracked by #759.
- Source PRs #754, #757, #758, #790, #799, #800, #809, #810, and #811 are
  closed as superseded by #812; their branches and commit history remain intact.
- `npm install` reports 12 dependency audit findings (1 low, 8 moderate, 3
  high); no dependency versions were changed in this integration run.

## Test status

- All nine source PR heads are ancestors of the integration branch.
- `ai-workflow checks --level issue`: pass.
- `ai-workflow checks --level pr`: pass.
- api_server TypeScript production build: pass.
- Flutter debug macOS build: pass.
- Fork engine build: pass; version
  `0.0.0-codex/mega-open-prs-2026-06-28-202606290201`.
- Memory vault authority drop/rebuild smoke: pass after correcting its stale
  vault-relative path assertion.
- MCP allowlist, skill allowlist, MCP alignment, and skill alignment built-fork
  smokes: pass.
- GitNexus compare against `main`: MEDIUM risk, 121 files / 531 symbols, one
  affected execution flow.

## Next step

Complete the manual smoke checklist on the running app, then review and
manually merge PR #812.

## Recent coding-agent runs

### 2026-06-28 — fix/#781 flag stale (persisted-not-live) MCP picker chips
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart`
    — `_buildMcpsSection` now passes `liveItems: _availableMcps.toSet()` +
    `flagStale: _mcpsLoaded` into `_filterChipWrap`; `_filterChipWrap` gained
    optional `liveItems`/`flagStale` params and renders a stale chip
    (`isStale = flagStale && selected && !liveItems.contains(item)`) with a
    muted/greyed fill, `Icons.warning_amber_rounded` avatar, italic muted
    label, warning-coloured border, `ValueKey('stale-chip-$item')`, and an
    unenforceable-selection tooltip. Chip stays toggleable.
  - `apps/desktop_flutter/test/features/agents/agent_profile_skills_mcp_picker_test.dart`
    — added 2 tests: stale persisted MCP shows warning/stale affordance while a
    live one does not; stale chip is still toggleable and unselect persists the
    pruned `allowedMcpsJson`.
- Checks run:
  - `dart format` (2 files): pass.
  - `flutter analyze --no-fatal-infos lib/features/agents/`: no
    errors/warnings on changed files (only pre-existing `info` lints elsewhere).
  - `flutter test test/features/agents/`: 461 pass, no F2 failures present.
- Decisions made: surface staleness only; never rewrite the persisted name
  (#789). Stale gating tied to `_mcpsLoaded` so nothing is flagged mid-load.
- Deviations from spec: skills picker NOT mirrored — it uses a separate
  `_buildSkillChipWrap` with managed/external edit-delete rows, so adding a
  third visual branch was not trivially clean; left out per the optional clause.
  The leftover `foo` test MCP server is separate live-data cleanup, out of scope.
- Concerns: none; visual treatment is theme-token based and toggle path
  exercised by tests.
