---
date: 2026-10-20
repo: Rhythm / Hermes embedded source fixture
branch: test/feature-playwright-2026-10-19 + isolated Hermes source
pr: null
issues: []
status: unverified
tags: [run, rhythm, hermes, provider-catalog]
---

# Hermes direct OpenAI GPT-6 Luna catalog and label

### 2026-10-20 — hermes-openai-luna

- Files modified: `/private/tmp/rhythm-hermes-timeout-source/hermes_cli/models.py` adds GPT-6 Luna to the direct OpenAI curated list after the prior first entry, preserving the existing preferred default and authoritative live-list intersection; `hermes_cli/providers.py` maps `openai-api` to its existing canonical `OpenAI API` label.
- Checks run: Initial guarded RED was 2 failed/4 passed. A first post-change run was 41 passed/1 failed because the test’s dynamically chosen first catalog item became Luna, invalidating its “Luna absent” fixture. Luna was placed after the existing first model without changing that test. Final guarded focused set passed **42/42**, zero skips/flaky/errors.
- Command: `python3 /private/tmp/rhythm-feature-playwright-2026-10-19/tools/build/guard.py --repo /private/tmp/rhythm-feature-playwright-2026-10-19 -- /bin/zsh -f -c 'cd /private/tmp/rhythm-hermes-timeout-source && scripts/run_tests.sh tests/hermes_cli/test_openai_gpt6_luna_contract.py tests/hermes_cli/test_openai_picker_curated.py tests/hermes_cli/test_openai_discovery_endpoint.py tests/hermes_cli/test_openai_listing_authority.py tests/hermes_cli/test_runtime_transport_precedence.py tests/hermes_cli/test_model_switch_openai_api_mode.py tests/hermes_cli/test_provider_catalog.py'`
- Decisions made: Kept live official `/v1/models` account intersection, absent-model rejection, junk filtering, Responses routing and zero-curated-intersection fallback unchanged. The contract test was not edited after its RED hash was reviewed. Initial new-model placement at index zero changed the test’s fixture input; the final placement preserves the prior first/default entry.
- Deviations from spec: none.
- Concerns: This is source/unit evidence only. Rhythm’s GitNexus index contains no Hermes source model, so impact on shared Hermes CLI/TUI/Desktop consumers remains UNKNOWN; the parent accepted the manual HIGH operational blast. No packaged artifact, app rebuild, real-provider call or native confirmation was run; parent owns those gates.

## Parent artifact preparation

The source change is committed in the task-owned Hermes checkout as `2ad39a4cdb2c3c986219f8ca828fef8060e76273`; it has not been pushed. The new desktop artifact at `/private/tmp/rhythm-hermes-desktop-2ad39a4cd` verifies 404 files with clean source, exact Electron 40.10.2, and the unchanged reviewed host hash. The backend at `/private/tmp/rhythm-hermes-backend-73-2ad39a4cd` verifies 19,387 files, 53 native entries and 73 distributions/licenses with Python 3.12.13. An isolated bundled backend health/history probe returned HTTP 200/200 with one owned history row and removed its fixture afterward. The shipping-style app is still the older 5dff bundle; no new native confirmation is claimed.

Rhythm's source pin now selects the clean 2ad source. The initial artifact test command reported **13 passed / 4 failed** because the backend's positive test fixture hardcoded the prior 235 source revision. The negative integrity tests could also fail for that unrelated mismatch. Only that fixture now imports the actual source pin; an additional explicit wrong-revision rejection test first validates the intact fixture and then changes only its revision. No production integrity check was relaxed.

`npm run build:guard -- node --test apps/electron/test/hermes-desktop-artifact.test.mjs apps/electron/test/hermes-backend-artifact.test.mjs` then passed **18/18**, zero skips/failures, exit 0. Original failure log: `/private/tmp/rhythm-hermes-luna-artifact-contracts-20261020.log`; confirmation: `/private/tmp/rhythm-hermes-luna-artifact-contracts-confirm-20261020.log`. GitNexus could not resolve the new backend test fixture in its 320-commit-stale index; manual blast is this test file's six fixture callers plus the new revision case. Full local app build and the normal key/catalog/model selection/chat Playwright probe remain pending.
