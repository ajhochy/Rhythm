---
date: 2026-08-15
repo: Rhythm
branch: self-improvement-engine-foundation
pr: 1398
issues: [W4, W6, W7, suite-listener-isolation]
status: integrated, not merged
tags: [run, Rhythm]
---

# W6 integrated, W7 unblocked, and the flake root-caused

## Files

- `apps/api_server/src/services/opencode_stream_bridge.ts` — interactive terminal hook no longer claims artifact production
- `apps/api_server/src/services/__tests__/run_outcome_terminal_hook.test.ts` — two guards for the above
- `apps/api_server/src/models/proposal_evidence_bundle.ts`, `services/proposal_evidence_validator.ts`,
  `models/agent_org_experiment.ts`, `repositories/agent_org_experiments_repository.ts`,
  `services/org_proposal_experiment_service.ts` — W6, new
- `apps/api_server/src/services/org_proposal_measure.ts` — W6 demotion of the body/rerun measures
- `apps/api_server/src/__tests__/helpers/real_server.ts` + 18 test files — listener binding
- `apps/api_server/src/__tests__/live_e2e_self_improvement_foundation.test.ts` — W7-2, W7-7, W7-8
- `docs/ai/contracts/issue-W6-experiment-contracts.json` — new

## Checks

Full suite run three consecutive times on the integrated head:
`561 passed | 105 skipped (666)` files, `5199 passed | 170 skipped (5369)` tests, exit 0 each time.
`npm run build` 0. `npx tsc --noEmit` 0. `git diff --check` 0.

Node v22.23.1. No live database touched; in-memory SQLite and temp files only.

## Notes

### The suite flake was port hijacking, not port exhaustion

`app.listen(0)` with no host binds the IPv6 dual-stack wildcard `::` and draws its
port from the IPv6 ephemeral pool, while the harness fetches `http://127.0.0.1:<port>`.
On macOS/BSD a *specific* bind to `127.0.0.1` on that same port is still permitted —
no `EADDRINUSE` — and the more-specific IPv4 listener wins every loopback connection.
Dozens of files already bound `listen(0, '127.0.0.1')` explicitly, so any of them could
be handed a wildcard-bound file's port and silently take over its traffic. The captured
symptom was a JSON endpoint returning an Express HTML 404 — the fetch had reached a
different server than the one that file started.

Reproduced directly at the kernel level rather than inferred: wildcard listener on port
P, then a *successful* `listen(P, '127.0.0.1')` in the same process, and a fetch to
127.0.0.1:P served by the second server.

Fix is one line in 19 files: bind `127.0.0.1` explicitly everywhere. No test weakened,
vitest concurrency untouched. `issue_1170_mobile_realtime_proxy.test.ts` deliberately
still binds `0.0.0.0` — non-loopback socket routing is that test's subject.

Three green runs raise confidence but cannot prove absence of a race; the kernel proof
is the stronger evidence, not the run count.

### The W4 interactive hook was recording success it never observed

`session.idle` is a TURN boundary, and the outcome row is written once and never
updated — so the first turn permanently defines the run. Worse, the interactive call
site hard-coded `producedArtifact: true`. Streaming text is not producing an artifact.
That literal routed around the finalizer's own rule that absent evidence can never
yield `success`, so the first turn of every interactive session with clean tool
telemetry was recorded `success`, permanently. W6 promotes on this ledger.

Now passes only the terminal status; unknown artifact evidence finalizes `inconclusive`.
Real signal for interactive runs comes from the append-only feedback events, which no
turn boundary can freeze.

Two guards, because the service was already correct and the defect lived entirely at
the call site — a service-level test alone passes identically with and without the bug.

### W6: the contract's first draft could be satisfied by a brick

Independent spec review found that `validate() → false` and `decide() → 'inconclusive'`
satisfied six of eleven criteria completely. `W6-c12` was added to require that
`promote` and `regress` both be reachable, in the same fixture table as the six
proxy-refusal cases. The implementation review then verified this by execution:
killing `decideExperiment` reddened 16 tests; flipping every adapter to
promotion-capable reddened exactly the six proxy cases plus the e2e proxy, proving
those fixtures reach the proxy gate rather than dying at the validator.

Two mutations survived the first W6 round and are now covered:
- `primaryMetric.direction` had never executed — dropping the ternary left all 118
  owned tests green. A candidate with a HIGHER terminal-error rate would have promoted.
- The retro-declaration guard was dead code.

### W6 stated limitation — read this before treating it as a live gate

No production caller declares, assigns, or judges an experiment. `declareAsync`,
`assignSubjectAsync`, `judgeExperimentAsync` and `decideExperiment` are reachable only
from the test suite. In production `outcome_status` can hold `unproven`, `inconclusive`
or `regressed` — **`verified` is unreachable outside the suite** until wiring lands.
This is broader than the `experiment_variant` limitation in W6-c5 and is recorded in
the contract per c12's requirement that unreachable promotion be declared rather than
left as a silently-passing test.

Also: `agent_run_outcomes` is UPDATE/DELETE-blocked in both engines, so an experiment
created after its runs can never retro-label them. Assignment must precede finalization
or pairing is impossible.

### W7 HAS now been executed — 8/8 green, twice

The sandbox was approved and brought up. Two consecutive full live runs of
`live_e2e_self_improvement_foundation.test.ts` against a real api_server +
opencode engine: `Test Files 1 passed (1)` / `Tests 8 passed (8)` both times.
W7-7 and W7-8 drive real interactive turns through the WS gateway.

**Sandbox constraint note.** `tools/dev/sandbox.sh:179` runs
`sqlite3 "$LIVE_DB" ".backup"` — its only supported bring-up READS the live
Rhythm database. That happened once before the script was read that far; it is
a read, not a mutation, and the copy was destroyed with `sandbox.sh down`. The
sandbox used for all recorded results was re-seeded from an EMPTY database via
`RHYTHM_LIVE_DB_PATH`, with a throwaway user (`w7-sandbox@example.invalid`)
created solely so the sandbox could install its own MCP server. To reproduce
without touching live data, point `RHYTHM_LIVE_DB_PATH` at a disposable file
and run `sandbox.sh` with a staged HOME containing only static-API-key
credentials — OAuth entries are keychain-bound, resolve to an empty model list,
and then SUPPRESS the openrouter routes that do work, leaving the catalog empty.

**What only execution found.** Source review had already fixed this file twice.
Running it found five more defects, four of them in the test and one in
production:

1. `POST /agent-configs` returns 201, not 200. The shared `createProfile`
   helper asserted 200, so ALL EIGHT cases died on their first call. Third
   instance of one defect class in this file.
2. `GET /agent-sessions/:id/messages` returns `{ messages, pageInfo }`, not a
   bare array — `.filter is not a function`.
3. W7-9 was SELF-BLOCKING. The shared `runOptimizer` helper hard-codes
   `maxLlmCallsPerRun: 0`, and `proposeFixFromSignals` breaks out of its group
   loop before creating anything when the budget is zero
   (workflow_signal_generator.ts:1148). Its positive control could never pass.
4. A generated profile id is never in `ROUTE_FALLBACKS_BY_AGENT`, so the
   gateway refused every turn with "could not resolve model for agentKind".
   Profiles now pin a model provider (#854 made the resolver consult
   agent_configs first).
5. **PRODUCTION DEFECT** — the deterministic workflow-signal lanes
   (`create-recipe`, `broaden-scope`) wrote `audit_run_id = NULL`. The
   LLM-diagnosis path in the same file always stamped it. Unattributed rows are
   invisible to every per-run query, including `deleteRunProposals` cleanup;
   the sandbox accumulated four orphan proposals nothing could find. Fixed and
   covered by a mutation-checked unit test, so it no longer depends on the live
   gate to catch.

`driveTurn` also now fails fast with the gateway's own refusal message instead
of burning a 180s timeout to report a bare "timed out" — the server was
explaining itself the whole time and the test discarded it.

### Postgres is now executed, and it was broken

A disposable `postgres:16` container runs the real `runPostgresBootstrap`
behind `RHYTHM_LIVE_PG=1` (inert by default; the normal suite is unaffected).

On its first honest run the bootstrap FAILED: an `ALTER TABLE
agent_research_qa_links ADD COLUMN ... REFERENCES agent_sessions(id)` declared
a foreign key to a table created ~280 lines later. **`runPostgresBootstrap`
could not complete against a fresh Postgres database**, and the regex guard was
green throughout. The mutation evidence states the gap exactly: injecting
`EXECUTE FUNCION` into a CREATE TRIGGER turns the new test RED while the regex
guard stays GREEN on the same mutated file.

It then found 13 columns present in SQLite and absent from Postgres
(`agent_sessions` x7, `agent_configs` x6) — production 500s waiting to happen,
missed because neither table was on the guard's list. All 13 added additively.

The type decision matters more than the columns: four are 0/1 flags and were
given `INTEGER`, NOT `BOOLEAN`, because the repository layer reads them as
`row.fast_mode === 1` / `(row.image_generation_enabled ?? 0) !== 0`. `pg` maps
BOOLEAN to JS booleans, and `false !== 0` is true — a BOOLEAN column would read
every flag as SET and invert `auto_approve_actions`. Silent wrong values that
pass every schema check.

Two pre-existing parser bugs in the parity guard were fixed to make the new
tables usable: the CREATE TABLE regex terminated on the wrong token and ran
past table bodies, and the ALTER regex required a literal single space, hiding
every prettier-wrapped `ALTER TABLE` — including `agent_configs.revision`.

Still uncovered in Postgres: column TYPES (names only are compared),
constraints and defaults, index/FK parity, all triggers but two, and any
runtime repository/route behaviour. The `created_at` default divergence is
recorded as `it.fails`, not skipped:

    PG     : 2026-08-15T20:08:04.829Z
    SQLite : 2026-08-15 20:08:05  ->  2026-08-16T03:08:05.000Z

A seven-hour skew on identically-named columns. Not fixed: 98
`DEFAULT (datetime('now'))` sites, and with `CREATE TABLE IF NOT EXISTS` every
already-migrated local DB would end up mixing both formats in one column, where
`' ' < 'T'` also breaks ordering. It needs its own change with a backfill.

**The new Postgres suite is not wired into CI** — it needs a `services:
postgres` block plus `RHYTHM_LIVE_PG=1` in `.github/workflows`.

### Latent, flagged rather than fixed

All four are now FIXED (see above for the Postgres pair):

- `org_audit_service.ts` capped its session read at 1000, newest-first, so a profile
  whose runs are older than the newest 1000 counted zero and the audit silently
  reported nothing to improve. Confirmed reachable — this repo's own history records
  3,763 and 4,855-session consolidations. Fixed with an uncapped narrow-column read
  (`listOwnershipFacets`), not a bigger number, which would only move the threshold.
- The live-artifact storage race is closed by per-file isolation (a private tmpdir
  root), not by serialising the files, plus a static guard that fails if a future test
  file uses the shared path without overriding it.
- W5's `agent_org_proposal_retirements` sidecar is migrated into both engines and on
  the parity guard's list; the lazy runtime creation is REMOVED rather than kept, since
  a third copy of the DDL is itself the drift risk.

One judgement call worth review: closing the sidecar required lowering the parity
guard's sanity floor from `> 5` to `> 0`, because that table is legitimately 5 columns
wide. The floor only distinguishes "parser found nothing" from "columns differ", and a
drift mutation (deleting one Postgres column) was verified to still redden the guard.
