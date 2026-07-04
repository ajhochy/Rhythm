---
date: 2026-07-04
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Rhythm owns its projected agent normalization

## Context

The installed workflow-orchestrator file can originate with frontmatter from a
separate agent-stack sync, while Rhythm adds profile-derived routing content.
The repositories are intentionally independent.

## Decision

Rhythm normalizes only the fields required by its own runtime contract when
projecting `workflow-orchestrator.md`: a self-safe coding handoff and
`permission.write: allow`. No agent-stack source is edited.

## Alternatives considered

- Edit agent-stack's canonical OpenCode template: rejected because the user
  requires Rhythm agents and agent-stack agents to remain separate.
- Preserve all unmanaged frontmatter unchanged: rejected because it leaves
  Rhythm's configured workflow profile unable to create required files.

## Consequences

Rhythm resyncs remain self-healing for these two requirements. Other profiles'
unmanaged frontmatter and routing behavior remain unchanged.

