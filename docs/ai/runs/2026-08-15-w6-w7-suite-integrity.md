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

### W7 has never been executed — not one case, ever

Running the live suite needs a sandbox: a persistent api_server plus an opencode engine
making real model calls. The campaign's safety constraints forbid both, so no worker
started one and none claimed unobserved red/green.

Source review alone then found a deterministic failure in every W7 case it examined.
`POST /agent-sessions` returns 201, not 200; the suite expected 200 — including in the
six cases that shipped before this session, which is proof rather than inference that
nothing there has ever run. W7-8 additionally resumes a just-created session, which the
resume guard rejects with a 400, and `resume` never prompts anyway, so its harvest
assertion was vacuous even past that point. The new W7-7's turn-boundary witness fired
at the START of a response, making its duplicate-outcome assertions pass trivially.

All fixed at source level. The suite is `describeLive`-gated and inert in a normal run,
so none of the 5199 passing tests touch it. **The plan's final acceptance gate —
integrated live behavior — is therefore NOT met, and cannot be met without a decision
to permit a sandbox run.**

### Latent, flagged rather than fixed

- `org_audit_service.ts:513` reads `sessionsRepo.listAll(1000, …)`. If the sandbox DB
  holds more than 1000 sessions and that list is newest-first, the backdated seed
  sessions fall outside the window and the observation floor is never met. That would
  surface as `proposalsCreated > 0` failing in W7-2 and the positive controls failing
  in W7-5/6/9 — a fixture bug reading as a product bug.
- `env.liveArtifactStorageDir` resolves to `process.cwd()/live-artifacts`, and
  `live_artifacts.test.ts` `rm -rf`s it in `afterEach` while `live_artifact_capabilities.test.ts`
  uses the same shared path. A cross-file filesystem race waiting to happen.
- W5's `agent_org_proposal_retirements` sidecar is still created lazily outside
  `migrations.ts`, SQLite-only, invisible to the parity guard.
- Postgres DDL is never executed anywhere in CI. The parity guard compares column names
  only; behavioural parity is asserted by string matching over `postgres_bootstrap.ts`.
  A PG syntax error would surface at boot, not in CI.
