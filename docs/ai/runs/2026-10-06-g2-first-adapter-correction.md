---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-coordinator-approval-resume-20261006
pr: none (source-only, uncommitted)
issues: []
status: first-correction-source-complete-pending-review
tags: [run, rhythm]
---

# G2 first adapter — first corrective checkpoint

Same persisted Sonnet-5.5 session. Source only; the dormant adapter is still unwired. The durable consumer, admission issuance and next-job progression are NOT started.

## Red first

The two Sol-patched test files (whole-file hashes 4921256a…, fe8d05f9…) ran 44 tests: the three Sol negatives failed (root tool-calls-only anchor, descendant tool-calls-only step, other-specialist typed dispatch) and their paired useful positives passed.

## Production (two files only)

- `persistent_workstream_coordinator.ts`: a completed tool-calls STEP is no longer a closed TURN. Supported policy: a turn group (assistant steps sharing one user parent) is closed only with exactly one `stop` step and no engine error. Applied to the manager, to every actual descendant turn group, and to each exactly charged root/review anchor. No stop, several stops, an error, or an unparented step holds with usage null (existing reasons `turn_not_terminal` / `uncovered_assistant_turn`; the contract file is protected so no new reason code). Unrelated root activity is not required idle. Both synchronous local-binding checks now also require `manager.projectId === receipt.owner.projectId`.
- `agent_delegation_service.ts`: a typed Coding Workflow call is refused unless the target is the canonical `workflow-orchestrator`, before worktree, child/native session or SDK effects (narrows eligibility; allowedDelegates untouched). Project + current admission preflight now precede the optional worktree; after the awaited worktree the CURRENT project is re-read and the admission is validated again before any child session. Untyped delegation of other allowed specialists keeps its exact behavior and 8-argument call.

## Tests

Sol blocks and the useful positives were not edited; new cases were appended in the same two files (manager project null/foreign/at-start/during awaits, inherited-project positive, ambiguous/unclosed/errored/unparented groups, per-group closure, charged-root closure, unrelated root activity, worktree/preflight ordering and currency, untyped specialist arity).

## Checks

Affected files + contract/read fixture: 74 pass. Narrow delegate regressions (permission scope, worktree, 1123 contract, 1175 security): 27 pass. API build and `git diff --check`: exit 0. No 339/70 repeat.

## Project-race correction (one production file)

Red first: the three Sol project-race cases failed (worktree still created when the project became NULL during the first admission await; accepted receipt for a stale project after the post-worktree admission await; accepted receipt when the project became NULL during the client's sdk_exposure validation); the other 20 tests in the file, including the native-anchor positive, passed.
Fix, `agent_delegation_service.ts` only: a `currentRootProject()` helper re-reads the canonical root row each call. It is compared with `expectedProjectId` synchronously (1) right after the awaited preflight admission, before the worktree; (2) right after the awaited post-worktree admission, before the child session; (3) in the typed synchronous `isCurrent` immediately before SDK exposure, alongside the existing owner/permission/external checks. Both admission checks, worktree support and all earlier checks are retained. No test body was edited (test file hash unchanged). Green: dispatch file 23/23, coverage file 41/41, API build and diff check exit 0.

## Limits

Source-only with stand-ins; no consumer persists the receipt/authorization linkage yet; deleted native children remain unprovable; usage coverage is not an outcome/success claim.
