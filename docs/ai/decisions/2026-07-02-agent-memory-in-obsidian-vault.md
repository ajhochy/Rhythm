---
date: 2026-07-02
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Agent memory lives in the Obsidian vault at AGENT-MEMORY/<kind>/, injected on-demand

## Context

The memory-vault epic (#801) made the Obsidian vault the source of truth, but it
defaulted to a dedicated `~/Documents/Memory-Vault`, separate from the user's main
Obsidian vault. Live testing (2026-07-02) surfaced how the write/inject/scan paths
actually behave and where the design still leaks.

## Decision

1. **Location:** agent memory lives INSIDE the main Obsidian vault at
   `~/Documents/Obsidian Vault/AGENT-MEMORY/<kind>/<slug>.md`. Set via
   `MEMORY_VAULT_PATH=<vault>/AGENT-MEMORY` + the new `MEMORY_VAULT_SUBDIR=""`
   (default `memory` preserved for back-compat). The scanner reads
   `MEMORY_VAULT_PATH` RECURSIVELY, so it must point at the dedicated AGENT-MEMORY
   dir — never a whole multi-purpose vault root (that would index every note).
2. **Kinds (the real set):** `fact | person | project | preference | context`.
   Folders are cosmetic; the note's frontmatter `kind` drives indexing.
3. **Injection model (kept as-is):** top-5 RELEVANCE-scored memories per turn
   (FTS against the incoming prompt) + the on-demand `rhythm_search_memory` tool.
   NOT bulk-injection. No always-on identity pin (can revisit).
4. **Runs are NOT memory:** dev-project run logs stay as on-demand vault docs
   (`Projects/<repo>/ai-runs/`, surfaced by `Runs.base`). Agents reach them via a
   single `context` navigation-pointer memory + obsidian tools — never bulk-injected.
   Dashboards/MOCs (`Home`, `Runs.base`, `Command Center.base`) are navigation, not
   memory, and must not be indexed.
5. **Single source of truth (intent, not yet enforced):** the standalone `memory`
   knowledge-graph MCP (`~/Documents/Claude-Memory/memory.jsonl`) is a SECOND store
   and violates this; consolidation tracked in #860.

## Alternatives considered

- Keep the dedicated Memory-Vault (rejected: user wants memory in the main vault).
- `AGENT-MEMORY/memory/<kind>/` zero-code nesting (rejected: redundant; chose the
  configurable subdir for a clean `AGENT-MEMORY/<kind>/`).
- Bulk-inject all memory / a big always-on block (rejected: token cost + noise;
  relevance top-5 + on-demand is leaner).
- Index runs / MOCs into memory (rejected: pollution — runs are events, MOCs are
  navigation, neither is durable knowledge).

## Consequences

- Agent memory is browsable/linkable in the user's main Obsidian vault alongside
  research/project notes, per the "one vault with folders" intent.
- The infra works end-to-end (verified live). The remaining gaps are governance:
  agents over-remember (near-duplicate bloat) → #859 (write-time dedup +
  consolidation pass), and there are two parallel stores → #860.
- Any note dropped under AGENT-MEMORY is indexed as a memory (kind defaults to
  `fact`), so meta-notes must NOT be placed there until a skip mechanism exists.
