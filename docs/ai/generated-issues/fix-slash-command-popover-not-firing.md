# fix(#610): slash-command popover never appears when user types `/` in composer

## Problem

PR #617's #610 claim:
> "SlashCommandPopover anchored to the composer TextField. Arrow-key / Enter / Escape navigation; selects write the canonical command back into the input."

In vbeta.18.36: typing `/` in the composer input field produces no popover. Arrow-key / Enter navigation can't be exercised because the popover never appears in the first place.

## Reproduction (vbeta.18.36)

1. Open any agent session.
2. Focus the composer input field.
3. Type `/`.
4. **Expected**: a popover appears anchored to the TextField showing the list of available slash commands.
5. **Actual**: nothing — input just shows `/` like a literal character.

## Likely cause

Top candidates without yet reading the source:

- The TextField listener / `onChanged` handler isn't detecting the `/` prefix on the current line — maybe a misregistered focus node or a missing controller listener.
- The popover widget is rendered but at offset 0,0 / z-order behind other widgets / opacity 0.
- The commands data source returns an empty list synchronously, and the popover code suppresses display when commands.length == 0. (Check the data source first.)
- The popover trigger condition expects `/` only at start-of-line, but the cursor position check is wrong on an empty input (might be looking at character before `/` and finding undefined / newline mismatch).

## Scope

`apps/desktop_flutter/lib/features/agents/views/` — find `SlashCommandPopover` widget + the composer that anchors it. Walk the listener wiring, the data source query, and the overlay/portal layer.

## Acceptance criteria

- [ ] Typing `/` in the composer input opens the popover with a non-empty command list.
- [ ] Arrow ↑ / ↓ navigates highlighted entry.
- [ ] Enter inserts the canonical command into the input (and dismisses the popover).
- [ ] Escape dismisses the popover without writing anything.
- [ ] Typing past `/` (e.g. `/co`) filters the list to matching entries.
- [ ] Backspacing the `/` dismisses the popover.

## Severity

Medium — feature is invisible. Not breaking but the entire #610 deliverable is unobservable.
