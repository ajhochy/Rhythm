---
date: 2026-07-09
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Collapse to one skill source: Rhythm manages ~/.config/opencode/skills directly

Supersedes `2026-06-28-unify-skills-source-of-truth.md` (Unify-2). Closes #947
(and #946 — the skill-discovery race becomes unreachable).

## Context

Unify-2 put Rhythm-managed skills in a distinct sibling dir,
`~/.config/opencode/rhythm-managed-skills`, registered additively via
`opencode.json`'s `skills.paths`. That doc said explicitly:

> "Deliberately NOT `~/.config/opencode/skills` (auto-scanned + a sync target) —
> a distinct namespaced sibling."

The *only* reason for the separate dir was a constraint from a **different**
repo: agent-stack's `ai-workflow sync-globals` wrote into
`~/.config/opencode/skills`, so Rhythm needed its own dir to avoid being
clobbered. Two further problems compounded it:

- The skill **seed importer** blanket-imported **every** `~/.claude/skills`
  entry (~25) into the DB, which then materialized into the managed dir as
  SKILL.md files — dragging Claude Code design/misc skills (impeccable/adapt/
  supabase/obsidian-*) into the model's skill picker even though no Rhythm
  agent uses them.
- The engine ALSO scanned `.claude/skills` + `.agents/skills` directly, so the
  same names could arrive by two paths and collide (#946's race).

AJ confirmed the direction: "no rhythm managed skill db; rhythm just manages the
`config/opencode/skills` list." The agent-stack `sync-globals` change (issue
step 7) is **already done** — `sync-globals` no longer writes
`~/.config/opencode/skills` (it keeps `~/.claude/skills` + `~/.codex/skills` for
Claude Code / Codex). That removes the original constraint.

## Decision

**`~/.config/opencode/skills` is Rhythm's sole managed skill source.**

1. `rhythm_managed_skills.ts` `managedSkillsRoot()` → `~/.config/opencode/skills`.
   The engine auto-scans `~/.config/opencode/{skill,skills}/**` via its hardcoded
   `ConfigPaths.directories()`, so **no `skills.paths` registration** is needed —
   the old `ensureManagedSkillsDirRegistered()` no longer writes `opencode.json`
   (renamed to `ensureManagedSkillsDir()`, just mkdirs the dir).
2. The engine is spawned with **`OPENCODE_DISABLE_EXTERNAL_SKILLS=1`** (set on
   `process.env` before `createOpencode()` so the child inherits it). This kills
   BOTH the `.claude/skills` and `.agents/skills` scans — superseding the
   claude-only `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` Config Doctor set on
   2026-07-08. The config-dir scan is NOT gated by this flag, so the managed dir
   stays discoverable — Rhythm *wants* that scan on.
3. The **seed importer no longer blanket-pulls** `~/.claude/skills`. It imports
   ONLY skills whose name is agent-referenced: the canonical built-in allowlists
   (`agent_profile_sync.canonicalAgentSkillNames()` = `WORKFLOW_CHAIN_SKILLS` ∪
   `AGENT_SKILL_ALLOWLIST_MAP` values) unioned with any name in a stored
   `agent_config.allowedSkillsJson` (user-widened allowlists). Skills an agent
   depends on are preserved; unreferenced Claude Code skills are dropped at the
   source. (Applies the #959 lesson — never silently drop a skill an agent
   needs — at the seed level.)
4. **Migration** (`migrateLegacyManagedSkills(src, dest)`): idempotent, no-loss
   MOVE of the retired `rhythm-managed-skills` dir into `skills`. Dest always
   wins (never clobbers), source files are removed only after the dest copy
   exists, and a count guard asserts every source SKILL.md is present under dest
   before pruning empties. Wired at boot behind `RHYTHM_MIGRATE_MANAGED_SKILLS`
   (default OFF) so it never runs on a real config unbidden — it folds into the
   #961 real-config remediation pass.

## Keep/drop at the source (this machine, 2026-07-09)

`~/.claude/skills` had 25 dirs with a SKILL.md. Agent-referenced (KEEP — the
13 workflow-chain skills): acceptance-contract, coding-agent, failure-postmortem,
failure-triage, issue-writer, planning-agent, project-state-updater,
prompt-evolver, smoke-test, smoke-test-writer, verification-gate,
workflow-orchestrator, workflow-retrospective. Unreferenced Claude Code skills
(DROP — no longer auto-pulled): agent-reach, defuddle, extract-design,
find-skills, json-canvas, module-audit, multirepo-orchestrator, obsidian-bases,
obsidian-cli, obsidian-markdown, supabase, supabase-postgres-best-practices.
(The impeccable design skills — adapt/animate/audit/… — have no top-level
SKILL.md and were never seeded.)

## Alternatives considered

- **#946's fix** (make the unbounded-concurrency discovery race deterministic):
  patches the symptom. Rejected — one dir + no external scans makes a same-name
  collision impossible unless Rhythm wrote both, so it's a write-time bug to
  catch, not a load-time race to survive.
- **Keep the sibling dir, just stop the blanket seed**: leaves the two-dir
  confusion and the `skills.paths` machinery. Rejected once `sync-globals`
  stopped writing `skills` — the constraint that justified the sibling is gone.
- **Retroactively delete already-seeded/materialized unreferenced skills here**:
  data-loss risk + it touches the real config. Deferred to the approval-gated
  #961 pass; this change only stops FUTURE pulls and provides the safe migration.

## Consequences

- Skills a Rhythm agent doesn't reference no longer clutter the picker; the
  discovery collision surface is gone (#946 closed).
- Edits to a dev-workflow skill inside Rhythm no longer propagate back to Claude
  Code / Codex — the forks are genuinely independent (Rhythm's copy diverges
  from agent-stack's GitHub source, synced to `~/.claude`/`~/.codex`). This is
  the intended "Rhythm manages the opencode skills" direction, named as a
  deliberate call.
- On an already-seeded machine (run-once guard) the seed won't re-run, so the
  behavior change bites fresh installs / fresh DBs; existing DBs' unreferenced
  rows + materialized files are cleaned in #961.
- **Approval-gated for #961:** running the real migration
  (`RHYTHM_MIGRATE_MANAGED_SKILLS=1`), pruning the stale `skills.paths` entry and
  the already-materialized unreferenced skills from AJ's real
  `~/.config/opencode/{skills,rhythm-managed-skills,opencode.json}`, and deleting
  the emptied `rhythm-managed-skills` dir.
