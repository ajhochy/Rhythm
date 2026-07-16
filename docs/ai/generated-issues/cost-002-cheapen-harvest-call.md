# Cost-002: Shrink & cheapen each harvest call (cheap tier + strip tool/skill baseline for self_improvement)

## Goal

Cut the per-call cost of the self-improvement LLM calls (distill / score / judge / rewrite). Two levers: (1) route them to a cheap model tier instead of riding the extracting session's frontier model, and (2) stop re-paying the full `build`-agent session baseline — deny-all skills and skip the additive prefaces for `category: 'self_improvement'` runs. Target: from ~54.6k avg / 110k cold tokens and $0.41–$0.69/call down to a small fraction.

## Context

Measured: each `skill-extract` call carries ~110k tokens of context but the actual distill payload is only ~2k tokens. The rest is session baseline re-paid on every call, because the distill routes through `AgentRunner.run()` (a full `build` agent). The single largest *injected* block is a verbose listing of all ~104 skills, injected because the self-improvement run passes no skill allowlist. The distill/score/judge/rewrite tasks use **zero tools and zero skills**, so all of that is waste. Many runs also ride a frontier model (opus) because model resolution prefers the extracting session's model.

Note: the header comment at `skill_extractor.ts:292-309` documents that these runs were deliberately migrated to `run()` in #1032 for *observability* (they show up as `self_improvement` sessions). This issue preserves that observability — it shrinks the baseline rather than reverting to a bare completion. (A full `run()`→one-shot revert is a heavier alternative deliberately **not** chosen here.)

## Likely files

- `apps/api_server/src/services/agent_runner.ts` — skill allowlist path (`:777-791`), `buildSkillsPreface` (`:664-679`), `buildMemoryPreface` (`:697-711`), `taskKind` seam (`:209`), `resolveRunModel` cascade (`:339-344`)
- `apps/api_server/src/services/skill_extractor.ts` — `defaultLlmCall` (`:310-325`), model override selection (`:518-522`)
- `apps/api_server/src/services/skill_refiner.ts` — judge (`:154`), scorer + per-fallback-model loop (`:269`, `:271`), rewriter (`:376`)

## Acceptance Criteria

- [ ] **Deny-all skills for self_improvement:** self-improvement `run()` calls pass `allowedSkillsJson: '[]'` (mirroring the existing `allowedMcpsJson: '{}'`) so `filterSkillsByAllowlist` drops the ~104-skill verbose listing (`session/system.ts:91`). Verify the injected system prompt no longer contains the skills block.
- [ ] **Skip prefaces for self_improvement:** `buildSkillsPreface` (`agent_runner.ts:664`) and `buildMemoryPreface` (`:697`) are skipped when `category === 'self_improvement'`.
- [ ] **Cheap tier:** distill/score/judge/rewrite calls set a cheap-tier `modelOverride` (or `taskKind: 'triage'`/`'summarization'` via `:209`) instead of inheriting the extracting session's frontier model. Document the chosen model. Behavior must not depend on tool availability (none needed).
- [ ] **Scorer fan-out bounded:** the scorer's loop over every reliable fallback model (`skill_refiner.ts:269`) is capped (single cheap model by default, or a documented small N). No self-improvement operation launches more than a bounded number of sessions.
- [ ] **Measured drop:** on a local run, a `skill-extract` call's `tokens_json.total` drops substantially from the ~54.6k baseline (record before/after in the PR). Output correctness (a valid distilled skill JSON on a qualifying session) is unchanged.
- [ ] **Observability preserved:** these calls still appear as `category: 'self_improvement'` sessions in the session list.
- [ ] **vitest:** cover (a) self_improvement run receives empty skill allowlist + no prefaces; (b) model override resolves to the cheap tier; (c) scorer fan-out is bounded; (d) a qualifying session still distills a valid skill.
- [ ] `tsc --noEmit && npx vitest run` passes in `apps/api_server`.

## Dependencies

- Independent of Cost-001 but best landed together (both target harvest cost). Cost-001 reduces *how often*; this reduces *how much per call*.

## Out of Scope

- Frequency/gating (Cost-001).
- Reverting `run()` to a bare completion (heavier alternative, not chosen — would lose #1032 observability).

## Data safety

- No customer/private data. Do not log transcript or skill-body content at info level.
