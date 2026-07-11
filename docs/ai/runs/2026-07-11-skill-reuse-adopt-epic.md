---
date: 2026-07-11
repo: Rhythm
branch: epic/skill-reuse-adopt-2026-07-11
pr: 1017
issues: [983, 984, 985, 986, 987, 988, 989, 990, 991, 992, 993, 994, 995, 996, 997]
status: verified-pre-pr
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Skill reuse (Stage A) + external discovery/adoption (Stage B) epic

15-task epic (milestones 87/88) coded by **Sonnet 5 agents** in isolated worktrees after
Codex terra hit its usage limit at the epic's first task. Stacked on the 9-bug wave
(PR #1016) → PR #1017.

## Dispatch model
- #983 (shared contract) — 1 Sonnet agent (blocks everything). Merged first.
- Plan A rest (#984–987) + Plan B (#989–996) — **2 parallel Sonnet agents**, disjoint files
  (`skill_reuse.ts`/`skill_extractor.ts` vs org-optimizer discovery/adopt/measure), both on #983.
- #988 / #997 live-probes — run by the orchestrator.

## Files
- **New:** `agent_capability_gaps_repository.ts` (+test), `skill_reuse.ts`, `generators/external_discovery_search.ts`.
- **Modified:** `migrations.ts`, `skill_extractor.ts`, `org_audit_service.ts`, `external_discovery_generator.ts`, `org_optimizer_run_service.ts`, `org_proposal_appliers_wiring.ts`, `org_proposal_apply.ts`, `org_proposal_measure.ts`, `rhythm_managed_skills.ts`.

## Checks
- Integrated `tsc --noEmit`: 0 errors (Plan A + Plan B together).
- Unit: capability-gaps repo 14, external-discovery generator 11, org_proposal apply/routes/audit 32 — pass.
- **Live (#988 Plan A probe): PASS** — deterministic offline driver against real `distillFromSession`:
  Probe A intent→auto-wire library skill, no draft; Probe B no-match→one `open` capability-gap
  (stable sha256 dedup key) + unblocking draft.
- **Live (#997 Plan B probe): chain verified + defect fixed.** Standalone api_server on :4099 +
  built fork (isolated DB/skills copies). Seeded gap → optimizer run surfaced it (#989) → discover
  → skills.sh hit → provenance (GitHub API 200) → download → #873 scan → judge (real anthropic call).

## Notes / findings
- **Real defect caught by the live-probe + fixed (#990):** `skillDownloadUrl` built
  `{owner}/{repo}/HEAD/{sub}/SKILL.md`, which 404s on real skills.sh repos (e.g.
  `github/awesome-copilot` → `skills/<name>/SKILL.md`). Every candidate was silently dropped at
  download → external-adoption was inert on live data. Fixed to derive the subdir from `hit.name`
  and try common layouts; verified the pipeline now reaches the judge with real content.
- **#997 not fully closed:** full approve→adopt→KEPT/REVERTED behavioral arc not observed
  (judge `scoreSkillBody` scored 0/0 in the bare standalone — existing #930 machinery, unit-covered).
  Deferred to a follow-up run with a strong provenance-complete candidate + live behavioral turn.
- **Ops gotcha:** the Sonnet agents' `git add -A` committed worktree `node_modules` symlinks
  (`.gitignore` `node_modules/` matches dirs, not symlinks); merging clobbered the main checkout's
  real `node_modules` with a self-loop symlink → reinstalled root + api_server deps. Future agent
  prompts should use `git add -u` + explicit new paths, or gitignore the symlinks.
- Codex terra usage limit resets ~8:03 PM PDT (2026-07-10); switched to Sonnet 5 per user.
