---
index: "[[Rhythm]]"
date: 2026-06-24
repo: Rhythm
tags: [decision, Rhythm]
---

# Teacher-escalation trigger (OQ-5) and isTestEnv-guarded testability

## Context

P4-1 adds a teacher-escalation path: when a weaker-model run fails, re-run on a
stronger model and capture the successful approach as a DRAFT skill. Two open
questions had to be resolved: (1) what signal triggers escalation, and (2) how
to test a re-run path without hitting a real model and without auto-escalating
during CI.

## Decision

**Trigger (OQ-5):** escalate on the observable `run().status === 'error'` only
(Option A). This single signal covers both an SDK/LLM failure AND the no-progress
fast-fail, since both already resolve to `status:'error'` with an error message.
A "low confidence" trigger was rejected — no such signal is currently emitted by
the run pipeline.

**Testability:** the auto-escalation inside `run()` is guarded by
`isTestEnv()` (mirrors `skill_extractor.isTestEnv()`), so it NEVER fires under
VITEST/NODE_ENV=test. The escalation decision and control flow are extracted as
exported, dependency-injected pure units — `shouldEscalate(result, opts, enabled?)`
and `escalateAndCapture(opts, original, { runFn, distillFn, teacherModel })` —
and the tests exercise THOSE directly with `vi.fn()` injections, so no real
model/LLM is ever reached.

**Recursion guard:** the escalated re-run carries `_isEscalation: true`. Because
`shouldEscalate` returns false when `_isEscalation` is set, the escalated run's
own error path cannot escalate again — escalation happens at most once per run.

## Alternatives considered

- **Auto-escalate live in CI (no isTestEnv guard):** rejected — would either hit a
  real model or require mocking the entire opencode engine for every run test, and
  would make the existing AgentRunner tests pay the escalation cost.
- **Intercept every return inside the existing `run()` body:** rejected in favor of
  wrapping — renamed the body to `_runOnce` and added a thin `run` wrapper, so the
  escalation logic lives in one place and the success/error/timeout returns are
  untouched.
- **"Low confidence" trigger:** rejected — not emitted; would be dead code.

## Consequences

- The real end-to-end escalation path (run → _runOnce → escalateAndCapture with the
  real distill) is never exercised in CI; wiring is proven by the pure-helper tests
  with injected deps. Same testability posture as P2-1/P2-2/P3-2.
- **COST:** every failed run triggers a second stronger-model re-run when enabled
  (~2x cost of FAILED runs; successful runs unaffected). Toggle:
  `AGENT_TEACHER_ESCALATION_ENABLED=false`.
- Teacher model is configurable via `AGENT_TEACHER_MODEL` ('provider/modelId',
  default `anthropic/claude-opus-4-8`); `resolveTeacherModel` splits on the FIRST
  '/' so multi-segment model ids keep their slashes.
- Captured drafts carry `source='teacher-escalation'`, distinguishable from
  ordinary `source='auto-extract'` drafts for later human review.
