---
date: 2026-06-28
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Unify skills onto the opencode engine's file store; Flutter reads + writes that store

> **SUPERSEDED (2026-07-09, #947)** — the "distinct namespaced sibling"
> `~/.config/opencode/rhythm-managed-skills` and the additive `skills.paths`
> registration described below are retired. Rhythm now manages
> `~/.config/opencode/skills` directly as the SOLE skill source (auto-scanned by
> the engine; external `.claude`/`.agents` scans disabled via
> `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`; no blanket auto-pull of ~/.claude/skills).
> See `2026-07-09-single-skill-source-config-opencode-skills.md`. The read/write
> mediation, materialize-on-publish, and reload mechanics from this doc still
> hold — only the directory and the external-scan posture changed.

## Context

After #775 (PR #776) enforced per-agent skill scoping in the fork, skills remained
scattered across three systems with three hardcoded name lists that drift from what the
engine actually serves:

- **System A — opencode fork filesystem skills** (`SKILL.md` under `.claude/skills`,
  `.agents`, opencode config dirs, and `config.skills.paths/urls`). This is the **only**
  set the model actually loads (`session/system.ts`, `tool/registry.ts`, `tool/skill.ts`).
  `GET /skill` already exposes it (`httpapi/handlers/instance.ts` -> `skill.all()`).
- **System B — Rhythm DB skill store** (`AgentSkillsRepository` + extractor/refiner/
  retrieval/seed services + Flutter `agent_skills` feature). `buildSkillsPreface` injects
  these as an inert **text hint** only — not the capability gate (its allowlist filter is in
  the wrong namespace; see 2026-06-28-skill-scope-enforcement.md).
- **System C — per-profile scoping** (`agent_configs.allowed_skills_json`) resolved by
  `agent_profile_scope.ts`, pushed to the fork via `updateSessionSkillAllowlist` /
  `createSession` (the #775 path). It matches on the fork's `SKILL.md` `name`.

Three hardcoded name sources drift from System A:
1. `_kAvailableSkills` — `_agent_profile_sheet.dart:33` (the skills picker).
2. `_kAvailableMcps` — `_agent_profile_sheet.dart:16` (the MCP picker).
3. `AGENT_SKILL_ALLOWLIST_MAP` + `WORKFLOW_CHAIN_SKILLS` + `deriveSkillAllowlist()` —
   `agent_profile_sync.ts:168-261` (per-agent allowlists hand-derived at import time).

A name in any of these that doesn't exactly match a discovered skill's `name` silently
scopes to nothing matchable — the exact #775 hazard.

## Decision

Make **System A (the engine's file store) the single source of truth**, and have api_server
(same machine as the fork) mediate reads and writes:

1. **Read**: api_server proxies the fork's `GET /skill` as `GET /opencode/skills`
   (mirroring `opencode_models_routes` / `opencode_mcp_routes`). All three hardcoded lists
   are replaced by live data — pickers and `agent_profile_sync` source from this set, so
   stored `allowed_skills_json` names are guaranteed to match what the fork can enforce.
2. **Write**: api_server owns a dedicated **Rhythm-managed skills dir**, registered with the
   fork **additively** via `config.skills.paths`. api_server writes/edits/deletes `SKILL.md`
   files there directly (no fork write API). Rhythm writes/deletes **only** inside this dir;
   all other discovered skills (plugins, `~/.claude/skills`, superpowers, anthropic-skills)
   are **show + scope only**.
3. **Re-scan trigger**: the fork's discovery is memoized in `InstanceState`
   (`skill/index.ts`). Add `Skill.reload()` that calls `InstanceState.invalidate` on the
   `discovered` and `state` caches and re-scans; expose a reload route. api_server calls it
   after any managed-dir write so new/edited/deleted skills appear without an engine restart.
4. **System B fate — materialize-on-publish**: keep the DB store + its extractor/refiner/
   retrieval/seed services as an **authoring/metadata layer**. On publish, a DB skill is
   **materialized** to a `SKILL.md` in the managed dir (then reload). `buildSkillsPreface`
   stays an inert hint, explicitly documented as NOT the capability gate.
5. **Guards**: a names-alignment test (`allowed_skills_json` names subset of `GET /skill`
   names) and a no-skill-lost discovery-count/name check (the managed-dir registration is
   additive — counts/names before == after + the managed additions), plus a real-binary
   smoke mirroring `smoke_skill_allowlist.sh`.

This supersedes follow-up issue **#777** (which asked only to de-hardcode the skills picker);
#777 becomes a subset of this work.

## Alternatives considered

- **Retire System B for user-facing skills** (engine files become the only store): cleaner
  conceptually but removes the curation loop (extractor/refiner) and has a much larger blast
  radius (delete the `agent_skills` feature + services). Rejected as higher-risk; the user
  chose materialize-on-publish.
- **Keep System B inert and only de-hardcode the pickers**: smallest change, but leaves the
  two-systems confusion in place and never gives users a way to author engine skills.
  Rejected — doesn't reach "one source of truth" or the write goal.
- **Add a write API inside the fork**: more fork surface to maintain and rebuild/sign.
  Rejected — api_server is co-located with the fork and can write files directly; the fork
  only needs a read-only reload trigger.
- **Relocate existing skills into the managed dir**: violates "do not break current skills"
  and risks clobbering `~/.claude/skills` (a `sync-globals` target). Rejected — registration
  is purely additive.

## Consequences

- The Flutter "Skills" menu reads the engine's real discovered skills and can author
  Rhythm-owned skills that the model can actually load.
- `allowed_skills_json` names are guaranteed to align with `GET /skill`, so #775 scoping
  can no longer silently match nothing due to a stale hardcoded name.
- The fork gains a `Skill.reload()` + route; shipping it live requires a fork rebuild +
  signed release (manual follow-up, same constraint as #775). Fork logic is covered by fork
  unit tests + the real-binary smoke, so CI is green without a signed release.
- The Rhythm-managed dir must never collide with the `sync-globals` path
  (`~/.claude/skills`, `~/.codex/skills`, `~/.config/opencode/skills`).
- System B remains as the authoring layer; `buildSkillsPreface` stays a documented hint.
