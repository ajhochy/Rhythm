---
date: 2026-09-24
status: operator-review-required
tags: [release, engraph, issue-1574]
---

# Engraph stray-backend inventory and cleanup

This is an AJ-operated recovery procedure for legacy processes. Rhythm reports
unmarked processes but deliberately does not signal them. Never automate this
procedure, use `pkill`/`killall`, or kill by process name or port.

## Read-only inventory

With Rhythm's existing local API running, record only the entries requiring
manual inspection:

```bash
curl --fail --silent http://127.0.0.1:4001/engraph-manager/status \
  | jq '{executablePath,engraphHomeDir,backends:[.backends[] | select(.classification == "stray" or .classification == "foreign")]}'
```

Do not start another api_server to run this command. The equivalent OS-level
inventory is:

```bash
/bin/ps -axo pid=,ppid=,lstart=,command= \
  | awk '/engraph serve --http/ && /--port [0-9]+/ && /--host 127\.0\.0\.1/'
```

The expected candidate command shape is
`engraph serve --http --port <n> --host 127.0.0.1` (additional fixed flags such
as `--read-only` may appear). Keep PID, PPID, start time, and full command
together so PID reuse cannot turn an old review into authority for a new
process.

## AJ's per-process kill criteria

AJ must review each candidate separately. A PID is eligible only when every
condition below is true:

1. Its PPID is `1`, or the recorded parent PID no longer exists.
2. Its command resolves to the exact `executablePath` reported by status.
3. Its files/config belong to the `engraphHomeDir` reported by status (the
   Rhythm `engraph-home`), not another tool's Engraph home or vault.
4. Its current PID, start time, PPID, and command still match the reviewed
   inventory immediately before action.
5. Its status classification is `stray` or `foreign`; it is not the currently
   `owned` or `reused` PID.

If any condition is unknown, preserve the process and investigate manually.
For a fully reviewed PID, AJ may run only:

```bash
kill -TERM <reviewed-pid>
```

Then rerun both read-only inventories and record the result. Do not escalate to
`SIGKILL` without a fresh identity review, and never delete
`engraph-home/.engraph/serve.owner` as a substitute for process review.

## Why startup remains blocked

The manager refuses to spawn while any matching unmarked serve process exists;
see `apps/api_server/src/services/engraph_manager.ts:927-937`. This fail-closed
behavior prevents a second backend from competing for the same Rhythm-managed
home. Cleanup is complete only when status has no reviewed legacy `stray` or
`foreign` entry and the intended backend can start as `owned`.
