# Current Plan — Skill-harvest cost reduction + "found-first" discovery

**Relates to:** GitHub issue #1098 (Skill Harvesting Overactive, Inefficient, and Bloating Skill Library)
**Date:** 2026-07-16
**Branch:** `workflow/skill-discovery-cost-2026-07-16`

## User request

Make the skill-harvest process cheaper (each trigger launches an agent session costing ~100k tokens immediately), and shift the system so skills are primarily **found** (discovered from external registries/marketplaces) rather than **written** (distilled from session transcripts). Extend discovery to also cover **MCP servers**, not just skills.

## Problem (measured, from live local DB `rhythm.db`, 2026-07-11 → 07-16)

- **Written loop** (`skill_extractor.ts`) fires after *every* assistant turn with no per-session guard or cooldown: **472 `skill-extract` sessions in 5 days (~94/day)**, **$45 on skill-extract alone (~$60 all self-improvement)**, avg **54.6k tokens/call**, cold-call peak **110k**, most producing 3–4 output tokens. Fills `drafts/` with **161 near-duplicate** skills (four `file-github-issue` variants, etc.).
- The ~110k per call is **session baseline**, not the ~2k-token distill payload: `skill_extractor.ts` routes the distill through `AgentRunner.run()` (a full `build`-agent session) which re-pays the system prompt + all built-in tool schemas + a **verbose listing of all ~104 skills** (`session/system.ts:91`) on every call. Many runs ride a frontier model (opus).
- **Found loop** (external discovery) is real and well-built but structurally throttled to ~zero: gap-driven but only invoked by daily/weekly cron, runs last under a shared proposal cap, human-gated output, and **fully inert on Postgres** (prod). Observed: **~3 discovery runs in 5 days**; crons half-disabled (`Org External Discovery` enabled=0; `v2` never run; `Org Self-Optimizer` daily enabled=0 + errored). **152 of 153 capability gaps sit `open`, unused.**

## Goal

1. **Half A — muzzle the written loop:** cut harvest cost ~90% and stop draft bloat, without deleting the loop (keep as quiet fallback for novel local patterns).
2. **Half B — promote the found loop to primary:** make discovery gap-driven and prod-capable, drain the open-gap backlog, and extend it to MCP-server adoption.

## Non-goals

- Deleting the transcript-harvest path entirely (keep as gated fallback).
- Auto-applying discovered skills/MCPs without human approval (keep the existing proposal gate).
- Redesigning the skill schema or the behavioral-measure pipeline.

## Issues

| # | Title | Half | Risk |
|---|---|---|---|
| 001 | Gate skill-harvest frequency (per-session + cooldown; dedup before LLM; eval off hot path) | A | Low |
| 002 | Shrink & cheapen each harvest call (cheap tier + strip tool/skill baseline for self_improvement) | A | Low–med |
| 003 | Un-break the discovery crons (re-enable + fix errored daily) | B | Low |
| 004 | Make discovery capability-gap-driven, not timer-only (drain the 152-gap backlog) | B | Med |
| 005 | Fix Postgres inertness so discovery/gaps run in production | B | Med |
| 006 | Discover & adopt MCP servers to fill capability gaps (not just skills) | B | Med |

**Sequencing:** 001 → 002 (cost, ship first). Then 003 → 005 → 004 → 006 (005 is the gating blocker for prod-real discovery; 004 and 006 build on it).

## Validation

Per issue below; all gated on `tsc --noEmit` + `npx vitest run` in `apps/api_server`, plus targeted unit tests. Behavioral validation via the existing `org_proposal_measure` replay for discovery adoptions.
