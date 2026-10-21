---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, Rhythm]
---

## Files

- `apps/api_server/src/services/opencode_client_service.ts`: finish auth restoration and seed a healthy default OpenAI account before publishing engine readiness; block public provider reads during initialization and discard late reads from a replaced engine.
- `apps/api_server/src/services/openai_accounts_service.ts`: seed through the existing SDK writer before readiness, retain ordinary no-rewrite switching, fail startup when a healthy default cannot be written, and bind qualification accounts to their exact private fixture path.
- `apps/api_server/src/services/decision/model_catalog.ts`: bind cached live catalogs to the monotonic engine generation; do not cache static fallback or a snapshot begun while unready.
- Focused tests, `tools/dev/sandbox.sh` opt-in inert synthetic account fixture, shell guard tests, and an env-gated real API/fork first-boot catalog test.

## Checks

- RED: guarded focused account/catalog tests had 4 expected failures: missing pre-ready seed and static fallback retained after readiness, including a delayed unready read. Existing 45 assertions passed.
- GREEN: guarded account/catalog tests 53/53; broader decision routing tests 137/137 after its fake engine supplied the real readiness/generation contract. The initial broader run had one deterministic mock-contract failure (136/137) and was corrected without changing its warm-cache assertion.
- RED: existing sandbox guard tests 21 passed with 3 new expected failures: invalid flag accepted, missing inert seed helper, and auth-bearing fixture accepted.
- GREEN: guarded `bash tools/dev/sandbox_guard_test.sh` 24/24; `bash -n` for both shell files and `git diff --check` passed.
- Guarded API `tsc --noEmit -p apps/api_server/tsconfig.json` passed. The new live test is discovered and skipped by default; actual first-boot API/fork execution is pending a coordinated isolated sandbox build.

## Notes

- Private E first boot previously had an OpenAI account and auth entry but only an unauthorized blank model placeholder. Relaunch of the unchanged private fixture E2 restored 30 authorized OpenAI rows. A separate fork-model allowlist repair is recorded in `2026-10-20-codex-oauth-grid-model-catalog.md`.
- The sandbox opt-in writes only a fixed synthetic literal account inside its newly owned HOME, with an empty refresh token and year-2100 expiry; it rejects fixture `auth.json` so the live test exercises account seeding rather than auth restoration. No real credential, refresh, inference, operator profile, or native app was used for these focused checks.
- GitNexus could not resolve the relevant shell or new startup symbol against an index more than 300 commits stale. Manual blast radius is HIGH: engine readiness and model catalog affect all first-launch agent model reads. The parent agent announced that scope before source edits.
- Behavioral completion remains open until a fresh sandbox run confirms the first HTTP catalog and Grid projection against the actual rebuilt fork and API. Packaged native confirmation is separate.
