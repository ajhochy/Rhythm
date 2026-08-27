---
date: 2026-08-26
repo: Rhythm
tags: [decision, Rhythm, recipes, security, approvals]
index: "[[Rhythm]]"
---

# Workflow approval guards are relaxed only by approval kind

## Context

Existing session approvals reject a supplied token on a clean consuming session and bind redemption to the calling session, bound profile/agent, and current external-content taint. Those guards protect outbound email, messaging, calendar, Planning Center, PR creation, and other integrations from replay after injected content. Separately, explicit interactive root bypass and unattended scheduled auto-approval can authorize without token redemption. A durable multi-hour workflow can legitimately change sessions, agents, and taint turns before a human decides, and the existing ten-minute TTL makes expiry the normal outcome.

AJ accepted the security tradeoff only for durable workflow approvals. A global relaxation would regress every existing outbound integration.

## Decision

Add an explicit `approval_kind='workflow'` discriminator to the existing approval row; this is not a new security binding kind or parallel approval table. In `consumeApproval`, load that discriminator before choosing a branch. Only after the row's run/stage/attempt binding matches the active workflow transition may the workflow branch replace the clean-consuming-session, cross-session, bound-profile/agent, and stale-taint comparisons. Keep signature, decision nonce, human-approved status, exact action/payload digest, and atomic single-use `consumedAt` checks.

Persist a durable workflow marker on every workflow stage session. `hasExplicitInteractiveApprovalBypass` returns false for a workflow-marked session or ancestor, and `isUnattendedAutoApproveSession` returns false for a workflow-marked session, regardless of root permission mode or `scheduledTaskId`. Put each exclusion once in its shared predicate, not in callers.

Add `getWorkflowApprovalTtlMs()`, reading `RHYTHM_WORKFLOW_APPROVAL_TTL_MS` fresh and accepting only a positive integer millisecond value, with `86_400_000` (24 hours) as fallback. Use it only when creating workflow approvals. Existing session approvals keep the unchanged ten-minute constant.

Session-kind guard expressions, errors, and behavior remain byte-for-byte unchanged. Workflow decisions do not queue `AgentApprovalContinuationService`; only the recipe runner atomically advances the bound stage once.

## Alternatives

- Add a parallel approval table: rejected as duplicate signing/decision infrastructure.
- Add a new session-binding kind or synthetic long-lived session: rejected as unnecessary identity machinery.
- Relax guards for all approvals: rejected because it weakens injection-replay protection for every outbound integration.
- Keep the ten-minute session contract: rejected because multi-hour workflows would normally expire before a human can decide.

## Consequences

A workflow approval can be consumed after its originating session, bound agent, or taint turn changes, including when the consuming session has no current taint row. This accepted scope increases replay impact if workflow identity or payload binding is implemented incorrectly. Completion authorization, exact active workflow binding, positive workflow-only TTL, single-use consumption, owner-visible audit, shared workflow-session bypass exclusions, and fail-closed mismatch handling are therefore mandatory. The existing session-kind guards remain byte-for-byte and receive regression tests proving no behavior moved.
