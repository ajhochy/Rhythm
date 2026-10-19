---
date: 2026-10-19
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1598]
status: unverified
tags: [run, rhythm, model-router, playwright]
---

## Files

- Default Grid tier-3/tier-2 boundary changes from 0.35 to 1.5. Other thresholds, fallback tier, classifier wording, routing candidates, account selection and per-session decision reuse remain unchanged.
- Unit regression captures the observed literal-edit score 0.85 → tier 3, level 1 → tier 3, feature/architecture protection and boundary cases. Existing classifier/config contracts updated for the new default.
- Packaged tests retain the failing literal-edit expectation, add a real Auto literal-edit response/served-model/reload case, and expand the live classifier set to 12 synthetic cases. Real-model opt-in remains required.
- Live sandbox test checks the revised defaults through HTTP and real engine readiness. It complements, rather than replaces, packaged real-model turn coverage.
- Contract: `docs/ai/contracts/2026-10-19-router-calibration.json`.

## Checks

- Before implementation: `cd apps/api_server && ./node_modules/.bin/vitest run src/services/decision/router_grid_calibration.test.ts --no-file-parallelism` → exit 1, three failed / four passed. The retained packaged classifier expectation previously failed repeatedly on score 0.85 → tier 2.
- Pre-change live Decisions sample: 12 synthetic prompts, expectations selected before evaluation, all successful in 135–272ms. Proposed thresholds `[0.1,1.5,2.25]` meet all 12 expectations. Single literal edit/rename/README typo/CSS spacing/obvious bounds fix/email scored 0.82–0.98 and move from tier 2 to tier 3; multi-file feature/research scored 2–2.01 and stay tier 2; hard debugging/architecture scored 2.97–3 and stay tier 1; formatting/extraction stay tier 4. No private prompt corpus or key is persisted. Raw synthetic audit: `/private/tmp/rhythm-calibration-audit.jsonl`.
- Strict packaged-spec TypeScript check → exit 0 after the new semantic response helper/test changes.
- Further unit, static, build and live results pending below. This source checkpoint is a candidate, not a completion claim.

## Notes

- The old boundary deliberately came from a 50-prompt calibration in the 2026-10-08 plan. The user now explicitly authorizes correcting the simple-edit over-routing observed in live qualification. A score of 1 represents the routine/single-file level and 2 the multi-file level; 1.5 separates those levels without touching the existing easy/frontier cutoffs. The synthetic regression set is not a held-out production-quality benchmark.
- GitNexus reports LOW / zero indexed callers for `gridTierFromScore`, `defaultRouterGridConfig` and `classifyRouterGrid`, but warns its index is 252 commits stale. Manual source review identifies the Grid turn classifier (including free-mode classification) and default-policy/UI consumers. No API/schema/auth/account symbols change. The new packaged helper is unindexed (UNKNOWN). Existing explicit override files remain authoritative; current real profile has no grid override file. Existing sessions retain their first-prompt decision.
- Work remains on the existing branch based on mega `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. The rebuilt artifact must identify this candidate's committed source revision, not the old mega SHA. Original checkout, installed app, router/account settings and unrelated dirty files are preserved. No push, PR, merge or GitHub build.
