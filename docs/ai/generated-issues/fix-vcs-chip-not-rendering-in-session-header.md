# fix(#607): VCS chip never renders in session header — entire #607 surface invisible

## Problem

PR #617's #607 claim:
> "The VCS chip becomes a button; tapping it opens a popover with the same branch list, Stash/Discard/Cancel dirty-tree handling, and verbatim git errors in a SnackBar."

In vbeta.18.36 against a session whose working directory is a git repo: **no VCS chip is visible anywhere in the session header.** The popover, dirty-tree confirms, and SnackBar-on-git-error paths can't be reached because the entry-point button isn't rendered.

## Reproduction (vbeta.18.36)

1. + New session → working directory `/Users/ajhochhalter/Documents/Rhythm` (verified git repo).
2. Confirm + Start.
3. Inspect the session header. Look for a branch-name chip / button.
4. **Actual**: no chip. The header shows the agent kind pill + session name + Idle indicator + Close button. No VCS affordance at all.

## Likely cause (one of)

1. The chip widget is gated on some state that resolves false in this environment — perhaps `project.hasVcsRoot` or a controller-level flag that's stale or never populated.
2. The chip code was added but its parent header layout was edited concurrently and the widget got dropped.
3. The chip depends on the same branch-list response that VCS 1 demonstrated is throwing the type cast error (see `fix-vcs-branch-dropdown-type-cast-and-switch.md`). If the chip waits for that response before rendering, it never appears.

## Scope

`apps/desktop_flutter/lib/features/agents/views/` — the session header / transcript header area. Find where the chip is supposed to render, check its conditional, ensure it appears whenever the session's working directory has a git repo.

## Acceptance criteria

- [ ] VCS chip appears in session header for any session whose cwd is a git repo.
- [ ] Chip shows the current branch name.
- [ ] Clicking opens a popover with current/recent/local sections (same UX as the new-session Branch dropdown after VCS 1 fix).
- [ ] Dirty-tree handling: Stash / Discard / Cancel confirm.
- [ ] Git errors surface in a SnackBar with verbatim git output.
- [ ] Non-git cwd sessions don't render the chip (don't show a broken/empty state).

## Severity

High — the entire #607 deliverable is unobservable. Most likely a one-line fix once root cause is identified (gated render).

## Related

Probably blocked by, or sharing root cause with, the VCS 1 type cast error.
