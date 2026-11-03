---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pending
tags: [run, Rhythm]
---

# Private disabled schedule coverage

## Files

- `apps/web/tests/packaged/packaged-ai-private-disabled-schedule.spec.ts`: a manifest-required packaged case for a nonce-owned once-only schedule. The real UI creates it with Enabled unchecked, the authenticated API sets a distant 2099 run date, and UI/API/SQLite readback checks owner, disabled state, edit/reload persistence, and empty run history. Cleanup uses normal DELETE only after exact owner/state/zero-run guards.

## Checks

- Old signed-app Recon on `28bcc2aa44` observed disabled UI create/edit/reload and no runs; its local schedule route stored a null owner, so Recon deliberately refused cleanup. Receipt: `docs/testing/results/2026-10-20-synthetic-bundled-hermes-schedule-playbook-recon.json`.
- Owner attribution was repaired separately in `c9e916888f`; focused Express/SQLite and live sandbox evidence is in `docs/ai/runs/2026-10-20-schedule-local-auth-attribution.md`. This new packaged case has **not** had native confirmation on the repaired build.
- Broad guarded strict TypeScript over `apps/web/tests/packaged/*.ts` failed only on the existing missing declaration for `tools/testing/qualification_fixture.mjs` across many specs. Repeating it produced the same TS7016 failure. The guarded focused strict TypeScript command with `--allowJs` for the new spec passed. Guarded Playwright discovery listed exactly one test.

## Notes

- This case checks disabled storage and UI state. It does not trigger a schedule, exercise the scheduler's due selection or dispatch, or supply the separate two-schedule run-history fixture required by `packaged-ai-schedules.spec.ts`.
