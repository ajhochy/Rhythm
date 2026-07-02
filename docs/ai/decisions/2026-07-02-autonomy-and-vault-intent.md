---
date: 2026-07-02
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Maintainer intent: vault topology, epic sequencing, local models, optimizer autonomy

## Context

The 2026-07-02 opencode-integration audit surfaced four open intent questions
blocking epic #801 (memory vault) and epic #816 (org self-optimizer) work.
Answered by the maintainer in a structured interview.

## Decision

1. **Vault topology: ONE Obsidian vault with folders.** Agent memory lives in
   its own folder (`memory/<kind>/<slug>.md`, as already implemented);
   research/project/work notes live beside it. No second vault.
2. **Sequencing: #801 and #816 in parallel.** (#801 then found already
   shipped, so #816 proceeds alone.)
3. **Local models (Ollama/Qwen): nice-to-have.** Cloud stays the workhorse;
   tool-surface slimming is worthwhile for cost/speed but gates nothing.
4. **Optimizer autonomy: FULL AUTONOMY WITH ROLLBACK.** Auto-apply any
   proposal that is measured and reversible (including recipes, #823); human
   sign-off ONLY for new-agent creation (#824) and external discovery/adoption
   (#828). The review queue (#826) is the exception path / audit trail, not
   the default path. `proposed → applied` without approval is legal for the
   auto-apply lane (implemented in #817's state machine).
5. **Obsidian write designation (#834): secretary + worship-planning only**,
   mirroring librarian's reference grant. Other roled agents stay read/search.

## Alternatives considered

Two vaults with differing write policies (rejected: complexity); memory-first
sequencing (moot — already shipped); local-model-as-requirement (rejected:
196K-ctx Qwen unusable with the ~150K-token full tool surface); everything
human-gated (rejected: too slow for the self-improvement flywheel).

## Consequences

- #820 risk predicate classifies measurable+reversible → auto-apply lane;
  new-agent/external → human gate. #821/#823/#826 acceptance criteria amended
  on GitHub accordingly.
- Tool-surface token budgeting remains a recommended optimization track
  (benefits cloud cost even though local is optional).
- Writing to the personal vault by secretary/worship-planning is high-impact;
  the grant is opt-in per agent and reversible by role-file edit.
