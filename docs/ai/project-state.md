# Rhythm — Project State (worktree: causal-runtime-v2-codex)

## Current focus

Extending the accepted self-improvement-engine foundation (W1–W7, PR #1398) with the
**causal-runtime-v2** campaign: a truthful pre-deployment causal experiment runtime and
calibration layer, contracted in `docs/ai/contracts/issue-causal-runtime-v2.json` (phases C0–C6),
tracked in GitHub issue #1448. Goal: no experiment can report `verified` without real
treatment-bound receipts from both cohorts, and only a tested exact candidate can be CAS-applied.

## Active branch / PR

- Branch: `agent-stack/si-causal-runtime-v2-codex` (this worktree). No PR opened for this branch
  yet — work continues past the foundation's PR #1398, which stays draft/unmerged and unaffected.
- Head commit: `11b3b06d` — `test(optimizer): prove WS redispatch reuse is already idempotent`
  (C2-D S5 / #1448), on top of `156b4a6f` (C2-D S4). A live coding-agent session was actively
  committing to this branch while this snapshot was written (S4 and S5 both landed within minutes
  of each other) — re-check `git log`/`git status` before assuming this is still the head.

## In progress

Accepted so far (each parent-verified: focused tests + build + `tsc --noEmit` clean, run by the
orchestrator, not just builder-claimed):

- **C0** `97871dd4` — truthful collecting/inconclusive verdict hotfix.
- **C1** `d0466e50` — pre-run episode enrollment + atomic exposure reservation, Postgres parity.
- **C2-A** `c303c47e` — dispatch bound cohort treatments.
- **C2-B** `83cf6d42` — persist immutable treatment receipts.
- **C2-C** `019a9c78` — wire atomic treatment receipt at the real prompt-dispatch boundary.
- **C2-D (S1)** `12f80482` / #1449 — fixed `run_outcome_service.ts` resolving enrollment via
  `rootSessionId` instead of the computed `runEpisodeId`.
- **C2-D (S2)** `1306a3ea` / #1450 — `run_episode_id` column on `agent_run_outcomes`
  (SQLite + Postgres) and a new, tested `listReceiptBackedByExperimentAsync` repository method.
  Deliberately **not** wired into the live `judgeExperimentAsync`/`computeDecisionAsync` call
  sites yet — that swap is explicitly deferred to C3/C4 (see Risks).
- **C2-D (S3)** `391dd5aa` / #1451 — threaded `runEpisodeId` through `ws_gateway.ts` →
  `opencode_stream_bridge.ts`'s three terminal-hook call sites so interactive WS runs record
  outcomes against the right enrollment. Live sandbox check explicitly skipped (no live-triggerable
  surface exists yet for it; relies on a focused test driving the real WS bridge code).
- **C2-D (S4)** `156b4a6f` — interactive WS reservation/receipt at the `promptAsync` boundary in
  `ws_gateway.ts`, mirroring `agent_runner.ts`'s C1/C2-C reserve-before-dispatch +
  commit-at-dispatch contract. Orchestrator re-ran the combined S4+S5 test file (5/5 pass),
  `tsc --noEmit` (clean), `npm run build` (clean), and `git diff --check` over the S4..S5 commit
  range (clean).
- **C2-D (S5)** `11b3b06d` — idempotent redispatch/retry reuse. Investigation found the existing
  reserve/prepare/commit chain (`reserveRunEnrollment`'s idempotency check +
  `dispatchAndFinalizeReceiptAsync`'s existing-receipt check) was already correct through the S4 WS
  boundary; a new test proves it, **no production code changed**. Verified together with S4 above
  (same file, same gate run).

Not started:

- **C2-D (S6)** live isolated-sandbox WS E2E (baseline vs. candidate, distinct effective prompts,
  no durable mutation) — in flight in a separate coding-agent session as of this writing.
  `issue-1448.json` criteria c4–c6 are still **UNVERIFIED**, pending a `RHYTHM_LIVE_E2E=1` sandbox
  run. The only remaining open item under #1448's C2-D scope.
- S4–S6 exist only as rows in #1448's tracking table, not yet filed as their own GitHub issues
  (unlike S1/#1449, S2/#1450, S3/#1451).

Not started: **C3** (treatment-bound outcomes/executable metrics/guardrails), **C4** (fixed-horizon
decision + tested-candidate promotion), **C5** (automatic evidence construction), **C6** (versioned
calibration + operator/release surface). Per the contract's own phase list each blocks specific
downstream work until it lands (C3 needs receipt-filtered outcomes from S2 wired in; C4 needs C3;
C5 and C6 are prerequisites named by later-phase dependency notes for further D-series work after
C6 — do not start those before C3–C6 land).

**Gate policy for this campaign (AJ's explicit direction):** the full `apps/api_server` suite is
deferred to the end of the whole C2-D→C6 sequence, not rerun after every slice. Only focused tests
+ build + `tsc --noEmit` are verified per slice. Do not claim a full-suite pass until that final run
actually happens.

## Risks / known issues

- **Receipt filtering exists but isn't load-bearing yet.** S2 built `listReceiptBackedByExperimentAsync`
  as a real, tested, additive capability, but the live promotion path
  (`judgeExperimentAsync`/`computeDecisionAsync`) still counts unfiltered outcomes — wiring it in is
  explicitly C3/C4 scope ("Not started"). Until then, C0's fail-closed
  "paired-cohort-outcome cannot verify without treatment-v2 receipts" guard is the only thing
  preventing an A/A experiment from promoting.
- **S6 unverified:** no live sandbox run has proven baseline/candidate runs get distinct effective
  prompts through the real WS path, or that target bytes stay unchanged. `tools/dev/sandbox.sh`
  reads the live Rhythm DB on its only supported bring-up — point `RHYTHM_LIVE_DB_PATH` at a
  disposable file before running it for S6/C6 checks.
- No GitHub issues filed yet for S4/S5/S6 individually — only tracked as rows under #1448.

## Test status

- Per-slice only, per the campaign's deferred-full-suite gate policy — no full `apps/api_server`
  suite run has happened on this branch since `1a35f352`.
- C0, C1, C2-A/B/C, C2-D S1–S5: each parent-verified at its head with focused tests + build +
  `tsc --noEmit` clean (see each phase's run note / `docs/ai/contracts/issue-14{49,50,51}.json` +
  `issue-1448.json`).
- S6: no run yet — requires `RHYTHM_LIVE_E2E=1` against the isolated sandbox.

## Next step

**S6** (live sandbox WS E2E, in flight) → **C3** (treatment-bound outcomes/guardrails) →
**C4** (fixed-horizon decision/promotion) → **C5** (evidence construction) → **C6**
(calibration/operator surface). File a GitHub issue for S6 before/at the point work begins on it,
matching the S1–S3 pattern. Once C2-D (S1–S6) is fully accepted, merge this worktree's branch into
`self-improvement-engine-foundation` (the integration branch backing draft PR #1398), push, and
confirm CI green before continuing to C3. Full `apps/api_server` suite, Flutter format/analyze/
tests/build, and desktop UI reconciliation are deferred to C6 per the contract's `ship_gate`.
