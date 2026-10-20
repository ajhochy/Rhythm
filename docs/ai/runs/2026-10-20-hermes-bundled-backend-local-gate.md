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

## Native provider extras follow-up

- Pinned Hermes source `23589566471dbd2068a0387c85a2cb85d4a7d737` repairs two provider setup paths: a bundled Azure SDK no longer counts as an authenticated Entra account without a token probe, and backend-tagged Bedrock/Vertex settings without an API-key field render in the desktop Keys view. The Azure no-credential assertion and rendered Keys test failed before their production fixes, then passed; focused Python Azure/catalog tests: 12 passed; desktop Keys tests: 8 passed; desktop typecheck passed.
- The frozen lock's four native inference extras (`anthropic`, `bedrock`, `vertex`, `azure-identity`) add exactly 13 distributions to the prior 60 external distributions. A guarded `uv sync --frozen --no-dev` installed those 13 under the owned private Hermes source and cache, without removals; `snapshotQualificationHermesRuntime` reported 74 packages including editable Hermes. The builder and verifier now require 73 external distributions, with the source pin updated to the exact commit.
- Guarded new backend artifact `/private/tmp/rhythm-hermes-backend-73-235895664` contains 19,384 verified entries, 53 native entries, 73 lock-matched external distributions with license files, and Python 3.12.13. Its size is 365,976 KiB, versus 331,244 KiB for the preserved prior candidate. The separately built factory `/private/tmp/rhythm-hermes-desktop-235895664` contains 404 verified entries for Electron 40.10.2. Both validators accepted the same source pin. Clean-environment bundled `--version` and imports for Anthropic, boto3/botocore, Google auth/pyasn1, and Azure identity passed.
- A new private port-0 component gate returned `/api/status` 200 and `/api/sessions` 200 with one disposable `[smoke]` history row; full backend integrity was unchanged after shutdown (`/private/tmp/rhythm-hermes-bundled-gate-73.mjs`). The exact 73-distribution validator test was red against the old 60-distribution policy, then 5/5 green. Full Electron suite: 587 passed, 0 failed, 5 skipped; Electron typecheck passed (`/private/tmp/rhythm-electron-full-hermes-235895664.log`).
- A signed local app containing these new artifacts, native provider setup rendering, and a real-model request remain unverified. The previous signed app's 38 selected companion cases produced 37 passes and one explicit unverified one-hour TTL requirement; the ten companion cases passed. The original intermittent 15-second IPC timeout remains unproven. No account credentials or normal operator profile were used for these extras checks.
- Frozen-lock `uv sync --frozen --no-dev --extra anthropic --extra bedrock --extra vertex --extra azure-identity --python-platform x86_64-apple-darwin --offline --dry-run` showed the Intel macOS closure omits the arm64-only `nemo-relay` distribution. The local producer and verifier now enforce an exact architecture map: arm64 73 external distributions (74 staged with editable Hermes), x64 72 (73 staged), and unknown architectures rejected. The validator's Intel count test failed before the change and all 6 focused artifact tests passed afterward. This dry run is source/producer evidence, not an Intel runtime test.
- The separate private Keys Playwright case is discovered by the packaged config (one case) and `apps/web` typecheck passed. It awaits the next signed local app; it checks real backend setup fields and all four provider cards without saving credentials or invoking a model.
