---
index: "[[Rhythm]]"
date: 2026-06-24
repo: Rhythm
branch: feature/agent-scheduler
pr: "734"
issues: P4-1
status: verified (headless) — changes uncommitted; manual smoke pending
tags: [run, Rhythm]
---

# Run: P4-1 — teacher-escalation → draft skill capture

When a weaker-model run fails, escalate to a stronger "teacher" model, re-run the
same prompt, and on success capture the teacher's approach as a DRAFT skill
(`source='teacher-escalation'`). Quality multiplier on top of the P2/P3
self-improvement loop.

## Files changed

- `apps/api_server/src/config/env.ts` — `agentTeacherModel` (env `AGENT_TEACHER_MODEL`,
  default `'anthropic/claude-opus-4-8'`, format 'provider/modelId') +
  `agentTeacherEscalationEnabled` (env `AGENT_TEACHER_ESCALATION_ENABLED`, default ON;
  only `'false'`/`'0'` disable; instance-wide). Inline COST note.
- `apps/api_server/src/services/skill_extractor.ts` — `DistillOptions.source?`
  (default `'auto-extract'`) threaded into `repo.create({ ... source })`.
- `apps/api_server/src/services/agent_runner.ts` — top-level `import { env }`;
  `AgentRunOptions` gains internal `_isEscalation?` (recursion guard) +
  `modelOverride?` (bypasses resolveRunModel). Old `run` body → `_runOnce`; new
  `run` wrapper runs once, then if `!isTestEnv() && shouldEscalate(result, opts)`
  lazy-imports `distillFromSession` and calls `escalateAndCapture`. New exported
  pure helpers: `shouldEscalate`, `escalateAndCapture` (injectable
  `runFn`/`distillFn`/`teacherModel`), `resolveTeacherModel`, `isTestEnv`.
  Removed redundant lazy `await import('../config/env')` in `_deliverToTaskNotes`.
- `apps/api_server/src/__tests__/teacher_escalation.test.ts` (NEW) — 13 tests over
  the pure helpers; no real model/LLM hit (runFn/distillFn injected).

## Checks run

- `npx tsc --noEmit` — PASS (exit 0)
- `npx vitest run teacher_escalation` — 13/13 PASS
- `npx vitest run` (full) — **1070/1070 PASS** (baseline 1057 + 13 new), 0 failures,
  single clean run (no flake)

## Notes

- **OQ-5 trigger** = observable `run().status === 'error'` (Option A — covers SDK/LLM
  failure AND the no-progress fast-fail, both already status:'error'). No un-emitted
  "low confidence" trigger.
- **Recursion guard**: escalated re-run carries `_isEscalation:true` → `shouldEscalate`
  returns false → escalate at most once.
- Auto-escalation is `isTestEnv()`-guarded (never fires under VITEST); tests drive the
  extracted pure helpers with injected deps. See
  `docs/ai/decisions/2026-06-24-teacher-escalation-trigger-and-testability.md`.
- distill capture is fire-and-forget + try/catch (sync + async) → never rejects into
  run()'s caller. Postgres path unaffected (distill no-ops under Postgres).
- **COST** (flagged): when enabled, every failed run triggers a second stronger-model
  re-run (~2x cost of FAILED runs only; successful runs unaffected).
- Public `run()` return shape unchanged (additive opts only); the two callers
  (`agentCookbookController`, `agentSchedulerService`) are unaffected.
- Deviations from spec: none material.
