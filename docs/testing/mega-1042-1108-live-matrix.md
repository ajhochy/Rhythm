# Mega 1042–1108 live verification command map (#1424)

This map inventories evidence entry points; it is not a claim that any row has
passed. Use only synthetic fixtures and an isolated sandbox. Never paste
credentials, transcript content, usernames, or host paths into a receipt.

## Shared sandbox envelope

Choose three unused ports and use the same values for `up`, every test, `status`,
and `down`:

```bash
export RHYTHM_APPROVED_FIXTURE_ROOT=<approved-synthetic-fixture-root>
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/opencode-config"
export RHYTHM_SANDBOX_DIR=<private-temporary-sandbox-dir>
export RHYTHM_SANDBOX_API_PORT=<api-port>
export RHYTHM_SANDBOX_ENGINE_PORT=<engine-port>
export RHYTHM_SANDBOX_GATEWAY_PORT=<gateway-port>
export RHYTHM_LIVE_URL="http://127.0.0.1:$RHYTHM_SANDBOX_API_PORT"
export RHYTHM_ENGINE_URL="http://127.0.0.1:$RHYTHM_SANDBOX_ENGINE_PORT"
export RHYTHM_LIVE_ENGINE_URL="$RHYTHM_ENGINE_URL"
export RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 DB_CLIENT=sqlite
tools/dev/sandbox.sh up
tools/dev/sandbox.sh status
# Run only the row commands selected below.
tools/dev/sandbox.sh down
```

Run Vitest commands from `apps/api_server`. Tests that need a real provider are
manual-only until an operator supplies a test account outside the receipt.

## Ten-row map

| # | #1424 row | Existing command or disposition |
|---|---|---|
| 1 | Permissions and questions | `npx vitest run src/__tests__/live_e2e_1073_permission_roundtrip.test.ts --no-file-parallelism` covers the real permission round trip. **Needs new live test** for custom/multi-select answers and API/desktop reattach. Once/Always/Deny and audible/UI behavior remain **manual only** because they require the shipping desktop and a real turn. |
| 2 | Turn lifecycle | **Needs new live test:** no env-gated suite proves ordered send-while-busy plus custom/multi-select answers against the engine. Final queue rendering is **manual only** in the shipping desktop. |
| 3 | Delete and worktrees | `npx vitest run src/__tests__/live_e2e_1048_engine_session_delete.test.ts src/__tests__/live_e2e_1057_worktree.test.ts --no-file-parallelism`, with `RHYTHM_LIVE_CWD=<disposable-repository>`. The local-row-on-engine-failure and optional-worktree confirmation remain **manual only** until a failure-path live test exists. |
| 4 | Websearch and commands | **Needs new live tests** for command reload and child/progress navigation. Real-provider websearch is **manual only** because it requires provider credentials and a no-key-leak review. |
| 5 | Files and VCS | **Needs new live test:** `issue_1060_file_find_proxy.test.ts` and `issue_1063_1066_vcs_shell_init.test.ts` are unit coverage only; no env-gated test proves search/read/attach, branch/dirty state, both diff forms, shell, and initialization against a disposable repository. |
| 6 | Event recovery | `npx vitest run src/__tests__/live_e2e_1070_global_sse.test.ts --no-file-parallelism` covers global event delivery. Cross-reference #1325: `npx vitest run src/__tests__/issue_1325_live_e2e.test.ts --no-file-parallelism` covers engine/bridge recovery, but currently asserts the legacy `4098`/`4097` ports and must be made port-configurable before use in a different port block. Repeated credential bounce and desktop persistence remain **manual only**. |
| 7 | Managed config | **Needs new live test** for title/small-model selection, org marker, and telemetry/transcript alignment. Real model selection is **manual only** because it requires a provider account. |
| 8 | Hidden scheduled specialist | Cross-reference #1088: `npx vitest run src/__tests__/live_e2e_1088_hidden_schedulable.test.ts --no-file-parallelism`. Existing-binding migration and shipping-client inspection remain **manual only**. |
| 9 | Image generation | Cross-reference #1094: `npx vitest run src/__tests__/live_e2e_1094_image_generation_grant.test.ts --no-file-parallelism` covers the reduced-scope Rhythm grant. Real generation, iterative reference editing, rendering, and refresh are **manual only** with a provider-enabled account. |
| 10 | Fallback and semantic memory | `RHYTHM_LIVE_ENGRAPH_BIN=<approved-engraph-binary> npx vitest run src/__tests__/live_e2e_1096_engraph_manager_http.test.ts --no-file-parallelism` covers manager HTTP behavior. **Needs new live test** for two-prompt fallback persistence. Notarized clean-user Engraph start/query/stop/fallback is **manual only** because it requires an installed signed build and clean macOS user. |

## Receipt template (copy once per row)

```text
Matrix row:
App/build version:
Commit SHA:
Command or manual steps:
Observed output:
Artifact/run-log path (sanitized logical reference only):
Result: PASS | FAIL | UNVERIFIED
```

Replace any local path in command output with a neutral label before attaching
the receipt. Record skipped sub-scenarios as `UNVERIFIED` rather than treating a
partially covered row as passed.
