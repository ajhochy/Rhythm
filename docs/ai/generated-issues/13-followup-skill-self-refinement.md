# FOLLOW-UP (P5): self-refinement — the loop improves EXISTING skills in place

## Origin / intent
The Odysseus port (P1–P4) made the loop **additive only**: when the extractor or
teacher-escalation distills something close to an existing skill, it *skips* (dedup
by title). The actual goal of divorcing agent-stack from opencode was so **Rhythm
owns AND evolves the workflow skills** (coding-agent, planning-agent, etc.) — i.e.
the loop should *make the existing skills better over time*, not just pile up new
drafts beside them.

**Decided behavior (user, 2026-06-24): AUTO-APPLY refinements, with full version
history + one-click rollback, gated by a quality bar.** Fully automatic (no per-edit
approval), but never destructive (every prior version retained; rollback available).

## Critical invariant already satisfied (do NOT regress)
The seed import is one-time (`server.ts` runs `seedAgentStackSkills` only when zero
`source='agent-stack-seed'` rows exist; skips by title within a run). So refinements
to seeded skills **survive every relaunch** — the seed never overwrites them. Any
work here MUST preserve this: refinement must not re-trigger or be clobbered by seed.
(Known separate gap: a brand-new agent-stack skill added after first seed won't
auto-import — out of scope here.)

## Phases / issues

### P5-1 — version-history schema + repository (dual-DB)
- NEW table `agent_skill_versions` in BOTH migrations.ts + postgres_bootstrap.ts:
  `id, skill_id (FK agent_skills), version_no INTEGER, title, when_to_use, description,
  steps_json, tags_json, body, confidence, source, created_at`. (A snapshot of the
  skill's content at each version.)
- Add `version INTEGER DEFAULT 1` to `agent_skills`.
- Repository: `reviseInPlace(skillId, newContent, source)` = snapshot current row →
  `agent_skill_versions`, then UPDATE `agent_skills` with newContent + version+1;
  `listVersions(skillId)`; `rollback(skillId, versionNo)` = snapshot current, restore
  the chosen version as the new current (also recorded as a version → non-destructive).
- Tests: revise bumps version + writes history; rollback restores + is itself
  versioned; nothing is ever hard-deleted.

### P5-2 — refinement decision + apply (the careful part)
- In the extractor/teacher path, when a distilled candidate matches an EXISTING skill
  (title match OR relevance score above a "same-skill" threshold via getRelevantSkills),
  treat it as a **revision candidate** instead of skip/new-draft.
- **Quality bar before replacing** (avoid degrading good skills — this is the whole
  risk): do NOT revise on confidence alone. Use an LLM "judge" call: given the existing
  skill and the candidate, return better|equal|worse + reason; **only revise on a clear
  "better"** (fail-closed: equal/worse/uncertain → keep existing, optionally keep
  candidate as a normal draft). Also require candidate.confidence ≥ existing.confidence.
- On "better": call `reviseInPlace(...)` with source='auto-refined' (or
  'teacher-refined'). Auto-applies (no approval). Fire-and-forget, never-throws,
  isTestEnv-guarded (no LLM/writes under VITEST) — mirror the P2-1 extractor guards.
- Tests (injected judge + injected repo): better → reviseInPlace called, version
  bumped; worse/equal → existing unchanged; under VITEST → zero writes; judge/LLM
  throw → existing unchanged, no throw.

### P5-3 — Flutter: version history + rollback on the Skills screen
- Extend the agent_skills feature: per-skill "History" (list versions w/ source +
  timestamp) and a one-click **Rollback to this version** action (calls a new
  PATCH/POST route over P5-1's rollback). Show current version no.
- Real-surface widget test: history renders; rollback fires the repo/route.
- Routes: expose listVersions + rollback (extend agentSkillsController/routes).

## Constraints
- Auto-apply, but **non-destructive**: every version retained; rollback always available.
- Quality-gated by an LLM judge (fail-closed) so marginal/worse rewrites never replace a
  good skill — this is the safety mechanism that makes auto-apply acceptable.
- Preserve the one-time-seed invariant (refinements survive relaunch).
- Dual-DB; test-env guards on all LLM/file/db-writing paths; never-throws in the loop.
- Cost note: the judge adds one cheap LLM call per refinement candidate (only when a
  candidate matches an existing skill) — flag for confirmation.

## Out of scope
- Per-edit human approval (decided: auto-apply). A review/propose mode could be a
  toggle later.
- Refining skills that aren't matched by an extracted candidate (no unprompted rewrites).
- Auto-importing newly-added agent-stack skills after first seed (separate follow-up).
