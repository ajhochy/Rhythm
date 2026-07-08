---
date: 2026-07-08
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
supersedes: "[[2026-06-28-unify-skills-source-of-truth]]"
issue: 949
---

# Harvest skills directly to draft SKILL.md files + auto-bind to source agent

## Context

The Unify-2 decision (`2026-06-28-unify-skills-source-of-truth.md`) chose a
**materialize-on-publish** fate for the DB skill store (System B): the
extractor/refiner/retrieval services would remain as an "authoring/metadata
layer," and on publish a DB skill would be materialized to a `SKILL.md` file in
the Rhythm-managed dir.

That bridge was **never built.** Meanwhile the Flutter Skills UI migrated to
`GET /opencode/skills` (engine-discovered `SKILL.md` files) per the same
decision, so it stopped reading the `agent_skills` table. Result: harvested
drafts accumulated as invisible, orphaned DB rows — never loaded, never tested,
never evaluated. The self-improvement loop (extract → use → evaluate → refine)
never actually closed.

## Decision

Replace "DB table → materialize-on-publish" with **harvest directly to draft
`SKILL.md` file + auto-bind to the extracting agent.** This supersedes point 4
("System B fate — materialize-on-publish") of the Unify-2 decision.

1. **Harvester writes SKILL.md files, not DB rows.** `skill_extractor.ts`'s
   `distillFromSession()` writes a `SKILL.md` to a **drafts namespace** under
   the Rhythm-managed skills dir:
   `~/.config/opencode/rhythm-managed-skills/drafts/<name>/SKILL.md`.
   Frontmatter: `name`, `description`, `status: draft`, `source: harvested`,
   `provenance`, `source_session`, `confidence`, `extracted_at`. The engine
   already scans the managed dir tree, so drafts are immediately discoverable
   by `GET /opencode/skills` and visible in the Flutter Skills UI — no bridge
   needed.
2. **Confidence gate stays.** Drafts below 0.6 confidence are dropped (the gate
   is unchanged; only the output target changed from DB row to file).
3. **Auto-bind to the extracting agent only.** After writing the draft file,
   PATCH the agent profile whose session produced the draft: append the draft
   skill name to its `allowedSkillsJson`. **Critical correctness guard:** skip
   the bind when the agent is unrestricted (`allowedSkillsJson === null`) — the
   draft is already loadable to an unrestricted agent, and writing a
   single-element array would WRONGLY lock the agent down to only the draft.
   Cross-agent promotion stays a human/org-optimizer gated action.
4. **Trigger skill reload after write.** Call the existing
   `OpencodeClientService.reloadSkills(managedSkillsRoot())` so the engine
   picks up the new draft file without a restart (the Unify-2 reload pattern).
5. **Promotion is still human-gated (but evidence-backed).** AJ reviews drafts
   in the Skills UI (they're files now). Promotion = move the file from
   `drafts/<name>/` to the main managed dir + drop the `status: draft`
   frontmatter. The key difference: the draft was already loadable and tested
   in real sessions before review, so the review has real evidence ("did this
   help?") instead of being a cold read of a DB row.

## Alternatives considered

- **Build the materialize-on-publish bridge (the original Unify-2 plan).**
  Rejected: the bridge sat unbuilt for 10 days, leaving drafts invisible. The
  direct-to-file path is simpler (one write, no two-system sync) and closes the
  loop immediately.
- **Retire System B entirely (delete the `agent_skills` table + services).**
  Rejected as higher-risk in this pass: 32 direct callers across Services +
  Release modules depend on `AgentSkillsRepository` (GitNexus CRITICAL). The
  refiner and retrieval services still operate on DB rows for legacy skills.
  Cleanup is a separate follow-up once all consumers migrate.
- **Auto-bind to all agents.** Rejected: that's where sprawl gets dangerous.
  The extracting agent is the right context to test the skill (same domain that
  produced it).

## Consequences

- The self-improvement loop closes: extract → write as file → bind to source
  agent → use in next session → evaluate → refine or delete.
- No invisible state: drafts are files the UI already reads. No orphaned table,
  no unbuilt bridge.
- `AgentSkillsRepository` + the `agent_skills` table are **not deleted** in this
  pass. The refiner path still uses the repo to find/match existing DB skills
  for in-place refinement. Only the final `distillFromSession` write site
  changed (DB row → file). The old table becomes unnecessary for the harvest
  path over time; cleanup is a separate follow-up.
- Cold-start gate (`isEngineColdStart()` / 90s window) and Postgres no-op guard
  stay unchanged — drafts are local-SQLite-only and defer during cold start.
- The drafts namespace is segregated (`drafts/<name>/` vs main
  `<name>/`), so promotion and deletion are clean filesystem operations.
