---
index: "[[Rhythm]]"
date: 2026-06-24
repo: Rhythm
tags: [decision, Rhythm]
---

# Implementation fell back from AgentFlow implement_issue to coding-agent subagents

## Context

The skill-library run was orchestrated via workflow-orchestrator. Planning used the
AgentFlow `mcp__agentflow__plan_and_issues` workflow successfully. The first
implementation issue (P1-1) was dispatched via `mcp__agentflow__implement_issue`.

## Decision

After dispatch, `implement_issue` **stalled**: the MCP status registry reported
`generate_contract` "running" indefinitely while nothing was written to the
checkout, and the workflow's `output/implement_issue/` dir held **stale artifacts
from a prior 2026-06-16 run** (a different issue, 842 tests) — a false "terminal"
signal. Per workflow-orchestrator's documented fallback ("if the agentflow tools
error/stall, use the skill chain unchanged"), we abandoned the stalled instance and
implemented every issue (P1-1 … P4-2) by **dispatching a coding-agent subagent via
the Agent tool**, then independently re-verifying (tsc + vitest / flutter),
committing, and `gh run watch` CI-gating before the next.

## Alternatives

- **Resume the stalled AgentFlow instance via CLI:** rejected — known to be fragile
  (see `[[project_agentflow_operational_gotchas]]`: failed instances resume only via
  CLI; stale registry), and re-triggering risks the same stall.

## Consequences

- Subagent dispatch preserved the orchestrator's context (work ran in subagents;
  only concise reports returned) and proved reliable across 9 issues.
- The orchestrator retained per-issue control: independent verification gate +
  CI gate between every issue.
- AgentFlow `implement_issue` remains unreliable in this environment; prefer the
  coding-agent-subagent path for multi-issue runs until the stall/stale-registry
  gotchas are fixed upstream.
