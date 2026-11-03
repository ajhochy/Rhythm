---
date: 2026-10-08
repo: Rhythm
status: proposed
tags: [decision, rhythm, coordinator]
---

# Proposed Coordinator execution simplification

## Context

The October 8 architecture review found overlapping conversation control, finite workflow, bridge-job, async-delegation and recovery paths. Recent logs prove useful individual repairs but do not establish the complete general coding task and same-chat result flow. AJ requested an implementation plan and chose a small coding task as the first proof, desktop first and phone afterward.

## Decision

Propose ordinary persistent chat with typed work tools, existing workstreams for durable objectives, existing async-delegation records for new managed attempts, existing approval infrastructure for task-scoped authority, and one shared terminal-result/completion-delivery path. Verification is bound to the actual task and artifact. Optional context can be unavailable without vetoing unrelated work; prior exposure and revocation protections remain.

Require the real desktop coding proof before broad migration. Preserve legacy admitted jobs and their recovery until they drain. New admissions have explicit routing ownership and do not create a second bridge-job copy. Do not add a broker, scheduler, workflow language, generic verifier framework, or permanent third execution path.

The complete specification, staged work packages and evidence gates are in [the implementation and POC plan](../plans/2026-10-08-coordinator-simplification-and-poc.md). This is a proposed architecture, not a statement that code is implemented, approved for deployment, or behaviorally qualified.

## Alternatives

- Continue patching the existing finite protocol: preserves code but leaves duplicated identity/state and broad context prerequisites in the ordinary user path.
- Replace the agent engine or introduce a workflow platform: expands migration and operation cost before the existing core user journey is proven.
- Remove durable controls and rely entirely on model instructions: loses restart/replay safety, scoped authorization and trustworthy work status.

## Consequences

The plan preserves security and recovery responsibilities while reducing the number of independently maintained execution paths. It requires additive correlation/dispatch evidence fields, a trusted task-verification seam, explicit old/new admission ownership, and actual desktop/phone acceptance. Disabling new admissions cannot abandon already accepted work. Deletion and removal of the temporary rollout gate are acceptance requirements, not optional cleanup.
