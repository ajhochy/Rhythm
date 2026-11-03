---
date: 2026-10-19
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1598]
status: calibration-verified
tags: [run, rhythm, model-router, playwright]
index: "[[Rhythm]]"
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
- Full decision suite: `cd apps/api_server && ./node_modules/.bin/vitest run src/services/decision --no-file-parallelism` → exit 0, **40 files / 649 tests passed**, 48.15s.
- `npm run build:guard -- ai-workflow checks --level pr` completed with exit 1, **15/22 check batches passed**, peak 2,550,277,666 bytes. The new sandbox test needed an explicit response-view type because this project's fetch JSON type is `unknown`; corrected that test-only typing and reran `npm run build:guard -- ai-workflow checks --level issue` → exit 0. API build will also rerun through the local packager.
- Other broad-gate failures: three #1186 foreground-fixture assertions under the guard's Documents TMPDIR; rerunning that unchanged test with `TMPDIR=/private/tmp` → **7/7 passed** (18.46s). Mobile eslint/Jest/Playwright and three desktop unit files lacked mobile dependencies. The existing mobile dependency store has byte-identical package/lock files and was linked into this worktree; no install/ci in any symlinked checkout. All six official mobile check commands plus desktop web unit tests then passed under the build guard (`/private/tmp/rhythm-calibration-frontend-recheck.log`, exit 0). No calibration change was made to accommodate these environment failures.
- The broad Electron suite regenerated a tracked screenshot in this worktree; restored it to the checkpoint. The original checkout's unrelated dirty screenshot remains preserved.
- Red/green strength check: temporarily restored only the original default JSON, ran the seven-case calibration regression → exit 1 / three failed, then restored the candidate in `finally` and reran → exit 0 / seven passed. Source JSON was byte-restored before packaging. Logs: `/private/tmp/rhythm-calibration-revert-red.log`, `-restored-green.log`.

### Updated local build and runtime

- Built source **`d7fb554735f93c0d0a76785cbadd583d0f866610`**, consisting of mega base plus the calibration/test commits. Product change is the single default boundary. `node /private/tmp/rhythm-feature-build-launcher.mjs` → exit 0 under the packager's built-in 10 GiB guard. Inputs match the earlier feature-run record: local version 0.18.83, exact-validated pinned native companions, public desktop client ID, `npm_config_ignore_scripts=true`. No GitHub build, install, upload or notarization.
- Bundle: `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app`. Embedded API identity and bundled/live engine both match the full built revision; embedded thresholds are `[0.1,1.5,2.25]`. Restored executable bits on four generated `spawn-helper` files before signing. `RHYTHM_SIGN_ONLY=1 APPLE_TEAM_ID=56Q69NYP9H APPLE_SIGNING_IDENTITY=CF6C1EF1525E70E6E3324388A322938977779DB7 npm run build:guard -- node apps/electron/scripts/sign-and-notarize-mac.mjs` → exit 0; separate `codesign --verify --deep --strict` → exit 0. Gatekeeper's unnotarized Developer ID result is expected for sign-only and does not qualify distribution. Optional native Dayflow host layout remains absent, as in the prior build.
- Sandbox: generated fresh synthetic read-only sources using `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-calibration-fixtures-20261019`. Fixture DB/config never came from real app data. The first wrapper incorrectly guarded only `up`, so guard completion terminated its background API; the live test correctly failed ECONNREFUSED. Corrected the **private orchestration wrapper**, guarding the entire up/status/test/down lifecycle instead. `npm run build:guard -- bash /private/tmp/rhythm-calibration-sandbox-check.sh` → exit 0, **one live HTTP test passed** (205ms). It reused the newly rebuilt fork from this exact source via `RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1`, verified API/engine readiness on 4098/4097, checked real default-policy serialization and score mapping, and tore down owned API/engine/gateway. Sanitized diagnostics: `/private/tmp/rhythm-calibration-sandbox-20261019.evidence.iS5Ohj`.
- Packaged Playwright command (cwd `apps/web`):

```sh
RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app \
RHYTHM_FEATURE_EXPECTED_REVISION=d7fb554735f93c0d0a76785cbadd583d0f866610 \
RHYTHM_FEATURE_MODEL=1 PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/rhythm-calibration-playwright.json \
./node_modules/.bin/playwright test -c tests/packaged/packaged-playwright.config.ts \
  packaged-model-router.spec.ts --reporter=line,json
```

- Result: **exit 1, 16 passed / one failed, zero skipped/flaky, 2.4m**. All 12 difficulty expectations passed. The real literal-edit turn's classification/model/response/reload assertions passed, but its strict log audit failed on background SyncOrchestrator Google Calendar/Gmail/Planning Center OAuth server-configuration errors. This is the same unsuppressed configuration failure already recorded in `2026-10-19-feature-playwright.md`; no integration setting, credential or error allowlist was changed to hide it. Raw private report/log are `/private/tmp/rhythm-calibration-playwright.json` and `.log`.
- Real decision receipts: 1385 formatting tier 4 → 4 / Haiku; 1388 arithmetic tier 3 → 3 / Haiku; **1390 literal edit tier 3 → 3 / Haiku**, all `classifierSource:decisions, applied:true, accountId:personal, accountSource:router`. Thus the edited task is no longer promoted to tier 2/Sol in the running new app.
- An isolated rerun of the original inline-edit UI fixture failed on its response assertion: the repository-oriented coding profile tried unavailable `grep`/`glob` tools, searched an empty owned cwd and reported no file to edit. This was a **test-fixture ambiguity**, not evidence the tier mapping remained wrong. Clarified only the UI request to say this is an inline question, return the updated function and use no tools. The original 0.85 classifier regression prompt and its cheap-tier expectation remain unchanged. A separate live probe of the clarified UI input returned score 0.92: old defaults would still make it tier 2, new defaults make it tier 3. Thus the UI case still detects the calibration regression. No application prompt, profile, tools or permission setting changed.
- **Final complete 17-case rerun → exit 0, 17 passed, zero failed/skipped/flaky, 1.2m.** Same command/source pin as above, report `/private/tmp/rhythm-calibration-playwright-final.json`, matching `.log`. All original/classifier difficulty cases, the clarified real inline edit, persistence/reload, account/model application, follow-up reuse, pinned-model bypass and final per-test error audits passed. The compiled product is still source `d7fb554735f93c0d0a76785cbadd583d0f866610`; the later edit is test-only and is not part of the shipped renderer/API. Earlier OAuth log and fixture failures remain recorded; the local integration server configuration was not repaired or suppressed.
- Final literal-edit receipt **1400** confirms Decisions → tier 3 → applied tier 3 / Haiku / Personal. Independent read-only cleanup checks found zero router smoke sessions and projects. All six packaged/sandbox runtime ports (4001/4096/4002 and 4098/4097/4099) refuse connections after shutdown. Twenty-one generated tracked mobile proof images were restored; the original checkout's three unrelated dirty/untracked paths remain preserved.
- The aggregate PR command was not rerun after the type-only/harness repairs. Scoped reruns cover its failed check types, but there is no clean one-shot full-PR-gate receipt and no overall mega qualification claim. Generated tracked proof screenshots were restored; private traces, app binaries and credentials are excluded from commits.

## Notes

- The old boundary deliberately came from a 50-prompt calibration in the 2026-10-08 plan. The user now explicitly authorizes correcting the simple-edit over-routing observed in live qualification. A score of 1 represents the routine/single-file level and 2 the multi-file level; 1.5 separates those levels without touching the existing easy/frontier cutoffs. The synthetic regression set is not a held-out production-quality benchmark.
- GitNexus reports LOW / zero indexed callers for `gridTierFromScore`, `defaultRouterGridConfig` and `classifyRouterGrid`, but warns its index is 252 commits stale. Manual source review identifies the Grid turn classifier (including free-mode classification) and default-policy/UI consumers. No API/schema/auth/account symbols change. The new packaged helper is unindexed (UNKNOWN). Existing explicit override files remain authoritative; current real profile has no grid override file. Existing sessions retain their first-prompt decision.
- Work remains on the existing branch based on mega `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. The rebuilt artifact must identify this candidate's committed source revision, not the old mega SHA. Original checkout, installed app, router/account settings and unrelated dirty files are preserved. No push, PR, merge or GitHub build.
