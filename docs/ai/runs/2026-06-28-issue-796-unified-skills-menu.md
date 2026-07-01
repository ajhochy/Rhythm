---
date: 2026-06-28
repo: rhythm
branch: worktree-agent-a4c90fff5c16c60ec
pr: none (not pushed)
issues: [796, 779]
status: verified-pass
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# #796 — Standalone Skills menu → ONE unified engine-skill list (subsumes #779)

skill-unify2 epic (#791), 5/7. Based on `cb18c083e` (feature/skill-unify2 tip
with #792–#795). Committed `cd638377f` on the worktree branch, **not pushed**.

Converts the standalone Skills menu (Agents → Tools → Skills) from the
`/agent-skills` DB store to the unified read `GET /opencode/skills?withMetadata=true`
(#793), so it lists EVERY engine skill — handwritten, imported, external, and
Rhythm-managed — with provenance + auto-apply lifecycle metadata.

**Auto-apply model only.** Ignored issue #796's stale body language (proposal
review queue / Approve-Reject / `hasProposals` / publish / "Improve (fork to
managed)") — the epic moved to auto-apply + measure + auto-revert with no human
gate. Surfaced lifecycle + scores from the unified read instead.

## Files changed

- `apps/desktop_flutter/lib/features/agents/data/opencode_skills_data_source.dart`
  — added `OpencodeSkillMetadata` (mirrors api_server `SkillMetadata`:
  confidence/version/status/source/uses/baselineScore/postScore/isExternalFork),
  optional `metadata` field on `OpencodeSkillEntry`, and `listWithMetadata()`
  hitting `?withMetadata=true` (degrades to `[]` on error — no hardcoded
  fallback). Targets `AppConstants.agentLocalBaseUrl` (:4001).
- `apps/desktop_flutter/lib/features/agent_skills/controllers/agent_skills_controller.dart`
  — rewritten over `OpencodeSkillsDataSource` (was `AgentSkillsRepository`):
  `loadSkills()` reads the unified list; `deleteSkill(name)` (managed only) +
  re-fetch; exposes `dataSource` + `skillNames` for the editor sheet. Dropped
  the DB-only publish/version/rollback methods.
- `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart`
  — rewritten: unified list with MANAGED/EXTERNAL provenance badge, non-`active`
  status badge (measuring amber / reverted red), source·confidence·version·uses
  meta line, baseline→post score line when measured, "auto-improved (forked)"
  note when `isExternalFork`. Managed rows: edit (reuse
  `showManagedSkillEditorSheet`) + delete; external/handwritten: read-only (lock
  icon, no edit/delete). Top-level "New skill" create button. Keyed
  loading/error/empty states.
- `apps/desktop_flutter/lib/main.dart` — provider now
  `AgentSkillsController(OpencodeSkillsDataSource())`; dropped the 3 retired imports.
- DELETED (retired DB-only path):
  `agent_skills/data/agent_skills_data_source.dart`,
  `repositories/agent_skills_repository.dart`, `models/agent_skill.dart`,
  `models/agent_skill_version.dart`. No dead reference remains (one doc-comment
  mention of the old `/agent-skills` store).
- `apps/desktop_flutter/test/features/agent_skills/agent_skills_view_test.dart`
  — rewritten for the unified surface (fake extends `OpencodeSkillsDataSource`).

## Checks run

- `dart format --set-exit-if-changed` (changed files) → 0 changed.
- `flutter analyze --no-fatal-infos lib/features/agent_skills/ lib/features/agents/ test/features/agent_skills/`
  → 0 errors / 0 warnings (39 pre-existing `info` lints, none in changed files).
- `flutter test test/features/agent_skills/` → 10/10 pass.
- `flutter test test/features/agents/` → 453 pass / 6 fail; all 6 in
  `agent_trigger_watcher_test.dart` (documented pre-existing F2 failures;
  imports none of the changed files).
- Repo-wide stale-reference grep for removed symbols (`AgentSkillsRepository`,
  `AgentSkillsDataSource`, `AgentSkill(`, `AgentSkillVersion`) → zero hits.
- Falsification (both reverted): unconditioning the managed edit gate → the
  managed-vs-external read-only test FAILS; suppressing the score line → the
  lifecycle/score test FAILS.

## Notes

- Decision: kept the DB `AgentSkill` model deleted rather than adapting it — the
  unified read returns `OpencodeSkillEntry` (+ metadata), so the standalone menu
  and the Agent Profile picker now share ONE model. The api_server `/agent-skills`
  route is left intact (other consumers); only the Flutter menu's read path moved.
- External-fork renders as a single MANAGED row with an "auto-improved" note
  (shadowing model, per #794 decision OQ#1).
- Deferred: live visual smoke (needs a signed fork rebuild to exercise the real
  `:4001` endpoint). No automated Flutter visual tooling in-repo; mounted
  real-surface widget tests are the standing automated substitute. Pixel
  confirmation is the post-merge manual item.
- Follow-up issues filed: none.
