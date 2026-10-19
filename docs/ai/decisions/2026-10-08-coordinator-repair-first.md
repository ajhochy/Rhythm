---
date: 2026-10-08
repo: Rhythm
status: proposed
tags: [decision, rhythm, coordinator]
index: "[[Rhythm]]"
---

# Revise Coordinator sequencing: repair before replacement

## Context

AJ requested a detailed revision after Fable challenged the original October 8 simplification plan. Independent source review confirmed existing atomic Coordinator reservation/approval and useful async delivery machinery. It also confirmed plan-mode shell restrictions, capped command history, incomplete async terminal qualification and restart coverage, and missing coding-check authority. Fable's schema, budget and population arguments contained overstatements; none establishes that every surrounding component is sound.

The integration dependency has advanced from `ac056260` to `8c003765` on draft PR #1598. The latter adds the companion receiving-session fixture correction without production changes. These source/recorded-test observations do not establish installed or actual-model workflow completion. The separate integration task retains ownership.

## Decision

Follow [the revised repair-first plan](../plans/2026-10-08-coordinator-repair-first-revised-plan.md). It supersedes the implementation direction in [the earlier proposal](2026-10-08-coordinator-single-execution-path-proposal.md), which is retained unchanged.

Preserve existing admission and delivery. Normalize the current command journal as admission/correlation evidence; leave runtime/delivery state with the async records. Keep root and manager in plan mode and grant only the exact approved coding worker scoped execution through current permission decisions. Retain current access/revocation checks, no-blind-replay semantics and truthful cancellation.

Verify immutable changed bytes, including uncommitted/untracked input, using a protected evaluator; deliver one canonical server result without requiring a new root model turn. Prove the actual manager chain before choosing broader replacement. A direct-worker control is conditional, comparable and temporary, with its own explicitly approved edge.

## Alternatives considered

- Implement the original control-layer replacement first: requires proving too much new machinery before testing the cheaper repair thesis.
- Adopt Fable's full repair list literally: omits important execution-grant, callback-anchor, cancelled-result, actual-exposure and SDK uncertainty details.
- Treat a direct-worker demo as proof the existing manager workflow works: skips the edge being evaluated.
- Remove safeguards to shorten the POC: permits false success, broadened authority or duplicate work.

## Consequences

The first real experiment is deliberately bounded. Normalized history, restart/replay, cancellation and privacy negatives remain necessary for limited desktop-POC acceptance; phone, overnight, engine restart, arbitrary descendants, retries and rollout are later claims. Compatibility follows actual affected records, with no speculative fleet migration service.

This is a planning decision only. No implementation, test run, paid experiment, Git mutation, service change or installation is authorized by recording it. Conditional implementation-base and isolation decisions are explicit in the plan.
