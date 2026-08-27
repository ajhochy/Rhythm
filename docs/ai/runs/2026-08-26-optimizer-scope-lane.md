---
date: 2026-08-26
repo: Rhythm
branch: fix/optimizer-scope-lane
pr: pending
issues: [1479, 1482, 1488]
status: verified
tags: [run, Rhythm]
---

# Optimizer scope-lane correctness

## Files

- Added live MCP tool-catalog validation for profile writes, proposal applies, audit drift, and read-only reporting.
- Added a fork `/mcp/tools` endpoint backed by the connected servers' real `MCP.tools()` catalog.
- Unified audit activity and successful-use evidence around the same owned session IDs, with legacy `agent_kind` fallback.
- Made profile requirement matching case-insensitive, alias-aware, skill-aware, and explicit-tools-map-aware.
- Added acceptance contracts and tests for #1479 and #1482.
- Added one serial env-gated live suite for real engine catalog, API write/apply
  rejection, operator drift reporting, optimizer false-positive controls, and
  exact scope count/SHA-256 non-mutation evidence.
- Added the read-only `rhythm mcp-tool-grant-drift` operator command. It requires
  an explicit SQLite `DB_PATH` and loopback fork URL, opens the DB read-only,
  emits only `{profileId, serverName, toolName}`, and exits nonzero on validation
  failure.
- Repaired `GET /opencode/mcp` tool grouping to consume the MCP-only `/mcp/tools`
  catalog instead of the built-in/plugin tool catalog.

## Checks

- RED #1479: `cd apps/api_server && npx vitest run src/__tests__/issue_1479_contract.test.ts` — 3/3 failed on missing PATCH/apply validation, tool drift, and report pass.
- GREEN #1479: same command — 3/3 passed.
- #1479 regressions: `npx vitest run src/services/__tests__/org_audit_service.test.ts src/services/__tests__/org_proposal_appliers_wiring.test.ts src/__tests__/agent_configs_routes.test.ts` — 80/80 passed.
- RED #1482: `npx vitest run src/__tests__/issue_1482_contract.test.ts` — 3/3 failed on agentKind attribution, prompt aliases, and skills/tools-map intent.
- GREEN #1482 + regressions: `npx vitest run src/__tests__/issue_1482_contract.test.ts src/services/__tests__/org_exercised_tools_resolver.test.ts src/__tests__/scope_hygiene_generator.test.ts src/services/__tests__/org_audit_service.test.ts` — 72/72 passed.
- Combined: `npx vitest run src/__tests__/issue_1479_contract.test.ts src/__tests__/issue_1482_contract.test.ts src/__tests__/org_optimizer_scope_false_positives.test.ts` — 21/21 passed.
- `cd apps/api_server && npx tsc --noEmit` — exit 0.
- Fork monorepo `bun run typecheck` could not complete because the existing linked dependency tree lacks `@tsconfig/node22`; package-only typecheck likewise reports broad pre-existing missing workspace dependencies. No sandbox/build was run.
- GitNexus impact: initial file fallbacks for #1479 were LOW (0 direct/processes). Later symbol calls and both detect-changes gates were unavailable because another process was rebuilding an incompatible LadybugDB index; no HIGH/CRITICAL result was returned.

### Coverage/completeness repair

- RED parser/CLI: `npx vitest run src/__tests__/scope_hygiene_generator.test.ts src/cli/mcp_tool_grant_drift.test.ts` — parser emitted zero proposals for real `scopeKind=mcp-tool ... serverName=...` evidence; CLI was an unknown command. 3 contract assertions failed.
- GREEN parser/CLI: same command — 10/10 passed. The parser preserves existing mcp/skill behavior and now routes mcp-tool evidence to `allowedMcpsJson`; the CLI report is sanitized/read-only and validation failures are nonzero.
- Exact prior focused commands rerun: 3/3, 80/80, 73/73 (the prior 72 plus the new mcp-tool parser contract), and 21/21 passed. CLI adds 2/2, for 179 passing invocations total (176 prior baseline + 1 parser + 2 CLI).
- Live file with flags absent: 2/2 skipped cleanly.
- Forced live file without isolation: failed closed in `assertLiveE2EIsolation` before either case ran.
- `npm run build && npx tsc --noEmit` — exit 0.
- `git diff --check` — exit 0.
- GitNexus impact and `detect_changes(scope=all)` were attempted again; both remain unavailable with LadybugDB file v42/client storage v41, risk UNKNOWN (not HIGH/CRITICAL).
- At this intermediate stage, the sandbox live command was deliberately **not run** because S2 owned the sole sandbox. The then-pending contract state was superseded by the later product-HEAD live gate recorded below.

### Product wiring repair after live failure

- RED route contract: `npx vitest run src/__tests__/opc_m4_3_mcp_routes.test.ts` — 1 failed, 19 passed; the API returned `tools: []` because it called `listToolIds()` rather than the separately populated MCP catalog.
- GREEN route contract: same command — 20/20 passed; the contract asserts grouped composed IDs and that `listMcpToolIds()` is called while `listToolIds()` is not.
- Exact S3 focused baseline rerun: 3/3, 80/80, 73/73, 21/21, and CLI 2/2 — 179 passing invocations. With the route suite, 199 passing invocations total.
- `npm run build && npx tsc --noEmit` — exit 0.
- Live suite with flags absent — 2/2 skipped cleanly. Forced live suite without isolation — failed closed in `assertLiveE2EIsolation`; no server or sandbox command was run.
- No deterministic fixture was added: this S3 repair is the one-line product wiring defect found by S4's real sandbox run; S4 retains ownership of the sandbox and live rerun.
- GitNexus route/symbol impact was retried before the product edit and remained unavailable with LadybugDB file v42/client storage v41; risk UNKNOWN and no HIGH/CRITICAL result.

### S3 fork test-only typecheck repair

- WAIVED: test-only exhaustive mock typing repair with no production behavior change; verification is the focused fork test plus fork typecheck and a production-source diff against 03dd5e62.
- Dependency proof: `apps/opencode_fork/node_modules` was an absolute symlink to `/Users/ajhochhalter/Documents/Rhythm/apps/opencode_fork/node_modules`. Only that ignored S3-worktree symlink was removed; `cd apps/opencode_fork && bun install --frozen-lockfile` created a worktree-local directory, and tracked manifests/lockfiles remained unchanged.
- Added the exhaustive MCP `tools` test handler with the endpoint's exact `string[]` response typing in `httpapi-mcp-oauth.test.ts`; no production fork source changed.
- `cd apps/opencode_fork/packages/opencode && bun test test/server/httpapi-mcp-oauth.test.ts` — 1/1 passed.
- `cd apps/opencode_fork/packages/opencode && bun run typecheck` — exit 0; all three previously triaged errors are gone.
- `cd apps/api_server && npx vitest run src/__tests__/opc_m4_3_mcp_routes.test.ts src/__tests__/issue_1479_contract.test.ts` — 23/23 passed.
- `cd apps/api_server && npm run build && npx tsc --noEmit` — exit 0.
- No sandbox or server command was run in this intermediate slice; S2 owned the sandbox. Its then-pending criteria were superseded by the later product-HEAD live gate recorded below.
- GitNexus impact and final `detect_changes(scope=all)` were retried and remained unavailable with LadybugDB file v42/client storage v41; risk UNKNOWN, not HIGH/CRITICAL. Git diff checks independently confirmed the three-file test/docs scope.

### S3 #1482 live harness hardening

- RED acceptance contract: `cd apps/api_server && npx vitest run src/__tests__/issue_1482_live_harness_contract.test.ts` — 5/5 failed before the live fixture was changed.
- Hardened only the env-gated live fixture: it now requires two distinct connected/catalog-visible MCP servers, reserves the secondary server for the unused positive control, and diagnoses exact persisted scope, profile age, ten owned sessions, ten readable output rows, zero completed/denied evidence, dedup absence, and enabled scope policy before the optimizer run.
- The response audit id is captured before assertions; the run must be non-skipped, non-capped, and nonvacuous. Fixture proposals are bound to that exact audit id and exact `tighten-scope` kind, while protected profiles remain absent and the control remains present. Proposal cleanup remains first and audit-id scoped, followed by messages, sessions, and profiles; scope count/SHA-256 nonmutation remains asserted.
- GREEN acceptance contract: same command — 5/5 passed.
- Focused S3/API: `npx vitest run src/__tests__/issue_1482_live_harness_contract.test.ts src/__tests__/issue_1479_1482_optimizer_scope_live_e2e.test.ts src/__tests__/issue_1482_contract.test.ts src/services/__tests__/org_exercised_tools_resolver.test.ts src/__tests__/scope_hygiene_generator.test.ts src/services/__tests__/org_audit_service.test.ts --no-file-parallelism` — 78 passed, 2 live tests skipped normally.
- Forced live invocation without isolation failed closed in `assertLiveE2EIsolation`; no server or sandbox command was run because S4 owns the sandbox concurrently.
- `cd apps/api_server && npm run build && npx tsc --noEmit` — exit 0.
- Fork checks: `cd apps/opencode_fork/packages/opencode && bun test test/server/httpapi-mcp-oauth.test.ts` — 1/1 passed; `bun run typecheck` — exit 0.
- `git diff --check` — exit 0. Production-source diff is empty; this slice changes tests plus contract/run evidence only.
- GitNexus impact/context were attempted before the live-test edit and remained unavailable with LadybugDB file v42/client storage v41; risk UNKNOWN, not HIGH/CRITICAL.
- At this intermediate stage the contract still awaited the serial live run; that state was superseded by the later product-HEAD live gate recorded below.

### S3 exact proposal-predicate harness repair

- RED acceptance contract: `cd apps/api_server && npx vitest run src/__tests__/issue_1482_live_harness_contract.test.ts` — existing baseline 5/5 passed and 3 new exact-predicate checks failed.
- Repaired only the live test harness: proposal mapping includes `signalRef`; rows are filtered by exact audit id and then exact `tighten-scope` kind; the positive control requires one exact target/payload and a `tighten-scope:<hex>` signal. Protected IDs are checked only through parsed tighten payloads. Cleanup order and audit-scoped deletion are unchanged.
- GREEN acceptance contract: same command — 8/8 passed (baseline 5/5 plus 3 additions).
- Focused API/harness regression command: `npx vitest run src/__tests__/issue_1482_live_harness_contract.test.ts src/__tests__/issue_1479_1482_optimizer_scope_live_e2e.test.ts src/__tests__/issue_1482_contract.test.ts src/services/__tests__/org_exercised_tools_resolver.test.ts src/__tests__/scope_hygiene_generator.test.ts src/services/__tests__/org_audit_service.test.ts --no-file-parallelism` — 81 passed, 2 live tests skipped normally.
- Fail-closed command: `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/issue_1479_1482_optimizer_scope_live_e2e.test.ts --no-file-parallelism` — expected nonzero refusal from `assertLiveE2EIsolation`; 2 tests skipped and no server/sandbox started.
- API checks: `npm run build && npx tsc --noEmit` — exit 0.
- Fork checks: `bun test test/server/httpapi-mcp-oauth.test.ts` — 1/1 passed; `bun run typecheck` — exit 0; `bun run build --single` — standalone smoke test passed.
- No sandbox or server command was run. GitNexus impact was attempted before the harness edit but unavailable due LadybugDB file v42/client v41; risk UNKNOWN, not HIGH/CRITICAL.
- Final `detect_changes(scope=all)` was attempted before commit and failed for the same index-version mismatch.

### S3 final canonical-path verification at 97d07554

- Canonical preflight passed in physical worktree `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-s3-optimizer`; branch `fix/optimizer-scope-lane`, HEAD `97d0755486b8729799d9732341a7e2afd35c59b9`, initially clean. Fork package version was `1.14.49`; the sandbox build smoke reported `0.0.0-fix/optimizer-scope-lane-202608270204`.
- `tools/dev/sandbox.sh up` with the approved read-only fixture and `RHYTHM_OPTIMIZER_MODE=shadow` — ready on API `:4098`, engine `:4097`. After 95 seconds, `tools/dev/sandbox.sh status`, `/health`, `/opencode/health`, and engine `/mcp/tools` passed; all DB path variables resolved exactly to the sandbox copy.
- `npx vitest run src/__tests__/issue_1482_live_harness_contract.test.ts` — 8/8 passed.
- Focused API command from the final harness slice — 81 passed, 2 env-gated live tests skipped as designed.
- `npx vitest run src/__tests__/opc_m4_3_mcp_routes.test.ts src/__tests__/issue_1479_contract.test.ts src/cli/mcp_tool_grant_drift.test.ts` — 25/25 passed.
- `bun test test/server/httpapi-mcp-oauth.test.ts && bun run typecheck` — 1/1 passed; fork typecheck exited 0.
- `npm run build && node_modules/.bin/tsc --noEmit` — exited 0.
- Direct read-only CLI against `http://127.0.0.1:4097` returned `[]` and exited 0.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 ... npx vitest run src/__tests__/issue_1482_live_harness_contract.test.ts src/__tests__/issue_1479_1482_optimizer_scope_live_e2e.test.ts --no-file-parallelism --reporter=verbose` — 10/10 passed. This binds proposal assertions to the exact audit run and exact `tighten-scope` kind, requires exactly the control target/payload/signal, checks protected IDs only in parsed tighten payloads, and permits unrelated proposal kinds such as `create-recipe`.
- Cleanup query returned `{"profiles":0,"sessions":0,"proposals":0}`. Approved fixture SHA-256 remained `132e19c989ff33eda219440ede8a643b15ad28bf5c32c96a097be5ab8e3daa64`; product source remained unchanged.
- Manager GitNexus MCP was unavailable in this verifier session, so `detect_changes` evidence remains unavailable rather than inferred. Git scope was independently captured with `git diff --name-only main...HEAD`.

## Existing-row report

Read-only comparison against the issue's live Obsidian catalog found 16 phantom grants outside the theologian row. This report did not repair or mutate the theologian row (or any other live row):

- `fantasy-gm`: `obsidian_put_file`, `obsidian_patch_file`
- `money`: `obsidian_get_file`, `obsidian_search_dataview`, `obsidian_status`
- `worship-production`: `obsidian_get_file`, `obsidian_put_file`, `obsidian_patch_file`, `obsidian_search_dataview`, `obsidian_status`
- `graphic-designer`: `obsidian_get_file`, `obsidian_search_dataview`, `obsidian_status`, `obsidian_list_vault_directory`, `obsidian_list_vault_root`, `obsidian_get_active`

The report was read-only; no live `agent_configs` rows were changed.

## Notes / handoff

- The shared dev sandbox was deliberately not started or touched. Live fork endpoint and repair/report verification are deferred to the serial sandbox gate.
- GitNexus `detect_changes(scope=all)` was invoked before each commit attempt but unavailable during the concurrent index rebuild.
- This repair adds focused commits after the two issue commits. No push or PR was performed.

## 2026-08-27 adversarial-review repair

### Files / findings

- **F1 fixed:** `loadLiveMcpToolCatalog` now judges only `status === 'connected'`; `needs_auth`, `failed`, `disabled`, and registration-required servers are excluded. Engine warmup/outage no longer blocks profile editing. The prune lane now applies the same profile prompt/skill charter guard as tighten.
- **F2 fixed:** audit-supplied chat IDs are unioned with scheduled-task sessions, preserving scheduled usage as conservative anti-prune evidence. The resolver and measure comments now document the exact-audit versus broader-measure asymmetry.
- **F3 fixed:** `mcp-tool` drift remains in the audit/report but no structurally invalid server-key removal proposal is emitted.
- **F4 fixed:** validation composes IDs from the stored server key and the same exported segment sanitizer used by `expandMcpAllowlist`; contracts cover a drifted `nfl-mcp`/`nfl_mcp` name and dotted tool names.
- **F5 partially fixed / repository-guard recommendation rejected:** the marker-gated Obsidian producer now seeds only the one live read tool, `obsidian_simple_search`. A live-catalog guard was not put in synchronous `AgentConfigsRepository.insert/update`: making persistence depend on asynchronous engine availability would either require an unsafe cache or convert a broad repository API to async. Existing profile HTTP/proposal boundaries remain guarded; schedule/import hardening is a separate persistence-boundary change, not folded into this repair.
- **F6 fixed:** `setDb` now returns the prior handle and the in-process drift CLI restores it before closing its temporary readonly DB.
- **F7/F12 fixed:** the acceptance fixture now exercises the audit's `attributedSessionIds` branch with a `category='scheduled'` session; measure's intentionally broader evidence and the conditional trailing-window behavior are documented.
- **F9 fixed:** unavailable engine catalogs fail open for profile edits rather than becoming misleading 400 responses; `listMcpToolIds` now reports readiness directly as 503 instead of discarding `requireClient()`.
- **Ponytail cuts fixed:** deleted the bespoke loopback/bare-origin validator in favor of `new URL(engineUrl).origin`, unified catalog normalization, preserved old non-tool prune gap hashes by appending `serverName` only when present, and removed the source-string-matching live-harness test.
- **Evidence fixed:** removed invented c4 criteria, repointed issue-derived criteria to binding tests, and corrected the theologian sentence: no live row was repaired or mutated by the report.

### Acceptance / checks

- RED: `npx vitest run src/__tests__/issue_1479_contract.test.ts src/__tests__/issue_1482_contract.test.ts src/__tests__/scope_hygiene_generator.test.ts src/services/__tests__/obsidian_scope_backfill.test.ts src/cli/mcp_tool_grant_drift.test.ts --no-file-parallelism` — **8 failed, 23 passed** for F1–F6 before implementation.
- Additional RED: `npx vitest run src/__tests__/issue_1479_contract.test.ts --no-file-parallelism` — **4 failed, 3 passed**, including cold-engine editing.
- GREEN contract: focused five-file command — **32/32 passed**.
- Focused API/route/CLI: `npx vitest run src/__tests__/issue_1479_contract.test.ts src/__tests__/issue_1482_contract.test.ts src/__tests__/scope_hygiene_generator.test.ts src/services/__tests__/org_exercised_tools_resolver.test.ts src/services/__tests__/org_audit_service.test.ts src/services/__tests__/obsidian_scope_backfill.test.ts src/__tests__/opc_m4_3_mcp_routes.test.ts src/cli/mcp_tool_grant_drift.test.ts --no-file-parallelism` — **114/114 passed**.
- Fork: `bun test test/server/httpapi-mcp-oauth.test.ts && bun run typecheck` — **1/1 passed**, typecheck exit 0.
- API: `npm run build` and `npx tsc --noEmit` — exit 0.
- `git diff --check` and contract JSON parse — exit 0.
- Sandbox/live gate: **not run**, per dispatch; the shared sandbox remained reserved for later serial verification.
- GitNexus impact for every edited symbol and final `detect_changes(scope=all)` were attempted. Both failed with: `Database file version: 42, Current build storage version: 41`; risk remained UNKNOWN rather than being skipped or inferred.

## 2026-08-27 F5 async-producer completion

### Files / behavior

- `apps/api_server/src/controllers/agentSchedulesController.ts`: schedule create and update now run `assertMcpToolGrantsKnown` after request normalization and before repository persistence; validation errors are the same HTTP 400 used by profile edits.
- `apps/api_server/src/services/agent_config_export_import.ts`: every non-preset, non-noop profile that could write is validated before the importer enters its synchronous write loop. A later invalid profile therefore rejects the HTTP import before any earlier profile changes; no async engine dependency was added to `AgentConfigsRepository`.
- `apps/api_server/src/__tests__/issue_1488_f5_contract.test.ts` and `docs/ai/contracts/issue-1488.json`: connected unknown create/update/import rejection, raw-row nonmutation, valid connected persistence, non-connected fail-open, and unavailable-catalog fail-open contracts.
- Both async trust boundaries safely host validation; no path was rejected and no follow-up issue is required.

### Acceptance / checks

- RED: `cd apps/api_server && npx vitest run src/__tests__/issue_1488_f5_contract.test.ts --no-file-parallelism` — **2 failed, 3 passed**; schedule update and multi-profile import both persisted/returned success without catalog rejection.
- Repair attempt 1: same command — **1 failed, 4 passed**; persistence was blocked, but schedule surfaced the validator as HTTP 500 rather than profile-edit-compatible 400.
- GREEN: same command — **5/5 passed**.
- Focused regressions: `npx vitest run src/__tests__/issue_1488_f5_contract.test.ts src/__tests__/agent_configs_export_import.test.ts src/__tests__/agent_schedules_delegation_guard.test.ts src/__tests__/issue_1479_contract.test.ts --no-file-parallelism` — final rerun **28/28 passed**, including rejected schedule create non-persistence.
- `npm run build` and `node_modules/.bin/tsc --noEmit` — exit 0.
- `git diff --check` — exit 0; changed scope is the two async producers, one focused contract test, contract JSON, and this run note.
- GitNexus impact for `AgentSchedulesController.create`, `AgentSchedulesController.update`, and `importAgentConfigBundle`, plus final `detect_changes(scope=all)`, were attempted. All were unavailable with LadybugDB file **v42** / client storage **v41**; risk is UNKNOWN, with no HIGH/CRITICAL result.
- Sandbox was not started, per dispatch. Re-verification remains the next external gate.

## 2026-08-27 PR-level test-only gate repair

WAIVED: test-only PR-gate repair with no product behavior change; verification is focused RED→GREEN, the clean-env full API suite, build/typecheck, and a product-source diff.

### Triage classification / files

- `apps/api_server/src/__tests__/obsidian_write_grants.test.ts`: stale branch test. The historical ten-tool role-file read/non-write classification is now local to the #834 contract instead of importing the production backfill seed. `OBSIDIAN_READ_TOOLS` remains production-owned and unchanged at only `['obsidian_simple_search']`.
- `apps/api_server/src/services/opencode_client_service.test.ts`: shell-environment leakage. The "host supplied none" case now passes `''`, so inherited `RHYTHM_LOCAL_RENDERER_ORIGINS` cannot change the test input.
- No product source, role file, package manifest, or lockfile changed. Existing issue #834 evidence mapping remains valid, so no contract JSON changed.

### Acceptance / checks

- RED Obsidian: `cd apps/api_server && npx vitest run src/__tests__/obsidian_write_grants.test.ts` — **2 failed, 1 passed**. c1 misclassified `obsidian_search_json_logic`, `obsidian_get_periodic`, and `obsidian_open_file` as writes; c2 misclassified the historical read grants as leaked writes.
- RED CORS leakage: `RHYTHM_LOCAL_RENDERER_ORIGINS='rhythm://shell-leak' npx vitest run src/services/opencode_client_service.test.ts -t 'does not fabricate an engine CORS allowlist when the host supplied none'` — **1 failed, 59 skipped**; inherited shell origin was returned.
- GREEN Obsidian: the same focused command — **3/3 passed**.
- GREEN CORS: `RHYTHM_LOCAL_RENDERER_ORIGINS='rhythm://shell-leak' npx vitest run src/services/opencode_client_service.test.ts -t 'RHYTHM_LOCAL_RENDERER_ORIGINS engine bridge'` — **3 passed, 57 skipped**.
- First clean-env full API run: `env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" CI="${CI:-}" npm test` — **5982 passed, 207 skipped, 2 unrelated Docker lifecycle tests failed** because the worktree was resolving stale linked dependencies.
- Dependency triage: two `npm ci` attempts could not replace the linked/partial worktree `node_modules` (`ENOTEMPTY`, then `ENOTDIR`). `npm install` repaired only the ignored dependency environment; tracked manifests and lockfiles remained unchanged.
- Final clean-env full API rerun: the same command — **5984 passed, 207 skipped; 640 files passed, 118 skipped; exit 0**.
- `env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" CI="${CI:-}" npm run build` — exit 0.
- `env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" CI="${CI:-}" node_modules/.bin/tsc --noEmit` — exit 0.
- GitNexus impact attempts for `librarianWriteTools` and `resolveOpencodeCorsOrigins`, plus final `detect_changes(scope=all)`, failed with LadybugDB file **v42** / client storage **v41**; risk is UNKNOWN, with no HIGH/CRITICAL result.
- No sandbox or server command was run; PR #1489 owns the sandbox/live rerun.

## 2026-08-27 evidence-only final clearance at 4f64ed90

- Physical worktree: `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-s3-optimizer`; branch `fix/optimizer-scope-lane`; HEAD `4f64ed90fc5608fad01e209596389d5285e715c3`; initially clean.
- `git diff 948c7bfb...HEAD` contains only two API test files and this run note. Explicit product-source and manifest/lockfile path checks returned no diff.
- The prior product-HEAD gate at `948c7bfb` remains binding: the real sandbox #1479/#1482 live suite passed **2/2**, and no product byte changed afterward. Per dispatch, no sandbox or server E2E was started for this evidence-only clearance.
- Acceptance command: five files, **32/32 passed**. Focused API/route/CLI command: eight files, **114/114 passed**.
- Async producer contract: **5/5 passed**; four-file schedule/import regression command: **28/28 passed**.
- Test-only repair gates: Obsidian **3/3 passed**; inherited-origin CORS **3/3 passed, 57 skipped**.
- Clean-env full API: `env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" CI="${CI:-}" npm test` — **5984 passed, 207 skipped; 640 files passed, 118 skipped; exit 0**.
- Clean-env API `npm run build` and `node_modules/.bin/tsc --noEmit` — exit 0.
- Fork: OAuth endpoint test **1/1 passed**, typecheck exit 0, standalone build smoke passed with `0.0.0-fix/optimizer-scope-lane-202608271754`.
- MCP package: typecheck exit 0; **185 passed, 2 env-gated skipped**; build exit 0.
- Mobile: `test:ci:static`, `contract:check`, and `test:contract` exited 0. Lint reported three warnings and zero errors.
- Contracts `issue-1479.json`, `issue-1482.json`, and `issue-1488.json` contain respectively 3, 3, and 5 passing criteria with empty `not_tested`; no invented c4 or source-grep criterion remains.
- Manager GitNexus MCP is unavailable in this verifier session. Earlier required impact/detect attempts remain recorded as LadybugDB file v42/client v41; scope is UNKNOWN rather than inferred green.
- Package/build gates left no tracked changes. The only final local change is this evidence note; no implementation, test, manifest, lockfile, commit, push, merge, sandbox, or live service action was performed.
