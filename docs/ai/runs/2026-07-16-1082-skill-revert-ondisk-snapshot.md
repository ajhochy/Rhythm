---
date: 2026-07-16
repo: Rhythm
branch: (orchestrator-owned)
pr: (pending)
issues: [1082]
status: implemented-awaiting-verification
tags: [run, rhythm]
---

# #1082 — org-optimizer skill revert can restore a stale DB body

## Files changed
- `apps/api_server/src/services/rhythm_managed_skills.ts` — added
  `readManagedSkillBody(name)`: reads the frontmatter-stripped on-disk body of a
  managed SKILL.md (mirrors `readDraftSkill`/`readDisabledSkill`). The FILE is
  the source of truth for skill bodies.
- `apps/api_server/src/services/org_proposal_appliers_wiring.ts` —
  `applySkillBodyRevision` now snapshots `priorBody` from the on-disk file
  (`readManagedSkillBody(skill.title)`), falling back to `skill.body` only when
  no managed file exists. Function signature unchanged.
- `apps/api_server/src/__tests__/issue_1082_skill_revert_ondisk.test.ts` — new
  contract test.

## Fix direction & why
Chose **(A) snapshot prior bytes from the FILE**, not (B) write-through
`agent_skills.body` on PUT.

- The revert path (`revertProposal` in `org_proposal_apply.ts`, the
  `workflow-prompt-fix`/`refine-skill` branch) is the ONLY consumer of the
  `beforeSnapshotJson.priorBody` produced by `applySkillBodyRevision`. It
  restores that body to both the DB and the file via `writeManagedSkill`,
  clobbering a user's on-disk edit when the DB row is stale.
- The sibling auto-distill lane (`skill_apply.ts` → `skill_measurement.ts`)
  already snapshots real FILE bytes (`snapshotManagedSkillBytes` →
  `readManagedSkillSnapshotBytes`) and is unaffected — so no path depends on
  `agent_skills.body` being fresh here.
- (A) is localized to the applier + one small file reader; (B) would change a
  hot HTTP route (`PUT /opencode/skills/:name`) used by every skill edit, a
  wider blast radius for no additional consumer benefit. Smallest correct diff.

## Impact
GitNexus `impact(applySkillBodyRevision, upstream)`: **LOW** risk. 2 direct
callers (`workflowPromptFixApplier`, `refineSkillApplier`), both in the same
file; 0 processes affected; 1 module (Services). Signature unchanged, so no
caller edits needed.

## Checks run
- New contract test (proves no data loss):
  `MEMORY_VAULT_SUBDIR=memory npx vitest run src/__tests__/issue_1082_skill_revert_ondisk.test.ts`
  → 1 passed. Verified it FAILS without the fix (temporary revert to
  `skill.body` showed the revert restored the stale DB body — "ORIGINAL body
  persisted in agent_skills.body" instead of the on-disk edit), then restored
  the fix.
- Related suite (new + org_proposal_apply + issue_981_refine_task + both
  rhythm_managed_skills tests): **30 passed**.
- `npx tsc -p tsconfig.json --noEmit` in apps/api_server → exit 0.

## Notes
- Environment repair only: `better-sqlite3` was built against a stale Node ABI
  (NODE_MODULE_VERSION 137 vs required 147 on Node v26.5.0). Ran
  `npm rebuild better-sqlite3` — no source/dependency/lockfile change. Not a
  product defect.
- No running server needed (pure vitest, in-memory SQLite + temp
  `RHYTHM_MANAGED_SKILLS_DIR`); sandbox not used.
- Pre-existing untracked `docs/ai/runs/2026-07-15-*.md` files are from other
  work and left untouched.
- git is orchestrator-owned; no branch/commit/push performed here.
