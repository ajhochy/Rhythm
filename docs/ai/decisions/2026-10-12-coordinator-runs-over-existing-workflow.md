---
date: 2026-10-12
repo: rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---
# Coordinator runs the existing coding workflow; bounded layer retired

## Context
AJ judged the bounded coordinator coding layer (signed proposals, grants, fixed selectTasks fixture, Docker
evaluator) over-built. Wanted: one coordinator that starts and tracks several runs of the existing
workflow-orchestrator chain, with verification as that workflow's own step.

## Decision
- One coding path: captured goal → `rhythm_start_coordinator_goal` → async delegation to workflow-orchestrator,
  one run per goal, in an engine-created git worktree/branch of the repo named in the user's goal text.
- Runs use `bypassPermissions` (AJ, 2026-10-12) but are engine-confined to their worktree
  (`external_directory: deny`) together with every specialist they delegate to; #878 blocklist still applies.
- The external-content taint approval on goal start stays (security; only fires for tainted chats).
- Run status/usage is a server read model over existing delegation/session/message rows; no new tables.
- Bounded layer, its tools/card/fixture/evaluator, `chat_bounded_workflow` and the finite `workflow` purpose were
  removed; their DB columns are left in place.

## Alternatives considered
acceptEdits (every shell command would raise a card); plain `rhythm_delegate_async` without goal records
(no goal↔run link); model-supplied repo path (redirectable by injected content).

## Consequences
Runs can edit and commit inside their own worktree without prompts and never outside it. "Needs you" now means
a pending question/permission in the run's session tree. Concurrent starts are safe; a model-started run does not
make the user's next message stale.
