# Project State

## Current focus

**Two independent reliability fixes (2026-07-12)**, dispatched as 4 concurrent
Codex agents (1 terra, 3 sol) across isolated worktrees, reviewed/verified/
committed by the orchestrating session, then merged into 2 issue-grouped
integration branches:

1. **Provider fallback chain (#930)** — was stuck bouncing between team/
   personal Anthropic, never reaching Codex/Gemini/OpenRouter-free. Two root
   causes: the vendored plugin never reported total exhaustion on a dual
   429/529, and even when it did, the handoff was one-shot (no real cascade,
   no generic non-Anthropic exhaustion signal, Gemini's tool cap not
   reapplied on redispatch). See `docs/ai/decisions/2026-07-12-bounded-provider-fallback-cascade.md`
   and `docs/ai/runs/2026-07-12-fallback-multi-tier-cascade.md`.
2. **Scheduled-task inconsistent success/failure** — three independent causes
   found: (a) plugin dual-exhaustion never firing (same root cause as #1
   above), (b) a global concurrency cap of 3 shared by every agent run,
   treated identically to real errors (5-min blind backoff, wasteful teacher
   escalation) instead of a retryable capacity signal, (c) an "Agent not
   found" registry-sync gap that was already fixed on main
   (`7c949ef5b`, #1039) — only the regression test needed hardening. See
   `docs/ai/runs/2026-07-12-scheduled-agent-registry-diagnosis.md`.

## Active branches / PRs

- `fix/930-fallback-cascade` — folds `fix/fallback-plugin-dual-exhaustion` +
  `fix/fallback-multi-tier-cascade`. Draft PR to be opened; do NOT merge
  without owner sign-off.
- `fix/scheduled-task-reliability` — folds `fix/scheduled-task-concurrency` +
  `fix/scheduled-task-registry-sync`. Draft PR to be opened; do NOT merge
  without owner sign-off.

## Risks / known issues

1. The fallback cascade's live route-level test (`live_e2e_930.test.ts`)
   requires a freshly-built local server on port 4001 — the default port is
   normally occupied by the already-running desktop app's bundled (older)
   server, which will make those 3 gated tests silently exercise the WRONG
   code if run carelessly. They're skipped by default (`RHYTHM_LIVE_E2E`
   unset); only run them against a server built from this branch.
2. GLM-5.2 remains an intentionally inert fallback tier (no credential
   loader exists). OpenRouter-free is real but only reachable when
   `openrouter` is authed.
3. The scheduled-task concurrency cap (default 3, `MAX_CONCURRENT_AGENT_RUNS`)
   was investigated but NOT raised — no measured resource ceiling justified a
   higher number. The fix instead reclassifies capacity rejections as
   retryable (`queued`, ~60s retry) instead of `error`.
4. Local DB schedule-collision data issue noted but not modified: two
   scheduled tasks currently fire at the same instant (09:00 daily, as of
   this session) — operator cleanup, not a code fix.

## Test status

- `fix/930-fallback-cascade`: `tsc --noEmit` clean; full api_server suite
  311 files / 2713 tests passed, 10 files / 27 tests skipped (gated live
  E2E + pre-existing).
- `fix/scheduled-task-reliability`: `tsc --noEmit` clean; full api_server
  suite 310 files / 2705 tests passed, 11 files / 27 tests skipped.

## Next step

Open both draft PRs, hand to owner for manual smoke, merge on owner
sign-off (do not merge automatically).
