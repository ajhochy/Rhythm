---
date: 2026-09-07
index: "[[Rhythm]]"
tags: [decision, rhythm]
---

# Replace scheduled org optimization with a proposal-only reviewer

## Context

The previous scheduled optimizer delegates diagnosis and proposal generation to several server generators. Its startup reconciliation can re-enable old tasks. The requested replacement is one weekly agent that reads recent transcripts, verifies recurring root causes against current state, and submits concrete repairs for human review.

The queue already supplies kind-specific validation, risk classification, security-note requirements, atomic deduplication, ownership, serialization, and human approval/rejection/reversion. It lacks a supported ordinary proposal submission operation. The existing localhost bypass is insufficient authority for the new operation.

## Decision

- Reuse `AgentOrgProposalsRepository`, `classifyProposalRisk`, `validateProposalChange`, security-note helpers, and the existing proposal serializer and human lifecycle. No parallel proposal store or orchestration framework.
- Add two narrowly scoped MCP operations: bounded review-context reads and proposal submission. Authenticate their HTTP seams with the existing engine-signed trusted MCP call, resolve the durable session/profile/schedule, and derive ownership on the server. Neither caller-provided identity nor an ordinary bearer alone grants reviewer authority.
- Allow only concrete, validated repair kinds supported by existing appliers. Exclude external adoption, tool installation, agent creation, and recipe generation from this seam. The server creates only `proposed` rows and never invokes an applier.
- Persist server-owned reviewer provenance requiring a human decision. Existing automatic promotion refuses these proposals even if an experiment later verifies them and global promotion is enabled; ordinary human lifecycle endpoints remain authoritative.
- Require bounded evidence references, current-state proof, exact minimal repair, confidence, root-cause dedup identity, rollback, risk explanation, and observable verification. Recheck current state on submission; missing or stale evidence produces no proposal. Derive durable deduplication from the actual repair so changing a title or caller key cannot create an exact duplicate. Also suppress repair wording variants for the same owner, kind, target, normalized root cause, and current-state hash.
- Treat transcripts and inspected content as untrusted evidence. The reviewer receives only its owned skill and the two review tools. Core execution, file mutation, network access, and delegation are denied by engine permissions.
- Seed the Rhythm-owned skill and `Org Reviewer` profile (`openai/gpt-5.6-sol`) through existing startup/repository/projection conventions. Schedule Monday 08:30 America/Los_Angeles. Retire competing legacy schedules and automatic external-discovery triggers without changing existing queue records.
- Preserve the legacy HTTP/MCP names as explicit retirement responses. Their old generator execution is unavailable, so unscoped or stale agents cannot restart automatic pruning, recipe generation, or application through those entry points.
- Preserve explicit task denial during profile projection and use ordinary permission mode for reviewer dispatches in both the engine request and durable session record. Other agents keep their existing dispatch mode.
- Separate deterministic transport/security tests from the real-model behavioral scenario. A scripted provider can exercise signed MCP calls and denials, but cannot prove semantic clustering or diagnosis quality.

## Alternatives

Direct database writes bypass validation and identity boundaries. Reusing the old optimizer tool retains the generator pipeline. Granting shell or general HTTP access defeats least privilege. A new proposal model duplicates existing lifecycle and rollback behavior.

## Consequences

The replacement cannot install or apply its recommendations. Findings outside the supported repair kinds remain unsubmitted. Missing dispatch provenance must suppress a profile-model diagnosis rather than manufacture a cause. Human approval/reject/revert behavior remains the existing implementation. Runtime permission projection must preserve an explicit delegation denial.

Implementation and execution evidence belong in the run record. This decision does not claim that the change has passed verification or been deployed.
