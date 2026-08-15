# Rhythm — Project State

## Current focus

The self-improvement engine foundation (W1–W7) is complete and integrated on one branch, awaiting
manual smoke and a human merge decision. The Cloud Gateway/mobile release work that preceded it is
done: hosted API/relay and desktop `v0.18.58` released, iOS `1.0.8 (6)` uploaded to App Store Connect.

## Active branch / PR

- **PR #1398** — `self-improvement-engine-foundation` → `main`. Draft, never merged. ~85 commits,
  ~150 files. This is the active work.
- Prior Cloud Gateway PRs #1388 / #1389 / #1390 all merged.

## In progress

- Awaiting a manual smoke of the optimizer's approve/revert path on a real machine, then a human
  merge decision on #1398. Nothing else is blocked.
- Apple processing for iOS build 6 (unrelated to #1398).

## Risks / known issues

- **GitNexus reports risk CRITICAL for #1398** — 153 files, 624 symbols, 20 affected execution
  flows. The blast radius is the `agent_configs` / `agent_org_proposals` read-write paths, which is
  exactly what the revision-CAS work set out to change, so it is consistent with the design rather
  than evidence of an accident. It runs through the human approval path and wants a human's eyes.
- **W6 `verified` does not yet mean what its name claims.** Cohort assignment is wired and
  `verified` is reachable, but nothing applies the baseline/candidate specs per run — the change is
  already deployed to everyone by the time a run enrols, so a `promote` today is effectively an A/A
  result over an already-deployed change. Bounded by shadow-by-default (never writes an outcome) and
  by requiring an operator-declared experiment. Per-run spec application is the follow-up.
- **The `created_at` timezone fix is Stage 1 of 2.** Fresh databases now emit ISO-8601 UTC and match
  Postgres. ALREADY-MIGRATED databases are untouched — `CREATE TABLE IF NOT EXISTS` makes the DDL
  change inert on them — so existing installs keep the 7-hour skew and the pre-existing mixed-format
  ordering bug. Stage 2 needs a 12-step rebuild of 60 tables, including two immutable ledger tables
  that physically reject UPDATE, and revision-preserving handling for the CAS-token tables.
- **Postgres CI has never actually executed on GitHub Actions** — the job is written and proven
  locally against the same image and command, but the runner-side wiring is unverified until a PR
  touching `apps/api_server/**` triggers it.
- `tools/dev/sandbox.sh` READS the live Rhythm database in its only supported bring-up
  (`sqlite3 "$LIVE_DB" ".backup"`). Point `RHYTHM_LIVE_DB_PATH` at a disposable file to avoid it.
- The GitNexus MCP tool cannot read the current index (built v42, server reads v41). Use the CLI.

## Test status

- API suite on the integrated head: **563 files / 5,225 tests passed, 176 skipped, exit 0**.
  `npm run build` 0, `npx tsc --noEmit` 0. Node v22.23.1.
- Live E2E (`RHYTHM_LIVE_E2E=1`, isolated sandbox): **8/8 passed, twice consecutively** — the first
  execution of that suite in its history.
- Live Postgres bootstrap (`RHYTHM_LIVE_PG=1`, disposable container): **6/6 passed**, no
  expected-fails remaining.
- Independent reviews: one per work package, plus a first integrated cross-package review
  (ACCEPT WITH CHANGES — three P1s found and fixed) and a static security review (two P2s found and
  fixed).
- Suite flakiness: one uncaptured single-test failure in one of three consecutive runs before the
  final merge; the three runs after it were clean. Root cause of the earlier rotating flake was
  fixed (IPv6-wildcard test listeners being hijacked on loopback).

## Next step

Manual smoke of #1398: approve and revert an optimizer proposal on a real machine. Then the human
merge decision. Full detail in `docs/ai/runs/2026-08-14-self-improvement-engine-foundation.md`.

## Recent coding-agent runs

- 2026-08-14 — W1 corrective cycle 2 on `agent-stack/si-scope-safety`: removed the unattended scope
  mutation lane; added recursive ambiguous-scope refusal, projection-result compensation gates,
  non-null local operator attribution with exact atomic change binding, and reserved-identifier
  rejection. Parent Node 22 corrective gate: 213 passed with 1 existing skip, including 19/19 real
  HTTP route tests rerun outside the worker sandbox; API build and static scan passed. This work is
  verification-pending, not finally approved; independent review remains. See
  `docs/ai/runs/2026-08-14-w1-scope-safety.md`.

### 2026-08-14 — W1 corrective cycle 3
- Files modified: scope apply/revert services, proposal controller/apply contract comments, fixed-field
  config CAS, focused API/repository/route/core-permission tests, and the W1 contract/run evidence.
- Checks run: RED proofs recorded in the run note; Node 22 non-socket corrective gate PASS (11 files,
  257 passed, 1 existing skip); parent Node 22 complete gate PASS (12 files, 284 passed, 1 existing
  skip, including 23/23 real HTTP route tests); API build PASS.
- Decisions made: retain `scope-delta-v2` for removal-only rollback and add sibling `scope-state-v2`
  for mixed/add/core exact-state rollback; share deferred CAS/projection/compensation mechanics.
- Deviations from spec: no live server or live DB was started.
- Concerns: independent review of `47bd426e` found seven P1 fail-closed blockers spanning semantic
  snapshot validation, ambiguous payloads, risk gating, exact change binding, and status-failure
  compensation. Status is corrective-in-progress; W1 remains unaccepted and unmerged.

### 2026-08-14 — W1 corrective cycle 4
- Files modified: one strict scope mutation/snapshot contract, human approval wiring, scope revert
  lifecycle/risk classification, focused API tests, and W1 contract/run evidence.
- Checks run under Node 22: parent complete 13-file gate passed 323 tests with 1 existing skip,
  including 23/23 real HTTP route tests and 39/39 corrective-4 regressions; API build passed.
- Decisions made: bind both v2 snapshots to allowed kind and exact `change_json` bytes, independently
  replay prior/change/applied semantics at revert, and compensate failed final status transitions by
  exact CAS plus reprojection without overwriting concurrent target bytes.
- Deviations from spec: all five temporary reviewer probes were replaced by equivalent committed
  in-memory SQLite regressions; no live DB, persistent server, network, W2/W3, or integration work ran.
- Concerns: both fresh independent review lanes failed exact head `4406a1ce`. Parent reran their
  in-memory probes and reproduced eleven unique blockers. Corrective 5 is rejected and superseded.

### 2026-08-14 — W1 corrective cycle 5
- Both independent corrective-4 review lanes failed at exact head `db78072b`: semantic review found
  seven P1/spec blockers and lifecycle review found three P1/spec blockers.
- Parent reproduced the duplicate-key, scope-smuggling, null-unrestricted, mislabeled-gating,
  stale-status-race, and ambiguous-commit split-brain probes under Node 22.
- Decision: stop patching one-sided compensation. Corrective 5 requires duplicate-aware JSON,
  one shared scope-bearing detector, source-status CAS for SQLite/Postgres proposal transitions, and
  an atomic scope target/status revert primitive with fail-closed projection compensation.
- Status is architecture-redesign-in-progress; W1 remains unaccepted and unmerged.
- Implementation now has strict duplicate-aware JSON, shared recursive scope detection, source-status
  CAS, an atomic SQLite scope revert/inverse primitive, PostgreSQL split-store refusal, and runtime
  actor binding. Parent Node 22 verification passed the exact 14-file matrix with 396 tests and 1
  existing skip, including the real HTTP route suite; API build, adversarial reproducers, and diff
  checks passed, but the broader adversarial review exposed uncovered lifecycle and boundary flaws.
- Corrective 6 redesigns the durable pair around an intermediate approval/apply state, monotonic
  proposal/config revisions, revision-fenced latest-state projection, durable reconciliation, strict
  parsing at every lifecycle boundary, and field-specific runtime semantics.
