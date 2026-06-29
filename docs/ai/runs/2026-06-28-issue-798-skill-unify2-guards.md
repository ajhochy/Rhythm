---
date: 2026-06-28
repo: Rhythm
branch: feature/skill-unify2
pr: null
issues: [798]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #798 — skill-unify2 guards

## Files

- `tools/release/smoke_skill_alignment.sh` — built-fork managed keep, exact
  managed revert, external fork/revert, and live-name assertions.
- `apps/api_server/src/services/rhythm_managed_skills.ts` — confined exact-byte
  restore helper.
- `apps/api_server/src/services/skill_measurement.ts` — use exact-byte restore
  for managed rollback while preserving injected test compatibility.
- `apps/api_server/src/__tests__/skill_apply_measure_e2e.test.ts` — real
  filesystem byte-identity and external-file safety guards.
- `apps/api_server/src/__tests__/skill_names_alignment.test.ts` — unified
  metadata-name/status invariants.
- `apps/api_server/src/__tests__/skill_schema_parity.test.ts` and
  `.github/workflows/desktop_release.yml` — explicit parity-test CI wiring.
- `docs/ai/contracts/issue-798.json` — seven executable acceptance criteria.

## Checks

- Initial contract run: expected failures for byte-identical managed restore and
  explicit parity CI wiring.
- Targeted Vitest: 25/25 pass.
- `npm run build`: pass.
- `tools/release/smoke_skill_alignment.sh <built-arm64-fork> 4499`: pass.
- `ai-workflow checks --level issue`: pass.
- `ai-workflow checks --level pr`: pass.
- `npm run smoke:launch`: build, bind, `/health`, capabilities, and session
  creation pass.
- GitNexus `detect_changes --scope unstaged`: LOW risk, 0 affected processes.

## Notes

- GitNexus blast radius for the rollback path is LOW: two direct callers,
  `measureAppliedSkill` and `recoverStuckMeasurements`, with no affected process.
- PR #799 is documentation-only. The implementation belongs on the combined
  `feature/skill-unify2` branch and should eventually target `main`.
- The first TypeScript build after adding the restore adapter failed because
  `Buffer.isBuffer` did not narrow the full `string | ArrayBufferView` union.
  A small explicit string/ArrayBufferView conversion helper corrected the type
  boundary; the behavioral tests had already passed and no follow-up issue was
  needed.
