---
date: 2026-10-08
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
issues: []
status: READY_FOR_VERIFICATION
tags: [run, Rhythm]
---

## Files / approved scope

- Assigned disjoint safety slice: `tools/dev/sandbox.sh` and one shell contract,
  `tools/dev/sandbox_preserve_files_test.sh`. Existing app writers retain ownership.
- This run receipt is the sole additional file required by the mandatory workflow
  logging instruction, conflicting with the dispatch's no-docs restriction.
- No commit/push/install, online API/key/model access, deletion (including fixture
  cleanup), real process signal, server launch/restart/stop, or live-port access.
  Manager sandbox `/private/tmp/sdmr-grid-sandbox` (4398/4397/4399) untouched.

## Phase 0 / checks

Contract command, from the assigned worktree:

```sh
HOME=/private/tmp/sandbox-preserve-check.YVmPbL/home TMPDIR=/private/tmp/sandbox-preserve-check.YVmPbL/tmp bash tools/dev/sandbox_preserve_files_test.sh
```

Fixtures were created with `SB="$(mktemp -d /private/tmp/sandbox-preserve-check.XXXXXX)"`
and `mkdir "$SB/home" "$SB/tmp"`; nothing was removed.
Initial fixture executable `/bin/true` was corrected to macOS `/usr/bin/true`
before implementation. Confirmed RED: exit 1, six behavioral failures: preserve
down invoked marker/directory rm, failed-up invoked marker rm, restart-engine
invoked PID rm, and empty/2/true flag values were accepted.
RED fixtures retained at `.../tmp/preserve-contract.VYVeNF`.

After implementation: same command exited 0, ten lifecycle cases and three
invalid-value cases PASS, `failures: 0`. GREEN fixtures retained at
`/private/tmp/sandbox-preserve-check.YVmPbL/tmp/preserve-contract.80SORA`.

Exact syntax/diff commands, all exited 0:

```sh
bash -n tools/dev/sandbox.sh
bash -n tools/dev/sandbox_preserve_files_test.sh
git diff --check -- tools/dev/sandbox.sh
```

Owned untracked whitespace was also inspected with
`git diff --no-index --check /dev/null tools/dev/sandbox_preserve_files_test.sh`
and the same command for this receipt: no whitespace findings (no-index status
1 represents added content). Final repeated syntax/tracked-diff checks exited 0;
focused status showed only the three owned files above. Final contract rerun
exited 0, all 13 cases PASS; retained fixtures:
`/private/tmp/sandbox-preserve-check.YVmPbL/tmp/preserve-contract.dRAFA9`.

Contract mappings: down-unset/down-default verify unchanged removal calls and
message; down-preserve verifies no rm, exact message, PID/shutdown evidence and
sanitized diagnostics; failed-default/failed-preserve verify trap status 7 and
marker behavior; restart-default/restart-preserve verify replacement PID 202
and preserved old PID 102; guard-default/guard-preserve reject API PID mismatch
before removal; reuse rejects existing sandbox directory; invalid empty/2/true
values reject before dispatch. Real shell lifecycle bodies execute; only process,
network and deletion boundaries are synthetic; restart launch is a stand-in.
These do not qualify real process termination. Existing shell suites were not run
because their cleanup/lifecycle effects are outside this no-deletion assignment.

## Phase 1 / impact and risk review

CLI commands before implementation:

```sh
gitnexus impact stop --direction upstream
gitnexus impact stop --direction upstream --repo Rhythm
gitnexus impact down --direction upstream --repo Rhythm
gitnexus impact restart_engine --direction upstream --repo Rhythm
gitnexus impact cleanup_failed_up --direction upstream --repo Rhythm
```

No local `.gitnexus` index. CLI first required a repo; Rhythm index warned this
worktree is 176 commits ahead. `stop` matched unrelated non-shell symbols;
down/restart_engine/cleanup_failed_up were not found, risk UNKNOWN. Shell-static
graph limitation: no authoritative indexed shell blast radius. Read the entire
837-line script and inspect shell call sites instead. `stop` is called by down,
restart and cleanup_failed_up; cleanup is trapped by up and relay restart;
CLI dispatch calls down/restart-engine; parity-gate calls down; existing guard
and dual-role tests exercise those paths. Diagnostics has no deletion.

Consequential risk is bypassing process ownership or accidentally allowing reuse:
all existing path, PID, executable, listener and existing-directory guards remain
unchanged. Only the three rm sites are gated. Failed-up inherits preserve behavior
through stop. Restart-engine copies prior PID to a unique mktemp sibling before
launch overwrites the active PID. Preserved directories still block up. Default
zero behavior remains unchanged; an explicit empty value is invalid.

## Handoff

READY_FOR_VERIFICATION for this slice only. No project-state update or app edits.
Manager alone may invoke preserve=1 down after writers/tests finish, keeping the
same sandbox directory and all port settings. Actual teardown was intentionally
NOT RUN. All generated tests, synthetic directories and evidence retained.
