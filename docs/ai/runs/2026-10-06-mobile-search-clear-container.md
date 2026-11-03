---
date: 2026-10-06
repo: rhythm
branch: n/a (isolated owned source copy, not a git checkout)
pr: none
issues: none
status: source authored; unverified (no tests, captures or builds run by the author)
tags: [run, rhythm]
---

# Mobile search: remove the empty clear circle

## Files
- `apps/mobile/components/chat/session-configuration-sheet.tsx`: the shared picker `Searchbar` gets `right={query ? undefined : () => null}`.
- `apps/mobile/tests/chat/session-configuration-sheet.test.tsx`: one added real-Paper case.
- This note.

## Cause and change
- Paper 5.15 keeps its clear `IconButton` mounted when the query is empty, with a transparent glyph and `pointerEvents=none`.
- Its Surface still renders as a pale 40×40 circle at the right edge of the empty search field.
- In Paper's V3 branch a defined `right` hides the whole clear wrapper (`display: none`). An undefined `right` restores the stock clear control, accessible label (`clear`), touch target and `handleClearPress`.
- Presentation only. No theme, icon, loading, API, persistence, selection or filtering change. The Auto, model, profile and approval rows are untouched. No placeholder icon was added.
- The same Searchbar serves the profile, model and project pickers.

## Test added
The test renders the actual `SessionConfigurationSheet` with real Paper (no Searchbar or Paper mock) and two profiles, then opens the Profile picker.
- Empty: the `search-bar-icon-wrapper` style is `display: none`, there is no accessibility-exposed `clear`, and the control is still present with `includeHiddenElements`. Both profiles are listed.
- Typing `Secretary`: Builder is filtered out, the wrapper is no longer hidden, and the stock `clear` control is exposed.
- Pressing `clear`: the query empties, both profiles return, and the wrapper is hidden again.
- `onCreate` was never called.

## Checks
The author ran nothing (no shell). Independent results from Sol:
- First run of the focused Jest file: **10 existing tests pass, the new case fails (1 fail)**. The only cause was the test helper `getByTestId('search-bar-icon-wrapper')`, which excludes the intentionally `display: none` wrapper.
- Typecheck: exit 0.
- Targeted lint: exit 0.

Test-only correction (authored, **not executed**): the helper now queries `getByTestId('search-bar-icon-wrapper', { includeHiddenElements: true })`. The visible `clear` assertions, typing/filtering/clear behaviour and the `onCreate` assertion are unchanged, and the production sheet is untouched (`1797b411…`). Pending: Sol reruns only this affected test, then the two model-picker captures (auto and fixed).

## Uncertainty
- The test relies on RNTL 13 default hidden-element exclusion (confirmed by the first run) and the flattened wrapper style. The corrected hidden-wrapper query has not been run.
- A defined `right` also affects the layout of the trailing area in bar mode. `() => null` renders nothing there, but the pixel result needs the capture.
- Old screenshots stay in place until reviewed replacements exist.
