# Cost-001: Gate skill-harvest frequency (per-session + cooldown; dedup before LLM; eval off hot path)

## Goal

Stop the transcript-harvest loop from firing after every assistant turn. Add a per-session "already harvested" guard plus a cooldown, move the cheap dedup rungs (title / draft-on-disk / round-count) to run **before** the expensive LLM call, and move `evaluateHarvestedDrafts` off the per-turn hot path onto a periodic/idle sweep. Target: cut harvest run count ~80–90% with no loss of genuinely-novel skill capture.

## Context

Relates to #1098 ("overactive, bloating"). Measured on live `rhythm.db` (2026-07-11 → 07-16): **472 `skill-extract` sessions in 5 days (~94/day, bursts of 16/hr)**, and a `drafts/` folder with **161 near-duplicate** skills. The trigger fires per turn from two fire-and-forget call sites, with only a 90s cold-start throttle and a ≥2-round floor as gates — no per-session guard, no cooldown. The existing dedup rungs run *after* the LLM call, so they prevent duplicate draft *files* but not duplicate *sessions* (the cost is already paid).

`evaluateHarvestedDrafts` also fires every turn and fans out further (scoring loops over every fallback model), so one user turn can spawn many full sessions.

## Likely files

- `apps/api_server/src/services/skill_extractor.ts` — trigger `queueSkillExtraction` (~`:762`), cold-start throttle (`:70` `CURATOR_COLD_WINDOW_MS`, `:765`), round floor (`:784`, re-check `:494`), dedup rungs currently after `llmCall` (`:530`): refine-in-place (`:585`), auto-wire existing (`:618`), dup-by-title (`:596`), draft-on-disk (`:654`)
- `apps/api_server/src/services/opencode_stream_bridge.ts` — per-turn call sites `:1009` (`queueSkillExtraction`), `:1018` (`evaluateHarvestedDrafts`)
- `apps/api_server/src/services/agent_runner.ts` — headless call sites `:1079`, `:1085`
- `apps/api_server/src/services/harvested_skill_evaluator.ts` — `evaluateHarvestedDrafts` (`:445`), `EVAL_THRESHOLD` (`:132`)
- NEW small state for per-session harvest marker (in-memory Map keyed by sessionId, or a column on `agent_sessions`)

## Acceptance Criteria

- [ ] **Per-session guard:** a given `sessionId` triggers at most one `queueSkillExtraction` LLM call per session lifetime (subsequent turns are no-ops). Guard is checked *before* any model call.
- [ ] **Cooldown:** a global/per-session cooldown (config constant, default ≥ e.g. 5 min) prevents rapid re-fire; document the chosen value.
- [ ] **Dedup before LLM:** the cheap rungs that can run without the LLM output (draft-already-on-disk by intended title/slug, round-count floor, and any title-based dedup that does not require the distilled title) are evaluated **before** `llmCall` (`skill_extractor.ts:530`); if a match/short-circuit is found, no session is launched. Rungs that genuinely need the distilled output stay after.
- [ ] **Eval off hot path:** `evaluateHarvestedDrafts` is removed from the per-turn call sites (`opencode_stream_bridge.ts:1018`, `agent_runner.ts:1085`) and invoked from a periodic/idle sweep instead (reuse the existing scheduled-task mechanism or an idle timer). One user turn can no longer fan out into multiple evaluator/scorer sessions.
- [ ] **No regression in capture:** a novel, qualifying session (≥2 rounds, no existing match) still produces exactly one draft on its first eligible turn.
- [ ] **Test-env guard preserved:** zero LLM/DB side effects under `VITEST`/`NODE_ENV==='test'`.
- [ ] **vitest:** cover (a) second turn of same session → no LLM call; (b) draft already on disk → no session launched; (c) cooldown active → no fire; (d) novel session → one draft; (e) evaluator no longer invoked from per-turn path.
- [ ] `tsc --noEmit && npx vitest run` passes in `apps/api_server`.

## Dependencies

None. Ship first (fastest, safest cost win).

## Out of Scope

- Per-call token/model cost (that is Cost-002).
- Deleting the harvest loop (keep it as a gated fallback).
- Cleaning up the existing 161 duplicate drafts (separate housekeeping follow-up).

## Data safety

- No customer/private data. Per-session marker stores only a sessionId + timestamp. Do not log transcript content.
