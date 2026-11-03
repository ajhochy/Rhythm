---
date: 2026-10-10
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
status: stopped-handoff
tags: [run, rhythm, router, sandbox, handoff]
---

# Router sandbox STOP handoff

## STOP state (04:21 UTC)

No owned sandbox is listening on 4397/4398/4399; fresh Postgres 5559 is stopped. PID files in the three retained sandbox
roots are stale receipts, not live processes. Do not signal them. Live installed Electron is PID 26531 (API 4001/4002)
and PID 26567 (engine 4096); untouched. Frozen historical Postgres PID 43478 remains `T` on 5548; never resume/stop/delete.
Coordinator is externally owned; 4797/4798/4799 were empty at checkpoint, but never launch/contact them from Router.

## Source qualification boundary

Last fully qualified predecessor is r26 manifest:
`/private/tmp/rhythm-pr1611-r26-electron-closure.json`, SHA
`af0d59e80264dc3923694629f11a8f5de3b4a59d7557df3ea2b3cbde653f4ee2`.
It includes P1 Postgres ordering, unsafe VM removal, grid fail-closed, idle recovery, restart provenance and pending/applied
receipt ordering: targeted 38/38, affected 203/203, fresh PG all/cloud, corrupt-state 502 zero dispatch, grid13.

Current worktree is NEWER and NOT fully qualified/frozen. Audit179 edits in progress:
- explicit `initializeRouterFreeRecovery()` called by `createApp` (cold-start listener);
- `markPinned` durable INSERT errors propagate before account/unmark/routing;
- legacy route rows missing `applied` become ambiguous/false.
RED was 3/20. Latest focused run still had 2 repository-test failures due fixture expectations (one legacy test accidentally
inserted `applied:true`; one restart fixture expected legacy behavior). Do not call audit179 green or package/publish until
those tests, cold restart live proof and final affected suites pass. No tool is pending.

## Known-working Router sandbox launch (existing retained cohort)

Run only from repo root. Never hand-start api_server or engine.

```bash
SB=/private/tmp/sdmr-grid-sandbox
PROFILE=/private/tmp/no-unlink-enforcement-20261009/runtime-fresh-cohort-v4.sb
NODE=/private/tmp/original-dayflow-runtime-final-r4/grid-node-workstreams
/usr/bin/sandbox-exec -f "$PROFILE" env -i \
  HOME=/Users/ajhochhalter \
  PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  RHYTHM_SANDBOX_DIR="$SB" \
  RHYTHM_SANDBOX_API_PORT=4398 \
  RHYTHM_SANDBOX_ENGINE_PORT=4397 \
  RHYTHM_SANDBOX_GATEWAY_PORT=4399 \
  RHYTHM_SANDBOX_PRESERVE_FILES=1 \
  RHYTHM_SANDBOX_NODE_BIN="$NODE" \
  tools/dev/sandbox.sh restart
```

The wrapper sets the Electron production pair required by Dayflow:
`RHYTHM_WORKSTREAMS_ENABLED=true`, `RHYTHM_MANAGED_CONTEXT_EXPORTS=1`, and the grid transport preload. Missing the export
flag produces real `proof_unavailable` holds before provider admission (launcher/config failure, not runner generation).

Prerequisites (read-only; do not replace): retained `$SB/rhythm.db`, `$SB/home`, `$SB/vault`; immutable fixture sources
`/private/tmp/sdmr-grid-fixture/rhythm.db`, `/private/tmp/original-dayflow-approved-r1/dayflow.sqlite`, and owned-copy
unavailable journal `/private/tmp/original-dayflow-approved-r5-unavailable/dayflow.sqlite`. Public fake provider uses
127.0.0.1:7482; scheduled/Memory fake provider uses 7481 through the exact finite transport rule. No real credentials.

## Readiness and descendant attestation

```bash
tools/dev/sandbox.sh status   # with the exact SB/port env above
curl -fsS http://127.0.0.1:4398/health
curl -fsS http://127.0.0.1:4397/global/health
A=$(cat "$SB/api_server.pid")
python3 /private/tmp/no-unlink-enforcement-20261009/attest-tree.py "$A" 19755 \
  > "$SB/<new-exclusive-name>-guard-attestation.json"
```

Expected: API 4398, engine 4397 child of API, gateway 4399 when enabled; engine hash c4912cdb for historical r26. Never
reuse stale PID identity or claim current source from an old process. Bind each run to API dist module digest, engine hash,
config hash, test SHA, PIDs and guard attestation.

## Normal preserving stop

Do not use sandbox-exec for stop (ownership checks need normal host process visibility). Never `rm` the sandbox.

```bash
env -i HOME=/Users/ajhochhalter \
  PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  RHYTHM_SANDBOX_DIR=/private/tmp/sdmr-grid-sandbox \
  RHYTHM_SANDBOX_API_PORT=4398 RHYTHM_SANDBOX_ENGINE_PORT=4397 RHYTHM_SANDBOX_GATEWAY_PORT=4399 \
  RHYTHM_SANDBOX_PRESERVE_FILES=1 \
  RHYTHM_SANDBOX_NODE_BIN=/private/tmp/original-dayflow-runtime-final-r4/grid-node-workstreams \
  tools/dev/sandbox.sh down
```

## Failure classification and remedy

- `GRID_TRANSPORT_REFUSED`: test fixture destination/identity mismatch (for example 7481 before its exact public-token rule),
  not an OS block or product pass. Never broaden generic loopback.
- `EPERM` rename/rmdir during Vitest: strict no-unlink profile vs test cleanup. Use the preserving Vitest configs and a
  narrowly owned fresh tmp unlink rule; never weaken old evidence/source protection.
- `SOURCE_CHANGED`: owned-ledger journal binding. Use a genuinely fresh cohort/ledger; never switch an existing ledger to a
  copied source or mutate approved r1.
- `proof_unavailable` with no provider attempt: verify both API and engine have `RHYTHM_MANAGED_CONTEXT_EXPORTS=1` and the
  corrected `RHYTHM_AGENT_URL`; do not patch runner generations speculatively.
- `history_ambiguous` on expiry: duplicate profile system prompt in interactive gateway was fixed; retained r5 failures are
  evidence. Routine receipt renewal compares exact identity except expiresAt after r5c repair.
- Extra `original-dayflow`/`sdmr` auth entries make the 13-case grid beforeAll fail. Preserve auth snapshot, remove entries
  only via engine auth API, run, restore parsed-equal. Never edit credential files by hand.
- Active fake-account cooldown: wait for natural expiry; never clear it.
- Postgres bootstrap: use fresh retained PostgreSQL17 root/port only. Known final proof root
  `/private/tmp/rhythm-r23-pg-bootstrap`; all/cloud logs 5a780325/cd65e698. Never touch frozen 43478.
- Unsafe public coding: intentionally held `untrusted_code_execution_unsupported`; no Node VM/provider-JS executor.

## Evidence pointers

- Grid final r26: `/private/tmp/sdmr-grid-sandbox/final-r26-grid-matrix.log` (13/13).
- Grid corrupt-state r23: `final-r23-failclosed-live.log` (502, zero provider/native/dispatch).
- Idle release r25: `final-r25-idle-recovery-live-2.log` (fresh usage, no trigger turn).
- Restart provenance r25: r14c receipts `r25-restart-phase-a.log`, `r25-restart-phase-b-3.log`.
- Combined scheduled/Memory r15: r14c `r15-combined-sched-memory.log` (7 pass / S3 mechanism skip; A4 real guard reason).
- Mobile gateway r17: `final-r17-mobile-gateway.log` + drain follow-up; synthetic device revoked and refused.
- Case8 RGB repair r19: r14c `r19-image-fixture-repair.log`; old invalid bytes/custody under main tmp/r19-image-fixture.

## Explicit separations

Coordinator API/restart/repair is externally owned. This document contains no Coordinator launch commands and does not
qualify its source/runtime. STRICT C3 evaluator is UNPROVEN; do not infer it from Router sandbox or existing assertions.
Electron packaging/publication/signing/activation is stopped. Flutter abandoned; retained lock diff is excluded.
