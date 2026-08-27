---
date: 2026-08-26
repo: Rhythm
tags: [decision, Rhythm, recipes, orchestration]
index: "[[Rhythm]]"
---

# Recipe workflow extraction boundary

## Context

Epic #1485 requires durable enforced recipe workflows without building a second orchestration engine. Independent review verified that `ResearchProjectOrchestrator` has a research-specific loop, prompts, mutable jobs, in-process coalescing, coarse run budgets, cancellation, and restart re-dispatch. It does not have durable claims, attempt identity, a transition engine, an append-only workflow ledger, persist-first cancellation, or session reattachment.

Those missing mechanics cannot be extracted from research. Treating them as shared would either rename net-new recipe code as generic infrastructure or rewrite proven research behavior.

## Decision

Read “do not build a second orchestration engine” as **one shared agent-dispatch seam; no copied research lifecycle machinery**.

The shared `dispatchAgentStage()` surface is the minimal root `AgentRunner.run()` option bag plus existing model-override parsing. Root behavior comes from omitting `parentSessionId`; `onSessionCreated` remains caller-supplied; research's run-shaped `exhausted()` stays in research; provider-pinned escalation suppression is a small net-new `AgentRunner` option.

Research keeps its lifecycle, persistence, statuses, prompts, retry, cancellation, budgets, and restart behavior. The recipe runner owns its net-new claims, attempts, transitions, audit, cancellation fences, approval progression, and reconciliation.

## Alternatives

- Put recipes in `ResearchProjectOrchestrator`: rejected because recipes do not share research's lifecycle or state model.
- Extract a generic durable engine first: rejected because the durable mechanics do not exist in research and a generic layer would be speculative.
- Copy research's loop into recipes: rejected because it creates two drifting research lifecycles and still does not supply enforcement.

## Consequences

S2 is approximately a 20-line seam plus focused `AgentRunner` escalation support, not a broad architecture project. S1b and S3a repository/transition work can proceed independently; only recipe dispatch wiring waits for S2. Any implementation that moves research's budget predicate or copies research lifecycle machinery violates this decision.
