# Rhythm — project state

**Focus:** Deliverables repair (Coordinator coding workflow, workflow skills, Router/Memory/Dayflow, routing UI).
**Branch:** `codex/rhythm-deliverables-completion-20261010` (pushed) · no PR open.
**Installed:** `/Applications/Rhythm.app` = 0.18.74 (source 03a07ad0, CI qualification-only build, signed/notarized),
installed as the regular app at AJ's request on 2026-10-12. Previous 0.18.67 is in the Trash.

## Demonstrated (isolated qualification candidates 0.18.71 / 0.18.73)
- Contract c1–c11, c13–c15 PASS on 0.18.71 (fresh fixture); c12 (completed-before-delivery recovery,
  duplicates → one worker/result/wake) PASS on 0.18.73 after a real coding run + in-app runtime restart.
- Full chain from an ordinary chat request: goal → card → approve (agent-clicked per AJ) → 1 manager →
  1 worker → edit → protected evaluator 7/7 → held → restart → delivered once to the original chat.
- Engine/API data, config, plugin list and logs isolated (lsof-verified); user's opencode.json untouched.
- Catalog refresh after OpenAI sign-in without relaunch; Grid routing UI edits persist across restart.

## Direction change (AJ, 2026-10-12)
AJ considers the bounded coding layer (signed proposals, grants, fixed fixture workspace, Docker evaluator)
over-built. Intended product: one coordinator agent that starts and tracks multiple runs of the EXISTING coding
workflow (workflow-orchestrator → coding-agent → verification-gate), with verification as a workflow step.
Next: make the coordinator delegate straight to the existing workflow per goal, track runs via existing
async-delegation/workstream records, and retire or bypass `coordinator_coding_execution_v1`. Awaiting AJ's go.

## Risks / open
- Bounded path handles only the selectTasks fixture (see decisions/2026-10-11-workflow-rule-enforcement-map.md).
- Human-click approval on a full delivered run not demonstrated (agent clicked, per AJ).
- 3,795 historical NULL-owner sessions not backfilled; 8 pre-existing FK orphans in agent_session_messages.
- Test goals and decided approval cards remain in the live Coordinator journal (journal-integrity; not removed).

## Test status
api_server full suite: 28 failures in 12 files, all identical on pre-change source a426383e.
