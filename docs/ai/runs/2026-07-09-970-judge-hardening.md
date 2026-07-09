---
date: 2026-07-09
repo: Rhythm
branch: wt/970-judge-hardening
pr: null
issues: [970]
status: completed
tags: [run, Rhythm]
---

# #970 Judge Hardening

## Files

- `apps/api_server/src/services/model_fallback.ts` — exported #930's default model map and added `resolveReliableAuthedFallbackModel`, which selects the first authed reliable fallback-chain tier while excluding OpenRouter/free.
- `apps/api_server/src/services/skill_refiner.ts` — real judge/scorer/rewrite calls now use the reliable fallback-chain model helper instead of `resolveRunModel()` / MRU.
- `apps/api_server/src/services/harvested_skill_evaluator.ts` — wraps each `scoreSkillBody` judge call in a per-draft timeout (`RHYTHM_HARVEST_JUDGE_TIMEOUT_MS`, default 60000ms); timeout logs metadata only and skips that draft.
- `apps/api_server/src/__tests__/harvested_skill_evaluator.test.ts` — added a hanging scorer regression proving later drafts still evaluate after a timeout.

## Checks

- PASS: `cd apps/api_server && npx tsc --noEmit`
  - Note: this worktree's `apps/api_server/node_modules` symlink was incomplete, so a temporary root `node_modules` symlink to `/Users/ajhochhalter/Documents/Rhythm/node_modules` was used for verification and removed after the command.
- PASS: `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/harvested_skill_evaluator.test.ts`
  - Result: 1 file passed, 22 tests passed.
- PASS: `git diff --check`
- BLOCKED: `gitnexus detect_changes --scope compare --base_ref main`
  - No GitNexus MCP/local binary was available. The documented `npx gitnexus@latest ...` fallback timed out after 10s under restricted network (`spawnSync npx ETIMEDOUT`).

## Notes

- No `skill_extractor.ts` edits.
- No live behavioral test was added; this is backend hardening of a local-only fire-and-forget sweep with no new public API surface.
