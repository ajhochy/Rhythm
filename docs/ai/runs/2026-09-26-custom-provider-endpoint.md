---
date: 2026-09-26
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [task-custom-provider-endpoint]
status: ready-for-verification
tags: [run, Rhythm]
---

# Native OpenCode custom-provider MVP

## Files

- Acceptance contract: `docs/ai/contracts/task-custom-provider-endpoint.json`
- API contract: `apps/api_server/src/__tests__/custom_provider_routes.test.ts`
- Live gate: `apps/api_server/src/__tests__/custom_provider_live_e2e.test.ts`
- UI contract extends `apps/web/tests/contract/issue-1580-model-curation.spec.ts`

## Checks

### Phase 0 RED

Command:

```sh
cd apps/api_server && npx vitest run src/__tests__/custom_provider_routes.test.ts
```

Result: expected RED — 1 file failed; 26 contract cases failed and 1 hosted-surface case passed. Representative failures: `POST /opencode/providers/test` returned 404 instead of 200 and `PUT /opencode/providers` returned the deliberate 501 placeholder instead of 200. This proves the contract is connected to the missing behavior rather than passing before implementation.

Command:

```sh
cd apps/web && RHYTHM_ISSUE_1580_CONTRACT=1 npm exec -- playwright test --config tests/contract/issue-1580-playwright.config.ts --grep "custom-provider"
```

Result: expected RED — 3/3 custom-provider browser cases failed because `custom-provider-disclosure` does not exist. The earlier filtered invocation ran before the test append was corrected and returned `No tests found`; it is not counted as a contract receipt.

### Passing focused checks

- `cd apps/api_server && npx vitest run src/__tests__/custom_provider_routes.test.ts` — **30 passed**.
- `cd apps/api_server && npx vitest run src/__tests__/custom_provider_routes.test.ts src/__tests__/opencode_auth_routes.test.ts src/__tests__/agents_models_catalog.test.ts src/__tests__/system_refresh_routes.test.ts` — **4 files, 81 passed**.
- `cd apps/api_server && npx tsc --noEmit` — pass.
- `cd apps/api_server && npm run build` — pass.
- `cd apps/web && npm run typecheck` — pass.
- `cd apps/web && npm run build && npm run test:dist-smoke` — pass; Vite built 1,744 modules and dist smoke verified the index plus two relative assets. Existing large-chunk warning only.
- `cd apps/web && RHYTHM_ISSUE_1580_CONTRACT=1 npm exec -- playwright test --config tests/contract/issue-1580-playwright.config.ts` — **19 passed**, including Axe and 390px coverage.
- `git diff --check` — pass.
- `gitnexus_detect_changes(scope=unstaged, worktree=.mega-wt/integration)` — low risk, no affected execution flows; output includes unrelated pre-existing dirty worktree changes.

### Live sandbox gate — BLOCKED

Sandbox lifecycle (only the designated disposable fixture/sandbox and ports):

```sh
RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-ui-attachments-model-search-fixture \
RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-ui-attachments-model-search-fixture/rhythm.db \
RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-ui-attachments-model-search-fixture/opencode.json \
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-custom-provider-sandbox \
RHYTHM_SANDBOX_API_PORT=7398 RHYTHM_SANDBOX_ENGINE_PORT=7397 \
RHYTHM_SANDBOX_GATEWAY_PORT=7399 RHYTHM_OPTIMIZER_MODE=shadow \
tools/dev/sandbox.sh down && tools/dev/sandbox.sh up && tools/dev/sandbox.sh status
```

Observed ready listeners: API `:7398`, engine `:7397`, gateway `:7399`. No process was started by hand and ports 4001/4002/4096 were untouched.

Live command:

```sh
cd apps/api_server && RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:7398 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:7397 \
RHYTHM_SANDBOX_OPENCODE_JSON=/private/tmp/rhythm-custom-provider-sandbox/home/.config/opencode/opencode.json \
npx vitest run src/__tests__/custom_provider_live_e2e.test.ts --no-file-parallelism
```

Final result after two bounded repair attempts: **1 failed**. The real `POST /opencode/providers/test` succeeded against the disposable provider. `PUT /opencode/providers` called native auth and unchanged `reloadConfig()`, but every bounded real-engine snapshot read failed to expose the provider/models; the endpoint returned sanitized `provider_not_observable` and atomically restored the prior config. The required `/agents/models/catalog/full` publication assertion was not reached. This is the remaining blocker; no READY_FOR_VERIFICATION claim is made.

Rollback evidence: sandbox `opencode.json` contains no failed custom provider or synthetic key after each failure. The installed SDK wrapper exposes `auth.set` but no auth remove/delete operation, so failed saves can leave synthetic orphan auth entries in this disposable sandbox auth store. They do not activate a provider without config. This is the approved smallest documented limitation and did not touch live credentials.

## Evidence

- `docs/ai/runs/artifacts/custom-provider-endpoint/test-success.png`
- `docs/ai/runs/artifacts/custom-provider-endpoint/post-save-provider.png`

Both screenshots use only synthetic values; the API key remains password-masked and is absent after save.

## Notes

- AJ explicitly approved this scope and supplied the acceptance criteria and risk analysis.
- GitNexus pre-edit impact: `createApp` MEDIUM, 9 direct test callers, 0 execution flows; the edit is limited to importing/mounting the focused router and deleting the 501 placeholder. `createLiveSessionsGateway` LOW, 1 direct test caller, 0 flows. `ModelCurationPanel` is unindexed/UNKNOWN as disclosed in the approval. `/opencode/providers` API impact is LOW with 0 consumers/flows.
- `reloadConfig()` is HIGH per the approved handoff (6 direct callers/4 flows) and is reused unchanged. `setAuth()` already exists and is reused unchanged, so `OpencodeClientService` requires no edit.
- Root cause of the original product gap: the only custom-provider write route was a deliberate 501 placeholder, while the model-curation renderer had no provider-create gateway or form. The implementation replaces only that placeholder with a local-only focused router and adds the minimum create/test UI.
- Security/rollback properties covered: closed schema; no key response/config/logging path; DNS-pinned HTTPS resolution; local HTTP literals only; metadata/link-local/redirect blocks; 5s/2MiB bounds; strict model shape/dedupe/sort/1000 cap; atomic temp+rename; exact prior-config rollback; unchanged reload; hosted route absence.
- Deferred exactly as approved: custom headers, manual model entry, environment-variable keys, edit/delete, providers without `/models`, remote-host/NAS mutation.
- Existing unrelated mobile, Electron, web model-search, proof, and docs changes are preserved.

## 2026-09-26 resumed B-path triage

AJ explicitly approved the recommended global-config mutation investigation as a fresh repair loop.

Focused probe added to `apps/opencode_fork/packages/opencode/test/server/httpapi-config.test.ts`:

1. Warm `GET /config/providers` for a project instance.
2. `PATCH /global/config` with a synthetic OpenAI-compatible provider/model.
3. Wait for that project's `server.instance.disposed` global-bus event.
4. Re-read `GET /config/providers` and consume the new provider/model.

Exact command and result:

```sh
cd apps/opencode_fork/packages/opencode
bun test test/server/httpapi-config.test.ts
```

```text
4 pass
0 fail
16 expect() calls
Ran 4 tests across 1 file. [5.25s]
```

The probe is GREEN: the engine's global mutation/disposal/publication behavior is sound without process restart. The first run had a test-only import typo (`@/global`) and errored before collecting tests; correcting it to the repository's existing `@opencode-ai/core/global` import produced the result above.

Implementation is nevertheless **BLOCKED before production edits** by the required rollback invariant:

- Installed v2 SDK confirms `global.config.get()`, `global.config.update({config})`, and `auth.remove({providerID})` exist (`vendor/opencode-ai-sdk/v2/gen/sdk.gen.d.ts`). Credential rollback is available.
- `PATCH /global/config` delegates to `Config.updateGlobal` (`apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts:88-91`).
- `Config.updateGlobal` applies `mergeDeep(existing, patch)` and writes the result (`apps/opencode_fork/packages/opencode/src/config/config.ts:804-826`).
- The `provider` schema is `Schema.Record(String, ConfigProvider.Info)` with no null/delete tombstone (`config.ts:206-208`). The API has GET/PATCH only; there is no config replace or provider-remove route.
- Therefore a create-only provider absent from the prior config cannot be removed by PATCH during auth/publication rollback. Sending the prior provider map simply retains the newly merged key. Claiming atomic restoration would be false.

Per AJ's requirement, no global-config B-path production edit was made and the existing HIGH-risk `reloadConfig()` body remains untouched. A manager-approved engine/API design for provider removal or full validated global-config replacement is required before this repair can continue.

## 2026-09-26 approved minimal commit-point resolution

Manager revised the rollback acceptance and approved one focused implementation attempt. The custom-provider path now uses the native v2 engine seams:

1. Re-test `GET <base>/models` with all existing endpoint/size/timeout/schema protections.
2. Read global config for create-only collision detection.
3. Store the optional credential with `auth.set`.
4. Commit the provider with typed `global.config.update` (`PATCH /global/config`). OpenCode validates the schema, atomically writes its global config, invalidates provider config, and disposes instances.
5. Poll the real provider snapshot. Return 200 only when every discovered model is observable; otherwise return honest HTTP 202 pending after the successful commit.

Failure boundaries:

- `auth.set` failure: no config mutation.
- Global config update failure: call v2 `auth.remove` for the just-created credential; no provider config is persisted.
- Successful global update is the commit point. Publication delay is not rolled back; UI clears the form/key, does not claim Connected, and offers **Refresh models**.
- Direct JSON/temp/rename writes and custom-path `reloadConfig()` calls were removed. The existing HIGH-impact `reloadConfig()` implementation remains byte-for-byte untouched.

### Final checks

- Fork probe: `cd apps/opencode_fork/packages/opencode && bun test test/server/httpapi-config.test.ts` — **4 passed, 0 failed, 16 assertions**.
- API RED before implementation: updated contract had **3 expected failures / 29 pass** (global mutation, auth cleanup, pending response).
- UI RED before implementation: pending contract failed because the old UI claimed `Provider saved · 2 models available` and had no Refresh action.
- API focused contract/typecheck: `npx vitest run src/__tests__/custom_provider_routes.test.ts && npx tsc --noEmit` — **32 passed**, typecheck pass.
- API adjacent suite/build: custom provider + auth + model catalog + system refresh — **4 files, 83 passed**; `npm run build` pass.
- Web pending contract/typecheck — **1 passed**; typecheck pass.
- Full Model Curation Playwright — **20 passed**, including Axe, narrow viewport, success screenshots, pending secret clearing, no connected claim, and Refresh models.
- Web build/dist smoke — 1,744 modules built; index and two relative assets verified. Existing chunk-size warning only.
- Sandbox rebuilt and cycled only with `tools/dev/sandbox.sh` using fixture `/private/tmp/rhythm-ui-attachments-model-search-fixture`, sandbox `/private/tmp/rhythm-custom-provider-sandbox`, API7398/engine7397/gateway7399.

Final live command:

```sh
cd apps/api_server
node -e "fetch('http://127.0.0.1:7397/global/health').then(r=>r.json()).then(x=>console.log('BOOT_BEFORE='+x.bootId))" && \
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:7398 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:7397 \
RHYTHM_SANDBOX_OPENCODE_JSON=/private/tmp/rhythm-custom-provider-sandbox/home/.config/opencode/opencode.json \
npx vitest run src/__tests__/custom_provider_live_e2e.test.ts --no-file-parallelism && \
node -e "fetch('http://127.0.0.1:7397/global/health').then(r=>r.json()).then(x=>console.log('BOOT_AFTER='+x.bootId))"
```

Observed:

```text
BOOT_BEFORE=b4680308-4059-4c22-909a-69638e719f51
1 test passed
BOOT_AFTER=b4680308-4059-4c22-909a-69638e719f51
```

The live test proved POST test → PUT 200 → provider and both models in `/agents/models/catalog/full`; sandbox `opencode.json` contains the provider and no synthetic API key; a pre-existing catalog entry remained consumable; engine boot identity did not change. The first live invocation also completed all behavioral assertions but produced one test-harness-only unhandled assertion when the engine itself queried `/models` without the API probe's Authorization header. The fake provider now records all requests and asserts the two API probe requests carry the synthetic Bearer key while permitting the engine's independent discovery request; subsequent live runs passed cleanly.

## 2026-09-26 UI review repairs

Backend/security behavior was intentionally unchanged. The Model Curation UI now separates committed save truth from post-save catalog refresh:

- Retains the committed provider ID/model count across cleared form state.
- `Refresh models` has busy/disabled state and refreshes both `/agents/models/catalog/full` and the shared picker catalog.
- Resolves pending state only after the provider's expected model count appears, expands that provider, and removes the retry control. Absence retains pending truth; refresh failure keeps saved/pending truth with a retryable message.
- A PUT 200 is never changed into “provider could not be saved” by either refresh failure. It reports `Provider saved, but models could not be refreshed.` and retries both sources.
- Test-connection results are fingerprint-fenced against in-flight edits. All four fields are disabled during save.
- Refresh/disclosure targets are 44px; provider-local search remains compact on desktop and reaches 44px at narrow/coarse-pointer breakpoints.
- `refreshModels()` now returns a success boolean while preserving its existing swallowed-error/catalog-error behavior; existing callers may continue ignoring the result.

Acceptance RED before implementation:

```text
8 UI review tests: 7 failed, 1 passed
```

The failures covered false saved-refresh success, unresolved 202 state, missing retry failure messaging, stale test publication, editable save fields, and 36px touch targets.

Final checks:

- Full #1580 Playwright: **28 passed** (the prior 20 plus 8 UI-review regressions).
- Web typecheck: pass.
- Web production build: pass, 1,744 modules; existing large-chunk warning only.
- Dist smoke: pass, index plus two relative assets verified.
- Unchanged backend focused contract: **32 passed**.
- Updated screenshot: `docs/ai/runs/artifacts/custom-provider-endpoint/pending-refresh.png`.

## 2026-09-26 deterministic GlobalBus test repair

Failure triage identified a race between `Effect.forkScoped` scheduling the waiter and the PATCH emitting `server.instance.disposed`. The test helper now optionally completes an Effect `Deferred<void>` immediately after `GlobalBus.on` installs the real handler. The custom-provider probe creates the Deferred, forks the unchanged real-event waiter, awaits subscription readiness, and only then sends PATCH. The disposal-event and provider/model publication assertions remain intact; no sleeps, timeout changes, or assertion removals were added.

Canonical acceptance contract remains unchanged at **20 criteria**.

Repeated focused command:

```sh
for i in {1..10}; do
  bun test test/server/httpapi-config.test.ts \
    -t "global config provider updates invalidate a warm provider instance without restarting the process" || exit 1
done
```

Result: **10/10 repetitions passed**. Every repetition reported `1 pass`, `3 filtered out`, `0 fail`, and `5 expect() calls`; durations ranged from 1.354s to 1.53s.

Full focused file:

```sh
bun test test/server/httpapi-config.test.ts
```

Result: **4 passed, 0 failed, 16 assertions** in 2.12s.

Package typecheck is supported (`typecheck: tsgo --noEmit`):

```sh
bun run typecheck
```

Result: pass with no diagnostics. No product, API, UI, package, or live-service operation was performed.
- No commit, push, package, or live service operation is authorized.
