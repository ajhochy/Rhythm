# P4-1: Teacher-escalation → draft skill capture

## Goal

On an observable failure signal (run status='error' OR no-progress fast-fail per OQ-5), escalate to a stronger model tier, re-run, and on success capture the stronger model's approach as a DRAFT skill with `source='teacher-escalation'`. Gate confidence before later injection (P3-2). This is the quality multiplier that improves future runs by learning from failures.

## Context

Phase 4 layers teacher-escalation on top of the self-improvement loop: when a weaker model fails or gets stuck, escalate to a stronger tier, and if the stronger model succeeds, capture its approach as a reusable skill for future use (and for the weaker model to consume later). This closes a high-value learning path.

**OQ-5 (unresolved):** "weaker-model failure / low-confidence" needs a concrete, testable trigger. Default to observable signals: `run status='error'` OR a no-progress timeout (e.g., max 10 turns with no forward progress). Issue author must define the trigger as an observable signal (e.g., `AgentRunner` run returns `{ status: 'error' }`). A "low-confidence" trigger with no emitted score is NOT testable and must be dropped or redefined.

## Likely files

- `apps/api_server/src/services/agent_runner.ts` (failure detection + escalation re-run, in the post-run path)
- `apps/api_server/src/services/skill_extractor.ts` (capture variant for teacher-escalation source)
- `apps/api_server/src/repositories/agent_skills_repository.ts` (insert with `source='teacher-escalation'`)

## Acceptance Criteria

- [ ] **Failure trigger definition:** Issue author inspects `AgentRunner` and specifies the exact testable signal for "failure":
  - Option A: `run.status === 'error'` (errors from the opencode SDK or LLM failure)
  - Option B: No-progress timeout (max N turns with no state change, then fail)
  - Option C: Combination (error OR timeout)
  - Reviewer confirms choice; confirm OQ-5 is resolved

- [ ] **Escalation logic:**
  - After a run completes with the failure signal, escalate model tier (e.g., weaker=Haiku → stronger=Sonnet, or weaker=Sonnet → stronger=Opus)
  - Re-run the agent with the stronger model and the same input/context
  - If the re-run succeeds (status='success' or reaches goal), capture the approach as a DRAFT skill
  - If the re-run also fails, log and skip (no skill capture)

- [ ] **Skill capture (teacher-escalation variant):**
  - After successful escalated run, call extractor with `source='teacher-escalation'` (instead of 'auto-extract')
  - Capture the skill from the stronger model's session messages (last ~12 msgs)
  - Apply same confidence gating (≥0.6) and dedup logic as P2-1 auto-extract
  - Store with `status='draft'`, `source='teacher-escalation'`, `confidence` from the extraction

- [ ] **vitest:** Cover:
  - Failure signal detected → escalation attempted → on success, DRAFT skill created with `source='teacher-escalation'`
  - Failure signal + escalation succeeds → skill inserted
  - Failure signal + escalation also fails → no skill, logged
  - Non-failure run → no escalation triggered
  - Draft skill with low confidence (< 0.6) → still insertable, but gated from P3-2 injection (confidence-gated at consumption time, not capture)

- [ ] **Model tier escalation:** Specify the model tiers and escalation path (e.g., Haiku → Sonnet → Opus; or Claude 3.5 Sonnet → Claude 3.5 Opus). Document in code/comments.

- [ ] **Logging:** Log escalation attempts at info level: `"Escalating from model X to model Y due to failure"`. Log capture on success: `"Teacher escalation skill captured: [title]"`.

- [ ] **Cost consideration:** Reviewer confirms that re-running on escalation is acceptable cost-wise (flag if too expensive for automatic triggering).

- [ ] **tsc + vitest:** `tsc --noEmit && npx vitest run` passes; no regression.

## Dependencies

- **P2-1:** `SkillExtractor` service must exist (reuse/extend for teacher-escalation capture).
- **P3-1:** `getRelevantSkills` scorer must exist (so teacher-escalation skills can be retrieved/injected later).

## Out of Scope

- Interactive user approval for escalation (automatic on failure).
- Persisting the escalation history separately (just log the skill).
- Cost optimization/budgeting (escalation runs immediately).
