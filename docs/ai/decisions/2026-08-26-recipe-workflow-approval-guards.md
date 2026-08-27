---
date: 2026-08-26
repo: Rhythm
tags: [decision, Rhythm, recipes, security, approvals]
index: "[[Rhythm]]"
---

# Workflow approval guards are relaxed only by approval kind

## Context

Existing session approvals bind redemption to the calling session and current external-content taint. Those guards protect outbound email, messaging, calendar, Planning Center, PR creation, and other integrations from replay after injected content. A durable multi-hour workflow can legitimately change sessions and taint turns before a human decides, and the existing ten-minute TTL makes expiry the normal outcome.

AJ accepted the security tradeoff only for durable workflow approvals. A global relaxation would regress every existing outbound integration.

## Decision

Add an explicit `approval_kind='workflow'` discriminator to the existing approval row; this is not a new security binding kind or parallel approval table. In `consumeApproval`, bypass the cross-session and stale-taint comparisons only when that discriminator is present and its run/stage/attempt binding matches the active workflow transition. Keep signature, decision nonce, human-approved status, exact action/payload digest, configurable positive workflow TTL (default 24 hours), and atomic single-use `consumedAt` checks.

Session-kind approval code and behavior remain byte-for-byte unchanged. Workflow decisions do not queue `AgentApprovalContinuationService`; only the recipe runner atomically advances the bound stage once.

## Alternatives

- Add a parallel approval table: rejected as duplicate signing/decision infrastructure.
- Add a new session-binding kind or synthetic long-lived session: rejected as unnecessary identity machinery.
- Relax guards for all approvals: rejected because it weakens injection-replay protection for every outbound integration.
- Keep the ten-minute session contract: rejected because multi-hour workflows would normally expire before a human can decide.

## Consequences

A workflow approval can be consumed after its originating session or taint turn changes. This increases replay impact if workflow identity or payload binding is implemented incorrectly. Completion authorization, exact workflow binding, positive bounded TTL, single-use consumption, owner-visible audit, and fail-closed mismatch handling are therefore mandatory. Existing session approvals receive regression tests proving no behavior moved.
