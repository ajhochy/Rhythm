# fix(#603/#607): VCS new-session Branch dropdown — type cast error, missing "current" section, branch switch fails

## Problem

PR #617's #603 claim:
> "vcs_probe.listBranches + gitCheckout helpers. New-session dialog gets a Branch dropdown with current/recent/local sections and '+ New branch from current' inline input. Dirty-tree → Stash/Cancel confirm."

In vbeta.18.36 smoke against the Rhythm repo at `/Users/ajhochhalter/Documents/Rhythm`:

- Dropdown DOES appear in the new-session dialog (✅ partial).
- "Recent" section renders.
- "Local" section renders (a long list).
- ❌ **No "Current" section visible.**
- ❌ Dropdown's inner panel is **not fully scrollable** — user can't reach the bottom entries / can't see whether the "+ New branch from current" inline input exists.
- ❌ Switching to `main` from the dropdown **failed silently** — HEAD did not change.
- ❌ Red error banner at the bottom of the app surfaced: **`type 'String' is not a subtype of type 'Map<String, dynamic>?' in type cast`**.

## Diagnosis (strong hypothesis)

The Dart type cast error is the root cause for the dropdown/switch failures. The branch-list response from the server (likely `GET /projects/:id/branches`) is being decoded with a cast that expects every entry to be `Map<String, dynamic>?`, but at least one entry is a raw string. The decoder throws partway through, leaving the dropdown with a partial state (recent + local parsed before the throw; current section never assembled; switch action's reference to the parsed list is invalid).

Likely candidates for the offending cast:
- `apps/desktop_flutter/lib/features/agents/` — wherever the branch list arrives from the WS or HTTP call.
- The server response may include a mixed shape — some entries as bare branch-name strings, some as `{name, sha, lastCommit}` objects — and the client assumed uniform Map shape.

## Reproduction (vbeta.18.36)

1. + New session → set working directory to a git repo (e.g. the Rhythm repo).
2. Branch dropdown appears.
3. Observe: red error banner appears immediately ("type 'String' is not a subtype...").
4. Open dropdown → "Recent" and "Local" populated; "Current" missing; can't scroll fully.
5. Pick a different branch (e.g. `main`).
6. Click Start.
7. `git rev-parse --abbrev-ref HEAD` in the project shows the OLD branch — switch did not take.

## Scope

Two-part:

### Server (probably already correct, but worth verifying)
- `GET /projects/:id/branches` — confirm the response is uniformly `Array<{ name: string, current: boolean, lastCommit?: string, ... }>` and never mixed string|Map entries.

### Flutter (where the cast error lives)
- `apps/desktop_flutter/lib/features/agents/views/` or `lib/features/projects/` — the branch-list parsing. Switch from `.cast<Map<String, dynamic>?>()` to a safer per-entry parser that handles both shapes (or asserts the server contract).
- Ensure the parsed entries flow into three explicit sections: **Current** (the one with `current: true`), **Recent** (last N checked-out branches per local config or branch-mtime), **Local** (everything else).
- Confirm the inner scroll view inside the dropdown allows reaching the bottom of long lists (CSS `max-height` + `overflow: auto`-equivalent in Flutter — likely a `Scrollbar` + `ListView` wrap).

## Acceptance criteria

- [ ] Branch dropdown opens with no type cast error in the SnackBar.
- [ ] All three sections render: Current (with the active branch highlighted), Recent (last 3-5 used), Local (all other local branches).
- [ ] Inner panel is scrollable to the bottom; "+ New branch from current" inline input is visible.
- [ ] Picking a different branch + Start changes git HEAD to that branch verifiably (`git rev-parse --abbrev-ref HEAD`).
- [ ] Dirty-tree scenario (uncommitted changes present) surfaces the Stash/Cancel confirm dialog from #603.
- [ ] Existing #603 tests still pass.

## Severity

High — the branch dropdown is one of the core #603 deliverables. The type cast error also means VCS 2 and VCS 3 smoke items are inheriting broken state from this same parse error. Likely "fix the one parse" repairs the whole VCS section.

## Related

Probably also affects the VCS chip popover (#607) since both surfaces parse the same branch-list response from the same endpoint. Verify after this fix lands.
