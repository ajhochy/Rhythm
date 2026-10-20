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

- `apps/electron/src/hermes-backend-artifact.mjs`: separate complete-file verifier for the bundled Python backend.
- `apps/electron/scripts/build-hermes-backend.mjs`, `package-mac.mjs`, `sign-and-notarize-mac.mjs`: pinned source/archive, frozen dependency and license check, package staging, and post-native-signing integrity refresh.
- `apps/electron/src/main.mjs`, `qualification-hermes-runtime.mjs`, `tools/testing/qualification_fixture.mjs`, `qualification_hermes_history.mjs`, `run_packaged_ai.mjs`: common bundled backend selection for ordinary and private Hermes, with private HOME/HERMES_HOME and synthetic history.
- `apps/electron/test/hermes-backend-artifact.test.mjs` and focused actor/fixture tests.

## Checks

- RED: the new backend artifact test failed with `ERR_MODULE_NOT_FOUND` before the validator existed. GREEN: 45 focused Electron tests pass, and `npm run typecheck` passes.
- Full Electron source suite: 587 passed, 0 failed, 5 skipped (592 total). The bundled private fixture test: 2 passed, 0 failed, 1 legacy staged-runtime skip.
- Under the shared 10 GiB build guard, the repeatable builder produced `/private/tmp/rhythm-hermes-backend-relocated-789923c` from clean pinned Hermes revision `789923c8707d34c7c6291ca9dcfc05e2b5370445`: 16,242 inventoried entries, 53 Mach-O files, 60 lock-matched external distributions with license text, Python 3.12.13. The payload validates after relocation.
- Clean-environment private `hermes --version` and port-0 `serve` passed. `/api/status` returned 200; authenticated `/api/sessions` returned 200 with one disposable two-message `[smoke]` history row. The complete payload verified unchanged after shutdown. Local component gate script: `/private/tmp/rhythm-hermes-bundled-gate.mjs`.

## Notes

- This is local component and source evidence. A signed Rhythm app still needs native launch/signature proof with the separate `Resources/hermes-backend` resource; the original intermittent 15-second retained-Hermes IPC timeout has not been reproduced or claimed fixed.
- The release workflow does not yet provision the pinned Python payload. Its new required package input will fail release packaging until that producer is added and verified. No upstream Hermes push, installed-app change, operator-profile write, credential read, or production request occurred.
