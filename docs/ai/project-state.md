# Project State

## Current focus

**#929 verified live (partial) and landing; #949 merged.** The
self-regulating harvested-skill loop (real usage tracking, evaluate-at-3-uses,
keep/rewrite-needed/disable, harvester-quality signal, minimal UI) is
implemented on top of #949's file-based harvest representation. Unit suite
green; mechanism proven live via an independent probe; the official live
gate is blocked upstream on a dead-provider harvest precondition (#952) —
see `docs/ai/runs/2026-07-09-929-skill-self-regulation-live.md`.

## Active branch / PR

- **`issue-929-skill-self-regulation`** — PR open (draft) against `main`.
  6 implementation/unit commits + 1 live-gate fix commit
  (`79620f35e` — frontmatter-from-disk read + evaluator-timing fix) + 1 docs
  commit. Not merged; draft pending manual review.
- `issue-949-harvest-to-file` / PR #950 — **merged to main.**
- `issue-930-model-fallback-chain` — draft PR #940, still awaiting gated
  live smoke before merge. Its `DEFAULT_MODEL_BY_PROVIDER` will supersede
  the `openrouter/free` pin added in #949's fix.
- `issue-933`, `issue-934`, `issue-935`, `issue-936` — gate pending.

## Risks / known issues

- **#952 — dead providers.** openai/google model providers are dead on
  this machine; `openrouter/free` is the only working provider, and it is
  both weak (declines to distill on request) and flaky (rate limits surface
  only as WS error frames, reading as a hang). This is what blocked #929's
  official live gate from completing its harvest precondition, and is the
  systemic risk behind any "live E2E blocked" note across #929/#930/#949.
- **openrouter/free flake in the live harness** — turn 2 can hit a rate
  limit invisible to the E2E harness. #930's fallback chain is the systemic
  fix; until that merges, live runs across issues can flake on this.
- **#951 — distill harvests injected memory prefaces, not conversation
  content.** Filed during #949 live verification. #929's self-regulation
  loop (Units 3/4) is the safety net that catches this class of bad
  harvest, not a fix for it.
- **#876 — same frontmatter-strip bug class as the #929 live-gate fix**,
  but in `lazy_deps_turn_hook.ts` rather than `opencode_skills_routes.ts`.
  Diagnosed during #929 verification, spun out as its own follow-up.
- `AgentSkillsRepository` + `agent_skills` table still not deleted (32
  direct callers) — only the `distillFromSession` write site changed in
  #949. Cleanup remains a follow-up.
- Pre-existing unrelated test failures (22, memory-vault + auth-middleware,
  ENOENT temp-dir + 401 auth env issues) predate this branch.

## Test status

- `tsc --noEmit` — clean.
- Full `api_server` unit suite — 292 files / 2482 tests passing (includes
  #929's new evaluator, usage-tracker, and frontmatter test files).
- Live #948/#949 phases — previously verified manually against the running
  backend (see prior run logs).
- Live #929 phase — official gate (`live_e2e_929.test.ts`) blocked on the
  #952 harvest precondition; mechanism independently proven live via probe
  (draft surfaced with correct status, usage counter advanced 0→1→2→3 from
  real telemetry, evaluator produced a real `rewrite-needed` / postScore=25
  outcome ~17s after the third use).

## Next step

1. Manual review + merge of draft PR for `issue-929-skill-self-regulation`.
2. Gated live smoke for `issue-930-model-fallback-chain` (PR #940), then
   merge; drop the `openrouter/free` pin in favor of its default map.
3. Resolve #952 (dead openai/google providers) to unblock full live
   verification of harvest-dependent gates (#929, #949, future harvester
   work).
