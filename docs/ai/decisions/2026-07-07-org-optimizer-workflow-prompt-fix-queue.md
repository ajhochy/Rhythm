---
date: 2026-07-07
repo: Rhythm
branch: codex/mega-open-prs-2026-07-07
tags: [decision, Rhythm]
---

# Org Optimizer Workflow Prompt Fix Queue

## Context

The org optimizer workflow-signal lane read recent sessions, but it only routed
signals into recipe refinement or delegation proposals. That left the intended
workflow-retrospective -> prompt-evolver behavior uncovered: failed workflow
runs and W/P taxonomy evidence did not become reviewable prompt/skill repair
work.

## Decision

Add a high-risk `workflow-prompt-fix` proposal lane. The extractor now emits
workflow/process signals from recent workflow transcripts and errored workflow
agent sessions. The generator writes deduped proposal rows that carry the
affected skill, category, evidence, and proposed guard text.

These proposals are queued for human review. The optimizer must not directly
edit skill files or AgentFlow workflows.

## Alternatives

- Auto-apply `refine-skill` proposals: rejected because prompt-evolver's own
  discipline requires human-reviewed PRs for skill changes.
- Only document the gap: rejected because the optimizer would still fail to
  surface findings in the existing proposal queue.
- Create a separate workflow optimizer pipeline: rejected because the existing
  org optimizer proposal store is already the review surface.

## Consequences

- Workflow prompt repairs are visible in the existing org proposal queue.
- Repeated optimizer runs dedupe on affected skill, category, and evidence.
- A future applier/PR creator can consume the proposal payload, but this change
  intentionally stops at reviewable proposal creation.
