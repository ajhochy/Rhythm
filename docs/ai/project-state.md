# Project State

## Focus

D2.1-D2.5 post-apply monitor -> repair -> revert lifecycle (#1431-#1435),
including the independent-review repairs for evidence gating, target CAS,
crash recovery, projection settlement, truthful alert trails, and real
diagnosis evidence.

## Branch / PR

- Branch: `agent-stack/si-d2-post-apply-lifecycle`
- Base committed head: `c825bf9e`
- Draft PR: #1454 (open, unmerged)
- Current repair changes remain uncommitted pending final commit.

## Current state

- Repair decisions are durable and sweep-driven. No post-repair evidence means
  pending, never success.
- The repair gate reuses D2.2's full guardrail registry and minimum sample
  threshold.
- New diagnosis attempts receive bounded, safe
  `post-apply-regression` signals derived from actual breached guardrails.
  Empty/insufficient evidence does not invoke diagnosis or consume a strike.
- Provider failure, null response, parse failure, and timeout defer without a
  strike.
- Attempts are idempotency-keyed and resume before diagnosis across proposal,
  mutation, claim, projection, and event-update crash points.
- Repair and revert use target value/revision CAS. Concurrent operator drift is
  refused; a valid multi-repair chain uses the last same-field applied value as
  its revert anchor.
- Projection `blocked` / `failed` / `missing` cannot settle repair or revert
  success.
- Revert verification/projection completes before the proposal becomes
  terminal `reverted`, preventing proposal/event status contradiction.
- Revert alerts contain deterministic SHA-256 target/change/value fingerprints
  and safe field identity, never raw config/prompt/secret bytes.
- Protected whole-field scope refusal, no recursive repair enrollment, and
  post-commit approval error isolation remain enforced.

## Verification

- Focused post-apply-regression signal suite: 34/34 pass.
- Lifecycle integration suite after evidence-aware fixture repair: 8/8 pass.
- TypeScript: pass.
- API build: pass.
- Full API suite: 5,530 pass / 182 skipped / 8 failed before the fixture
  correction. Seven failures are the established inherited-environment
  baseline; the sole D2 failure was the stale no-evidence integration fixture
  and now passes 8/8 in isolation.
- Real live repair E2E: 1/1 pass in 160.53s against isolated API 4298, engine
  4297, gateway 4299, synthetic SQLite data, real scheduler, and real
  `openai/gpt-5.6-sol` diagnosis. Actual guardrail evidence created one repair;
  no evidence stayed pending across cron; five clean outcomes settled
  `clear` / `not_needed`, original proposal `active`, no alert.
- Sandbox removed; ports 4297/4298/4299 closed.
- GitNexus worktree index remains stale; impact is UNKNOWN, not low.

## Risks / boundaries

- Eligible lifecycle enrollment remains limited to existing-profile mutations
  with snapshots that `revertProposal` can safely restore. Create-agent,
  external adoption, and missing-skill creation remain excluded until all side
  effects have versioned, race-safe rollback.
- `org_proposal_reconciler.ts` remains read-only.
- The seven unrelated full-suite failures are inherited environment-test
  contamination and are being addressed in the separate C6 worktree; they are
  not D2 regressions.

## Next

Stage the full D2 repair, run staged change detection, commit/push, update draft
PR #1454 with final evidence, then return to C6.

## Recent coding-agent runs

### 2026-08-21 — D1.5 tool-safety review correctness repair (#1430)

- Files modified: review queue controller and mounted Flutter regression; API safety projection and full fixed-reason route matrix; #1430 contract/run evidence.
- Checks run: focused Flutter 11/11; full agent optimizer 35/35; Node 22 D1 API matrix 144 passed / 1 env-gated skip; Node 22 typecheck/build passed; Flutter analyze exit 0 with 318 existing infos.
- Decisions made: one private proposed/sandbox-vetted/pending deduplicated loader is reused by refresh and failed-approval reconciliation; `Record<ToolVettingFailureReason | lifecycle reason, true>` makes vetter coverage compile-time exhaustive.
- Deviations from spec: live behavioral gate remains pending for parent rerun; no sandbox/live process was started.
- Concerns: GitNexus impact/detect is UNKNOWN because the integration is unavailable in this worktree; the inherited D1.4/D1.5 live fixture is still pending/sandbox_candidate_failed.

### 2026-08-21 — D1 managed installer artifact-boundary repair (#1429)

- Files modified: immutable tar validator, managed apply boundary, adversarial managed-apply tests, live D1.4 activation contract, contract/run evidence.
- Checks run: RED reproduced child-path symlink, outside receipt, source-swap, and tar ambiguity flaws; focused GREEN 15/15; D1.1–D1.4 Docker matrix 279/279; isolated live HTTP/Docker activation 1/1; Node 22 typecheck/build; diff and changed-line secret scans clean. Workflow issue/pr gates are blocked only by the missing apps/mcp_server TypeScript dependency after Flutter/API checks pass.
- Decisions made: validate each direct managed child and verification file with `lstat` + canonical containment; validate the copied staging archive with the same full-byte validator used at source inspection.
- Deviations from spec: none.
- Concerns: GitNexus impact/detect is UNKNOWN for this unindexed worktree; remaining filesystem checks are path-based Node APIs rather than descriptor-relative openat operations.

### 2026-08-21 — D1.4 managed immutable tool installer (#1429)

- Files modified: managed apply/artifact contract, validator/safety/vetter, sandbox root wiring, focused tests, D1 contract/run evidence.
- Checks run: RED one unavailable apply; GREEN 7 managed tests; Docker GREEN 8/8; D1 focused matrix 103 passed / 2 env-gated skips; Node 22 typecheck/build and diff check passed.
- Decisions made: only `local-tarball:sha256:<digest>` is installed; mutable npm/pip sources fail closed; installs use offline fixed Node/npm argv with scripts disabled and a receipt-verified staged activation.
- Deviations from spec: isolated HTTP sandbox live route has not been rerun against the new local-artifact lane.
- Concerns: GitNexus impact/detect is UNKNOWN because no index tool is available; broader registry/dependency installation is intentionally unsupported.

### 2026-08-21 — D1.4 tool-install lifecycle repair (#1429)

- Files modified: dedicated tool-install creation/vetting/decision/apply
  boundaries; authenticated proposal route/controller; lifecycle/live tests;
  D1.4 contract and run record.
- Checks run: RED confirmed; focused D1.1-D1.4 plus adjacent suite 344 passed
  / 1 env-gated live skip; real-Docker vetter 59/59; isolated live HTTP 1/1;
  Node 22 typecheck/build; SQLite replay/parity; diff check.
- Decisions made: no managed arbitrary npm/pip installer exists, so production
  returns fixed `tool_install_apply_unavailable` and never claims installation;
  injected tests prove the ordering/CAS boundary.
- Deviations from spec: actual production tool installation is blocked pending
  a separately approved managed installer; recorded honestly in
  `docs/ai/contracts/issue-1429.json`.
- Concerns: GitNexus is UNKNOWN for this unindexed worktree; no reindex was
  run because it can rewrite repository instruction files.

### 2026-08-21 — D1 observer capability proof

- Files modified: `tool_sandbox_vetter.ts` (same-mount capability probe, aged
  atime baselines, fail-closed proof); vetter tests (RED/GREEN observer cases);
  #1427 contract and D1 run note.
- Checks run: GPT-5.6 Terra's restricted sandbox passed the non-Docker matrix;
  the parent then reran the explicit seven-file D1 matrix with real Docker:
  7/7 files and 218/218 tests passed. Node 22 typecheck/build, diff check, and
  added-line secret scan passed; exact owned-container count returned to zero.
- Decisions made: a code-owned probe is never a credential sentinel; named
  sentinel silence is trusted only after post-run host proof of probe advance.
- Parent challenge evidence: a no-read candidate remained safe; broken
  install/invocations returned unknown; quiet shell and programmatic sentinel
  reads returned unsafe with access count 1; injected access evidence returned
  unsafe. No server was started.
- Concerns: GitNexus has no index for this worktree (impact/detect are
  UNKNOWN). The observer intentionally covers only the three named synthetic
  sentinels; it is not a generic syscall auditor.

### 2026-08-21 — D1.4 tool vetting approval gate (#1429)

- Files modified: central policy, proposal apply/controller boundaries, D1.1 report binding, additive schema parity, focused policy/route/live tests, D1.4 contract/run note.
- Checks run: D1.1–D1.4 plus adjacent matrix 298 passed / 1 env-gated skip, then final affected subset 149/149; Node 22 typecheck/build; real-Docker safe + blocked vetter evidence; isolated live API 1/1; diff/secret scans.
- Decisions made: reports bind a SHA-256 fingerprint of proposal id and closed candidate inputs; old/unbound, malformed, stale/mismatched rows never authorize. Conditional reports require an exact authenticated boundary token; reusable/optimizer paths cannot bypass the policy.
- Deviations from spec: none.
- Concerns: GitNexus detection remains UNKNOWN because this exact worktree is unindexed; an in-process per-proposal vet dedupe avoids local duplicate runs while cross-process races remain fail-closed under proposal CAS.

### 2026-08-21 — D4.6 regression-feedback reconciliation repair (#1444)

- Pending parent review: terminal D2 reverts are re-swept only while derived trust or notification feedback is incomplete; the target revert is never replayed.
