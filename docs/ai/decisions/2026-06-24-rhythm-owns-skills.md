---
tags: [decision, rhythm]
---

# Rhythm owns the agent skill library; agent-stack divorced from opencode

**Date:** 2026-06-24
**Status:** Accepted (Rhythm side implemented; agent-stack side is a separate follow-up PR)

## Context

Rhythm now has a native, instance-shared self-improving skill library (the
Odysseus port: `agent_skills` store + seed import + background extractor +
relevance injection + teacher-escalation — issues P0-2, P1-1/1-2, P2-1/2-2,
P3-1/3-2, P4-1/4-2 on `feature/agent-scheduler`). The skill library is the
evolving layer; agent prompts stay stable.

Historically the agent-stack `ai-workflow sync-globals` step writes opencode
agent `.md` files into `~/.config/opencode/agents/`, and Rhythm's
`opencode_agent_writer.ts` also projects Agent Profiles → those same `.md` files.
With Rhythm now owning + evolving the skill library, agent-stack must stop being
a second writer of the opencode agent namespace, or the two will tug-of-war
(the same problem already navigated for the profile→.md work).

## Decision

- **Rhythm is the source of truth** for the opencode skill/agent namespace going
  forward. The `agent_skills` DB store (local SQLite) is authoritative; the
  one-time seed (P0-2) imported the existing agent-stack skills, after which
  Rhythm owns and evolves them.
- **agent-stack stops writing opencode agents.** The actual sever lives in the
  agent-stack repo's `sync-globals` (out of this repo's tree) and MUST be made
  as a **separate agent-stack PR** — editing agent-stack sync targets from this
  Rhythm PR is forbidden by the workflow's Source-of-Truth Guard. Until that PR
  lands, the seed importer's idempotent count-guard prevents re-import, and the
  skill *store* (DB) is unaffected by agent-stack continuing to write `.md`
  files (the store and the `.md` files are separate surfaces).

## Alternatives considered

- **Rhythm-side guard to block agent-stack writes:** rejected — Rhythm has no
  clean mechanism to prevent an external tool from writing to a shared config
  dir; the correct fix is in the writer (agent-stack).
- **Fold the agent-stack edit into this PR:** rejected — cross-repo, violates the
  Source-of-Truth Guard, and would be reverted by the next `sync-globals`.

## Consequences

- The skill-library loop is fully functional now regardless of the agent-stack
  sever (store is DB-based).
- Remaining work is a **separate agent-stack PR** to stop `sync-globals` writing
  opencode agents (tracked as the P0-1 cross-repo follow-up).
- Follow-up `11-followup-skill-body-column.md`: prose-skill body has no column
  yet (seed stores frontmatter description only).
