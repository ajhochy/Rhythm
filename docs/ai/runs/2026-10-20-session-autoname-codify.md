---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, rhythm]
---

# Session auto-naming Codify

## Files

- `apps/web/tests/packaged/packaged-ai-private-session-autoname.spec.ts`: one checked, explicit private-actor/model-loan case. It creates an actually untitled ordinary session, sends one no-tools user turn through the packaged UI, and binds the completed SDK answer and generated engine title to API, SQLite, history list and visible rail before and after reload. A generated phrase is compared dynamically, never injected or hardcoded. Exact nonce-owned row/SDK/cwd cleanup and restoration of synthetic profile/model visibility are required.
- `docs/testing/results/2026-10-20-synthetic-session-autoname-recon.md`: sanitized positive private Recon transcript.
- `/private/tmp/rhythm-session-autoname-checked-confirm-20261020/`: owner-only independent one-case Confirm config and fresh-loan launcher; kept outside the repository.

## Checks

- Private Recon passed **1/1**, 6.7-second case / 42.3 seconds total, CLI exit 0 on exact signed b7d5. The engine, API, SQLite, history list and rendered rail agreed on a generated title after one linked real Luna answer and after reload; zero tool parts and exact cleanup were observed. Whole loan scrub reported unchanged source hashes. This is Recon evidence, not checked-test Confirm.
- GitNexus upstream impact for the new test symbol returned `UNKNOWN`, zero indexed callers; the index trails this worktree by 321 commits. Manual blast radius is the new packaged case and its private Confirm launcher. No production or shared helper symbol was edited.
- Existing `packaged-sessions.spec.ts` named-session persistence and blank-name cancellation cases are **KEEP**: they protect explicit-name and no-allocation flows, but cannot catch failure to generate or persist a title after a real turn.
- `npm run build:guard -- ./apps/web/node_modules/.bin/tsc -p /private/tmp/rhythm-session-autoname-checked-confirm-20261020/tsconfig.json` — strict checked-spec TypeScript exit 0.
- `npm run build:guard -- node /private/tmp/rhythm-session-autoname-checked-confirm-20261020/launch-confirm.mjs --list` — exactly one case in one file, exit 0; `node --check` and `git diff --check` also exit 0. These static checks did not launch an app, create a fixture or make a model call.
- Fresh independent native Confirm **failed 0/1** on exact signed b7d5 (110.484 seconds total, no skips/flaky cases, CLI exit 1). The real main SDK Luna answer `42` completed with zero tools, but the engine title still matched its initial placeholder after the bounded 70-second wait. The unchanged naming assertion caught the failure; this is separate from the prior positive Recon. Log `/private/tmp/rhythm-private-b7d5-autoname-checked-confirm-20261020.log`; JSON `/private/tmp/rhythm-session-autoname-checked-confirm-20261020/confirm-s1lI6B/report.json`. Exact owned cleanup reported zero errors, and whole loan ZxiNEp was scrubbed with `sourceHashesUnchanged:true` in that report directory's `scrub.json`.
- Test-only failure diagnostics now capture the engine title and API name before the assertion, effective `small_model`, hidden title-agent route and candidate catalog metadata without including raw config, credentials or engine logs. Guarded strict TypeScript and one-case discovery passed. These diagnostics are **UNRUN** in a signed app; they do not explain the subtype of the already scrubbed failure.

## Notes

The fork starts title generation in a separate background model request. The failure receipt lacks that request's safe error class, so provider rejection, empty response and update failure remain distinct hypotheses. A private test-first scripted-provider matrix for those paths is at `/private/tmp/rhythm-autoname-title-contract-20261020/test-first-contract.md`; no retry/fallback policy or production edit follows yet. This is scoped local packaged behavior, not mobile or hosted qualification. The hidden title agent's separate served model is unobserved. The full 78-marker inventory remains incomplete; no release, install, PR or merge follows from this case.
