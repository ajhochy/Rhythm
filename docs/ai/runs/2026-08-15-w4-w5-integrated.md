---
date: 2026-08-15
repo: Rhythm
branch: self-improvement-engine-foundation
pr: https://github.com/ajhochy/Rhythm/pull/1398
issues: [W4, W5]
status: integrated
tags: [run, Rhythm]
---

# W4 + W5 integrated

Both packages built in parallel isolated worktrees, independently reviewed, and
merged after their review findings were closed.

## W4 — immutable outcome and feedback ledger

New `agent_run_outcomes` + `agent_run_feedback_events`, a deterministic
finalizer, a feedback route, and terminal hooks. Review verdict: ACCEPT WITH
CHANGES. Closed:

- **P1 immutability was overclaimed.** The triggers block UPDATE and DELETE but
  not `INSERT OR REPLACE` — SQLite fires BEFORE DELETE for REPLACE conflict
  resolution only under `PRAGMA recursive_triggers`, which is off here. The
  reviewer reproduced a rewrite from a second connection. Flipping the pragma
  would change REPLACE semantics for every other table, so the claim is scoped
  to what the schema provides and a test pins the boundary in both directions.
- **P2 attribution strings were never redacted** — only the feedback reason was.
  A prompt or key reaching `attribution.tools[].name`, via a caller or an
  oddly-named MCP tool in real telemetry, landed verbatim.
- **P2 objective evidence was read from the child session** while the row is
  keyed on the root, so a child's terminal event produced an outcome ignoring
  the root run's own errors.
- **P2 the repository accepted junk** — it is the surface W5/W6 call directly.

## W5 — shadow policy and lifecycle reconciler

Policy parser defaulting to shadow, a gated run loop, a read-only reconciler and
a dry-run operator script. Review verdict: ACCEPT WITH CHANGES, one P0.

- **P0 the shipped script reported a false clean bill of health.** The wrapper
  never called `initDb()`, so `getDb()` threw, the repository constructor caught
  it and quietly substituted a fresh in-memory database, and the operator got
  well-formed all-zeros JSON with exit 0. The suite could not catch it: every
  test imported `runReconcileCli` after calling `setDb()`. Fixed, and pinned by
  a test that executes the real script in a child process.
- **P2 shadow borrowed the acting counter names** — `projectionsRepaired`
  counted would-have repairs, and the report-only stand-in can never populate
  `projectionsUnresolved` because it never attempts a projection.
- **P2 policy resolution ran before the try block**, so a throwing caller getter
  escaped the documented never-throws guarantee.

The reviewer independently confirmed the shadow gate itself: 19 hostile mode
inputs (whitespace, case, homoglyphs, boxed strings, prototype getters) all
resolve to `shadow`; a whole-database before/after comparison shows zero tables
changed under shadow while `human_only` moves two; and no kill switch or mode
can block the human-approved apply/revert path.

## Checks

- full api_server suite: 5112 passed, 170 skipped
- `npm run build`, `tsc --noEmit`: clean

## Suite health — the honest caveat on that number

Seven distinct test files have now been observed failing under a full-suite run
and passing in isolation, a different one most runs:

`agent_designs`, `rhythm_telemetry_plugin`, `issue_1168_mobile_gateway_security`,
`agents_models_catalog`, `live_artifacts`, `projects_checkout`,
`org_proposals_routes`.

Every one of them binds a real HTTP listener. The suite is 662 files run in
parallel, and the shared shape points at listener/port contention rather than
any campaign change — all seven pass alone, on this branch and on the base.

This matters beyond tidiness: "full suite, 0 failed" is the gate this campaign
has been leaning on, and it currently takes more than one run to obtain. Any
single green run is weaker evidence than it looks. Worth a separate fix
(ephemeral ports, or serialising the route tests) before W7 treats the full
suite as a release gate.
