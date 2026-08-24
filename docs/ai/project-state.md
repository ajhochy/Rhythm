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
