# Project State

## Known bugs (parked, not blocking PR #617)

_(Parked bugs from before 2026-05-27 run. #638 and #635 below are now RESOLVED — see 2026-05-27 run entry.)_

## Recent coding-agent runs

### 2026-06-12 — opc-m1-foundation / issue-685 — Typed SDK wrappers replace duck-typing (OPC-M1-1) [REPAIR]
- **Verification-gate failure root cause:** The d.ts declarations declared unwrapped returns (e.g. `session.diff(): Promise<Array<FileDiff>>`), but the real hey-api-generated SDK returns `{ data?, error? }` envelopes (ThrowOnError=false default, verified in sdk.gen.ts v1.14.49). All call sites used `as unknown as` casts to paper over the wrong declarations — 27 casts total. Additionally, wrappers like `getSessionDiff` caught SDK errors and returned `[]`, the exact silent-swallowing bug class #685 was filed to eliminate.
- **Fix applied:** (1) Rewrote d.ts to declare all `OpencodeClient` methods as returning `Promise<SdkEnvelope<T>>` (alias for `{ data?: T; error?: unknown }`) matching hey-api reality. `auth.set` body union now accepts `ApiAuth | OAuthAuth` (eliminates the `as unknown as { type: 'api'; key: string }` OAuth cast). `event.subscribe` returns `SdkEnvelope<{ stream: AsyncIterable<Event> }>`. (2) Removed all 27 `as unknown as` casts from `opencode_client_service.ts` — call sites now consume typed envelopes directly. (3) Eliminated `this as unknown as Record<string,unknown>` via a dedicated private `_shuttingDown` field. (4) Replaced `typeof (client as unknown as Record<…>)[m] !== 'function'` method-presence probe with `!(methodName in client) || typeof client[methodName as keyof typeof client] !== 'function'`. (5) New typed wrappers now throw on error envelope (via `AppError 502 SDK_ERROR`) — never swallow to `[]` or `null`. (6) `promptAsync` retains the #632 silent-no-op guard (`!raw.data` → false).
- **Strengthened c1 test:** new assertion `expect(source.match(/as unknown as/g)).toBeNull()` — whole file, no allowlist. `getSessionDiff` error-envelope test now `rejects.toThrow()` (not `toEqual([])`); added throw-on-exception test.
- **Files modified (repair):** `apps/api_server/src/@types/opencode-ai-sdk.d.ts`, `apps/api_server/src/services/opencode_client_service.ts`, `apps/api_server/src/__tests__/opencode_client_typed_wrappers.test.ts`, `docs/ai/contracts/issue-685.json`, `docs/ai/project-state.md`.
- Checks: `ai-workflow checks --level pr` green (flutter analyze ✓, dart format ✓, tsc ✓, vitest 611/611 across 66 files). Zero `as unknown as` in `opencode_client_service.ts`.

### 2026-06-12 — opc-m1-foundation / issue-685 — Typed SDK wrappers replace duck-typing (OPC-M1-1) [original run — see REPAIR entry above]
- Task: replace all duck-typed SDK probes (`diffSession`, `session['permission']` casts) with typed wrapper methods on `OpencodeClientService`.
- Files modified:
  - `apps/api_server/src/@types/opencode-ai-sdk.d.ts` — extended `OpencodeClient` interface: added `session.diff`, `session.command`, `session.revert`, `session.unrevert`, `session.summarize`, `session.todo`, `session.fork`, `session.children`, top-level `postSessionIdPermissionsPermissionId`, `mcp.status/connect/disconnect`, `command.list`; new `FileDiff`, `Todo`, `McpStatusEntry` types.
  - `apps/api_server/src/services/opencode_client_service.ts` — added `AppError` import; added `requireClient()` guard (throws `AppError 503 ENGINE_NOT_READY` when client null); added typed wrapper methods: `getSessionDiff`, `respondToPermission`, `dispatchCommand`, `listMessages`, `getTodo`, `revertSession`, `unrevertSession`, `summarizeSession`, `forkSession`, `listChildren`, `listMcp`, `connectMcp`, `disconnectMcp`; replaced duck-typed `session['permission']` probe in `respondPermission` with a delegate to `respondToPermission`; replaced `as unknown as Record<string,…>['command']` cast in `listCommands` with typed `client.command.list()`.
  - `apps/api_server/src/controllers/agent_sessions_controller.ts` — `getDiff()` replaced broken duck-typed `diffSession` probe with `opencodeClient.getSessionDiff(opencodeId)`.
  - `apps/api_server/src/services/agent_model_resolver.ts` — exported `PROVIDER_TO_AGENT_KIND` constant (anthropic/github-copilot→claude-code, openai→codex, google→gemini-cli).
  - `apps/api_server/src/routes/agents_capabilities_routes.ts` — `GET /` and `POST /refresh` now include `providerToAgentKind: PROVIDER_TO_AGENT_KIND` in the response.
  - `apps/api_server/src/__tests__/opencode_client_typed_wrappers.test.ts` (new) — 34 contract tests for c1–c5 + wrapper shapes.
  - `apps/api_server/src/__tests__/agents_capabilities_routes.test.ts` — added c6 suite (4 tests for `providerToAgentKind`); fixed pre-existing key-count assertion to exclude `providerToAgentKind`.
  - `apps/api_server/src/__tests__/agent_sessions.test.ts` — updated mock to include `getSessionDiff`; updated diff test to use typed wrapper.
  - `docs/ai/contracts/issue-685.json` — updated `test_file` paths to repo convention (`src/__tests__/`); c7 mode set to "manual" with reason "gate-level check"; all criteria status→pass.
- Red→green proof: 34/34 failing before implementation → 34/34 passing after. Full vitest: 571→609/609 (38 new tests from this issue + pre-existing suite unchanged).
- Checks: `ai-workflow checks --level pr` green (flutter analyze ✓, dart format ✓, tsc ✓, vitest 609/609 across 66 files).
- Deviations: `respondPermission` (old method) kept as a thin delegate to `respondToPermission` for backward compat with call sites (decision mapping: accept→once, deny→reject). The `listCommands` duck-cast replaced inline (not a new wrapper — same method, just typed).
- Concerns: `ws_gateway.ts` `as unknown as` cast for `promptAsync.bind` retained — it is NOT targeting SDK objects (it's casting the bound method's signature to accept an extra `opts` arg for best-effort forwarding); the contract c1 test specifically excludes ws_gateway from the `as unknown as` check.

### 2026-06-12 — workflow/run-2026-06-12-opencode-parity-plan (planning only; PR #704, issues #685–#703)
- Task: audit-driven plan for full OpenCode v1.14.49 feature/UI parity in the Agents tab. No implementation. Two parallel audits (OpenCode clone pinned at the embedded SDK version v1.14.49; Rhythm's existing integration) → gap analysis → `docs/ai/current-plan.md` (replaces the completed #617 sprint plan) → 19 issue specs in `docs/ai/generated-issues/opencode-m*.md` → GitHub issues #685–#703 (label `opencode-parity`) → PR #704.
- Key findings recorded in the plan: the embedded SDK already exposes every endpoint the gaps need (`/session/{id}/diff`, `/revert`, `/unrevert`, `/summarize`, `/todo`, `/fork`, `/command`, `/message`, `/children`, `/mcp`) — the "Changes tab always empty" bug is a duck-typed call to a nonexistent `diffSession` method. Root causes of prior rot, each mapped to an M1 issue: dual transcript stores (in-memory parts vs SQLite plain text), duck-typed SDK access, provider-id/agent-id conflation, in-memory sentinels.
- Sequencing: M1 foundation (#685–#689) must fully merge before M2 rendering (#690–#693) → M3 session features (#694–#699) → M4 input/config (#700–#703). Out of scope (justified in plan): share server, themes/keybinds, LSP status, TUI remote control, workspaces/worktrees.
- Checks run: planning artifacts only — no app code touched; no CI runs triggered (docs-only branch; Actions are workflow_dispatch / paths-filtered). Verification-gate not applicable to a planning run; per-issue contracts come via acceptance-contract at implementation time.
- Open questions flagged for the user before M1 starts (current-plan.md §Open questions): parts storage shape (JSON column vs normalized table), markdown package pick, mini-bubble keep-or-delete, cost display units, custom-agent scope.
- Process note: the AgentFlow `plan_and_issues` run stalled mid-flight when the MCP server restarted (in-memory registry lost); recovered via CLI `agentflow resume` — which initially failed by falling back to a local ollama model because `AGENTFLOW_WORKFLOWS_DIR` was unset. See decisions.md entry for the config gotcha.

### 2026-06-12 — chore/server-shutdown-signal-contract (no issue; follow-up to PR #683 smoke)
- Task: fix watchdog ppid===1 heuristic failing in dev mode (Flutter→npx→tsx→Node chain; api_server's direct parent is tsx runner not Flutter, so ppid never becomes 1 on Cmd+Q). Production path confirmed correct via code analysis (direct Flutter→Node spawn, ppid=1 fires). Implemented `--parent-pid` flag approach so the watchdog works in both modes.
- Files modified:
  - `apps/api_server/src/server.ts` — watchdog now reads `--parent-pid=N` from `process.argv` → `trackedRootPid`; uses `process.kill(trackedRootPid, 0)` / ESRCH liveness probe when flag is present; falls back to legacy `ppid===1` when absent (older launcher compatibility).
  - `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` — spawn args extended with `'--parent-pid=$pid'` (dart:io `pid` getter = Flutter's own PID); both dev-mode (`npx tsx`) and production (`node dist/server.js`) paths receive the flag.
  - `apps/api_server/src/__tests__/server_shutdown_signal_contract.test.ts` — added c6 (argv parsing into trackedRootPid, declared before setInterval) and c7 (process.kill / ESRCH branch present).
  - `docs/ai/contracts/server-shutdown-signal.json` — added criteria c6, c7 (automated); updated c5 description to reflect both production and dev-mode fix.
- Checks run: contract 6/6 ✓ (4 existing + 2 new); `ai-workflow checks --level pr` green (flutter analyze ✓, dart format ✓, tsc ✓, vitest 571/571 across 65 files); `flutter test` 305/305 ✓; `npm run build` exit 0. No repair loop — first-try pass.
- Decisions made: signal-0 probe (`process.kill(pid, 0)`) over a PID-file or polling approach — it's a synchronous kernel query (no filesystem dep), works cross-depth, and ESRCH/EPERM semantics are well-defined on macOS. See `docs/ai/decisions.md` for trade-off note.
- Deviations from spec: none.
- Concerns: legacy fallback path (`ppid===1`) is now dead code for any client using ApiServerService ≥ this commit; kept for launchers that predate the flag. Signal-0 requires the watchdog to have permission to probe Flutter's PID — always true for a direct or indirect child on the same macOS user account (same UID = permission granted; EPERM would mean a different-user process, treated conservatively as alive).

### 2026-06-11 — chore/server-shutdown-signal-contract (no issue; follow-up to #655/PR #682)
- Investigation outcome (the task's premise was stale): the proposed SIGTERM/SIGINT→`opencodeClient.dispose()` handlers ALREADY exist on main — `server.ts:129-130`, added in commit `726a5c4` (#614 clean-shutdown block), with the #614b watchdog routing `PARENT_GONE` through the same `shutdown()`. No production change needed; the real gap was zero test coverage of that wiring (existing tests cover `dispose()` itself and the #655 reclaim path only).
- Files modified:
  - `apps/api_server/src/__tests__/server_shutdown_signal_contract.test.ts` (new) — 4 source-inspection contracts (watchtower-contract style; server.ts runs main() at import so unit-importing is impractical): c1 both signals registered→shutdown, c2 `opencodeClient.dispose()` inside shutdown() before any `process.exit`, c3 watchdog reuses shutdown('PARENT_GONE'), c4 `shuttingDown` idempotence guard.
  - `docs/ai/contracts/server-shutdown-signal.json` (new) — 5 criteria: 4 automated (green), 1 manual (c5: normal app quit leaves no `opencode serve` on :4096).
- Checks run: contract 4/4 ✓; mutation-proof: removing the SIGINT registration makes c1 fail (1/4 red), restored clean. **Verification-gate PASS** — `ai-workflow checks --level pr` green (flutter analyze ✓, dart format ✓, tsc ✓, vitest 563/563 across 64 files), `flutter test` 305 ✓, `npm run build` exit 0. Live server smoke deliberately skipped (test-only diff; runtime identical to main; behavioral quit-path is contract c5 manual). No repair loop — first-try pass.
- Decisions made: regression guard for EXISTING behavior — fail-first acceptance-contract deliberately skipped (test passes on unmodified codebase by design); source-inspection over a spawn-the-server e2e to keep issue-level suite fast (precedent: `watchtower_compose_contract.test.ts`).
- Deviations from spec: the dispatching task asked to "add SIGTERM/SIGINT handlers" — not done because they already exist; scope collapsed to the test-only guard.
- Concerns: source-inspection contracts are wiring guards, not behavior proofs — a refactor that keeps the strings but breaks semantics would pass; c5 manual smoke is the behavioral check. Regexes tolerate whitespace/formatting changes but would need updating if shutdown() is extracted to another module (acceptable: the test failure would prompt exactly that review).

### 2026-06-11 — issue-655-kill-stale-on-port-4096 (#655)
- Files modified:
  - `apps/api_server/src/services/opencode_client_service.ts` — added `OPENCODE_ENGINE_PORT = 4096`, `StalePortDeps` (injectable `lsof`/`ps`/`kill`/port-free boundary), `ReclaimResult`, `isStaleOpencodeCommand()`, `defaultStalePortDeps` (real `execFile lsof -iTCP:<port> -sTCP:LISTEN -t` → `ps -o command= -p <pid>` + `process.kill`), and `reclaimStalePortForOpencode(port, deps)`. Wired one `await reclaimStalePortForOpencode()` call into `_initializeImpl` immediately before `createOpencode({})`. A stale `opencode serve` orphan on :4096 is SIGTERM→(grace)→SIGKILLed then the port is polled free; a NON-opencode holder throws a clear error naming PID+command (caught by the existing try/catch → status=error with that message instead of the opaque "Server exited with code 1").
  - `apps/api_server/src/__tests__/issue_655_contract.test.ts` (new) — 6 vitest assertions across c1 (reclaim + SIGTERM→SIGKILL escalation), c2 (foreign holder → throws naming PID 5555 + command, never kills), c3 (free-port no-op, ps consulted only after pid, port const = 4096). Red 6/6 before impl, green 6/6 after.
  - `docs/ai/contracts/issue-655.json` (new) — 4 criteria, 3 automated (pass), 1 manual (c4 force-quit relaunch smoke).
- Checks run: contract 6/6 ✓ (red 6/6 before); **verification-gate PASS** — `ai-workflow checks --level pr` green (flutter analyze ✓, dart format ✓, tsc --noEmit ✓, full vitest 565/565 across 64 files).
- Repair loop (ONE round): first `--level pr` run failed — `src/__tests__/credentials_bridge_service.test.ts` errored at import ("No execFile export is defined on the child_process mock"). Root cause: a top-level `const execFileAsync = promisify(execFile)` ran at module load, forcing every importer (incl. that test's partial `vi.mock('child_process', {execSync only})`) to provide `execFile`. failure-triage fix: lazily `require('child_process')` inside a `runCommand(file,args)` helper at call time (no top-level binding); removed a dead `toString()` branch that tripped tsc (`never` type). Re-verified green. No follow-up issues filed.
- Decisions made: kill-stale-on-port (issue's preferred approach) over dynamic alternate-port retry — the fixed :4096 is assumed by the Flutter client + ws_gateway. Stale-detection requires the command to contain both `opencode` AND `serve` (never kills a foreign process), and if a `--port`/`--port=` token is present it must equal our port. Injected OS boundary so the lsof/ps/kill path is unit-testable without real processes. Probe placed inside the existing `_initializeImpl` try/catch so a non-opencode-holder error flows through the established status=error/statusMessage path.
- Deviations from spec: none. (Issue's optional log-line on reclaim is implemented as `logger.info`.)
- Concerns: c4 (force-quit → relaunch) is manual-smoke-only — it needs a real orphaned opencode process on :4096 and the full desktop spawn path. The `defaultStalePortDeps` shell out to `lsof`/`ps`, which exist on macOS (the only shipping target); on a host without `lsof`, `lookupPidOnPort` swallows the error and treats the port as free (safe degradation — same as no orphan).

### 2026-06-11 — chore/watchtower-label-rhythm-api (no issue; user-approved)
- Files modified:
  - `apps/api_server/docker-compose.synology.yml` — `rhythm-api` gained `com.centurylinklabs.watchtower.enable: "true"` (+ explanatory comment). Joins the host-wide label-enable Watchtower already run by the statements project (30-min poll, GHCR creds from root's docker login). `cloudflared` deliberately NOT labeled.
  - `docs/release/hosted_deployment_synology_cloudflare.md` — "Deploying an update" now leads with the automatic Watchtower path; manual SSH pull/up demoted to immediate-deploy fallback; routine summary updated; verify-curl unchanged.
  - `apps/api_server/src/__tests__/watchtower_compose_contract.test.ts` (new) + `docs/ai/contracts/watchtower-rhythm-api.json` (new) — c1 label present (red-proven → green), c2 cloudflared unlabeled (guard); c3 docs + c4 live auto-update are manual.
- Checks run: contract 2/2 ✓ (c1 red before); compose YAML parses, label value is string 'true'.
- Decisions made: reuse the statements Watchtower instead of running a Rhythm-scoped instance — one updater per host, label-enable filtering, creds already mounted. The bulletin-generator pattern (own scoped watchtower) rejected as redundant.
- Deviations from spec: none.
- Concerns: labels only apply on container recreate — the NAS needs ONE more manual `up -d` with the updated compose before auto-updates kick in. c4 verifies on the first post-deploy merge via /health commit drift. Watchtower availability now couples rhythm-api deploys to the statements stack staying up.

### 2026-06-11 — issue-677-health-build-commit (#677)
- Files modified:
  - `apps/api_server/src/controllers/health_controller.ts` — `/health` now returns `commit` (`RHYTHM_BUILD_COMMIT` env, `'dev'` fallback) and `builtAt` (`RHYTHM_BUILD_TIME`, omitted when unset). Read at request time so tests can vary them.
  - `apps/api_server/Dockerfile` — runtime stage gained `ARG GIT_SHA=dev` / `ARG BUILD_TIME=` baked into `ENV RHYTHM_BUILD_COMMIT` / `RHYTHM_BUILD_TIME`.
  - `.github/workflows/api_deploy_synology.yml` — workflow renamed **"API Image Publish (GHCR)"** (was "API Deploy (Synology)" — the misleading name behind the 2026-06-11 smoke failure); passes `GIT_SHA`/`BUILD_TIME` build-args; final echo step now includes the verify-curl with the expected SHA.
  - `docs/release/hosted_deployment_synology_cloudflare.md` — routine update gains step 7: curl /health and compare `commit` to the merged SHA; publish-vs-deploy warning added.
  - `apps/api_server/src/__tests__/issue_677_contract.test.ts` (new) + `docs/ai/contracts/issue-677.json` (new) — 5 criteria: 2 automated (red-proven 2/2 → green 2/2), 3 manual (image build-arg wiring verified on next publish; docs + rename by PR review).
- Checks run: contract 2/2 ✓ (red 2/2 before); `ai-workflow checks --level issue` → analyze ✓, format ✓, tsc ✓.
- Decisions made: env vars read at request time (not via cached `env.ts`) so contract tests can set/unset per test; `builtAt` omitted rather than null when unset.
- Deviations from spec: none; the optional rename criterion was applied (not declined).
- Concerns: c3 (build-arg → running image) is only fully provable on the first post-merge image publish + NAS pull — the runbook verify-curl is the closing check. Workflow rename keeps the same filename (`api_deploy_synology.yml`) so the `paths:` self-trigger still works.

### 2026-06-01 — fix/google-token-refresh-client-mismatch — Google OAuth `unauthorized_client` on token refresh
- Recurring Integrations-page bug: `Google token refresh failed: { "error": "unauthorized_client", "error_description": "Unauthorized" }`. Root cause = OAuth **client mismatch**: tokens are minted by the *desktop* PKCE client (`exchangeDesktopCode` → `googleAuthClientId/Secret`, the only live connect path via Flutter `desktop-exchange`) but `refreshTokens` refreshed with the *web* client (`googleClientId/Secret`). The two clients are distinct in the shipped build (`desktop_release.yml:34-37`). Re-auth "fixed" it only until the next ~1h access-token expiry.
- Files modified:
  - `apps/api_server/src/services/google_oauth_service.ts` — `refreshTokens` now uses `env.googleAuthClientId`/`env.googleAuthClientSecret` (mirrors `exchangeDesktopCode`), plus a not-configured guard. ~3-line logic change in one private method.
  - `apps/api_server/src/__tests__/google_token_refresh.test.ts` (NEW) — contract test: asserts refresh presents the desktop client (not web), preserves the refresh token when Google omits a new one, and surfaces Google errors as AppError.
  - `docs/ai/contracts/fix-google-token-refresh-client-mismatch.json` (NEW) — 6 criteria (4 automated, 2 manual).
  - `docs/ai/generated-issues/fix-google-token-refresh-client-mismatch.md` (NEW) — full goal/spec.
- Checks run: contract test RED before fix (AssertionError: `client_id=web-client…` ≠ desktop), GREEN after (3/3). **verification-gate PASS: vitest 551/551 (60 files), tsc build clean.** No repair loop (first-try pass). Manual smoke (gtr-c5) pending user.
- Decisions made: refresh mirrors the mint client rather than storing an issuing-client column per account — every shipping account is desktop-minted, so the symmetric fix needs no migration/new secret/Google Cloud change. See `docs/ai/decisions.md`.
- Deviations from spec: none.
- Concerns: legacy accounts minted via the unused web `/auth/google/callback` flow (if any) would need one reconnect; hosted API must have `GOOGLE_AUTH_CLIENT_SECRET` set (it does, or desktop-exchange would already fail there). Both noted in goal §6/§8.

### 2026-06-10 — feat/674-675-planner-scheduled-date-and-inspector-edit-mode (#674)
- Files modified:
  - `apps/api_server/src/controllers/tasks_controller.ts` — `create()` now destructures `scheduledDate` from req.body and passes `scheduledDate: (scheduledDate as string) ?? null` to `repo.createAsync(...)`. Root cause of #674: the due-date/scheduled-date refactor updated the repository + schema but never the create controller, so planner-created tasks persisted with `scheduled_date = NULL` and matched the backlog predicate.
  - `apps/api_server/src/__tests__/issue_674_contract.test.ts` (new) — 4 integration tests over a real HTTP server + in-memory SQLite: c1 scheduledDate round-trips POST→response→GET; c2 task appears in the right `GET /weekly-plan` day column and not backlog; c3 no-date create still lands in backlog; c4 dueDate-only unchanged. Red proven (c1, c2 fail pre-fix), green after.
  - `docs/ai/contracts/issue-674.json` (new) — 5 criteria, 4 automated (pass), 1 manual (c5 Postgres path post-deploy).
- Checks run: contract tests 4/4 ✓ (red 2/4 before fix); `ai-workflow checks --level issue` → flutter analyze ✓, dart format ✓, tsc --noEmit ✓.
- Decisions made: c2/c3 assert through `GET /weekly-plan` (the production assembly path that drives the planner columns) rather than only the POST response, so the backlog-vs-day-column behavior is contract-tested end-to-end on the server.
- Deviations from spec: none — exactly the fix the issue prescribed.
- Concerns: c5 (Postgres path) only verifiable after deploy to api.vcrcapps.com; SQLite path covered by the harness. #675's planner-create UX depends on that deploy.

### 2026-06-10 — feat/674-675-planner-scheduled-date-and-inspector-edit-mode (#675)
- Files modified:
  - `apps/desktop_flutter/lib/app/core/ui/rhythm_inspector.dart` — (A) `showRhythmTaskInspector` gained `initialEditMode` (default **true**) → all call sites (Weekly Planner, Tasks, Dashboard) now open in edit mode; `_editing = widget.initialEditMode && !_readOnly` in initState preserves the `calendar_shadow_event` read-only gate. (B) New `showRhythmTaskCreateInspector(context, {workspaceMembers, onCreate, scheduledDate})` — builds a blank seed Task (no id), opens the inspector with `isCreate: true`; save button reads "Create task" and routes to `onCreate` (create, never update); Cancel pops without creating; collaborator controls hidden (null callbacks — task has no id until saved).
  - `apps/desktop_flutter/lib/features/weekly_planner/views/weekly_planner_view.dart` — both add-task call sites replaced: day column seeds `scheduledDate: widget.date`, backlog "+" seeds no date; `onCreate` routes title/notes/dueDate/scheduledDate/preferredAgent into `controller.createTask`.
  - `apps/desktop_flutter/lib/features/weekly_planner/controllers/weekly_planner_controller.dart`, `lib/features/tasks/repositories/tasks_repository.dart`, `lib/features/tasks/data/tasks_local_data_source.dart` — `create`/`createTask` extended with `notes`/`dueDate`/`preferredAgent` (dueDate was missing from the POST body entirely) so inspector-created tasks persist all fields.
  - `apps/desktop_flutter/lib/app/core/ui/rhythm_task_create_dialog.dart` — DELETED (planner was its only consumer; repo-wide grep clean); export removed from `rhythm_ui.dart`.
  - Tests: new `test/app/core/ui/issue_675_contract_test.dart` (c1 edit-default, c2 shadow-event read-only) + `issue_675_create_contract_test.dart` (c3 day seed, c4 backlog no-date, c5 notes/dueDate/agent during create + collaborators hidden, c6 cancel discards). Updated to the new default: `rhythm_inspector_date_warning_test.dart` (no Edit-details tap; view-mode test passes `initialEditMode: false`), `issue_651_contract_test.dart` (c3/c4 no Edit-details tap, drains preserved).
  - `docs/ai/contracts/issue-675.json` (new) — 8 criteria, 6 automated (pass), 2 manual (c7 process checks via gate, c8 planner view wiring via manual smoke).
- Checks run: #675 contract tests 6/6 ✓ (red proven: c1 assertion-fail, create file compile-fail pre-implementation); full `flutter test` 305/305 ✓ (was 299; +6); `ai-workflow checks --level issue` → analyze ✓, format ✓, tsc ✓.
- Decisions made: chose the issue's option (a) — a thin create wrapper building a seed Task — over adding an `isNew`/`onCreate` dual path inside the inspector widget; only an `isCreate` flag for the button label + cancel-pops behavior was added. Owner picker from the old minimal dialog was NOT carried over: the inspector has no owner field, server defaults owner to the authed user (matches inspector's "Created by" semantics).
- Deviations from spec: none beyond the blessed simplest-option choices above.
- Concerns: planner view wiring (c8) is manual-smoke-only — the view's private widgets need live HTTP providers to pump. Creating a planner task in the running app only lands on the day once the #674 backend fix is deployed to api.vcrcapps.com.

### 2026-05-30 — feat/staff-guide-v2 — content milestone (#661-#671, batches A+B; C deferred)
- Followup to the 2026-05-30 staff-guide PR #660. Eleven issues filed for v2 content adds; 9 shipped this run, 2 deferred (Batch C — #666, #661 — both need new larger-monitor screenshots that haven't landed yet).
- Files modified (all on `feat/staff-guide-v2`, branched off main `3ed43aa`):
  - `docs/manual/index.html` — 17 sections (up from 13). New sections inserted: `#glossary` (#665, before `#download`), `#onboarding` (#663, after `#download`), `#agents` (#664, between Messages and Integrations), `#starter-packs` (#668, between Settings and More tools). Existing sections expanded: `#automations` (#662, 6 concrete recipe cards in `.methods.two` grid), `#settings` (#669, warning callout reworded + leading + `details.more open` deep-dive on Server URL behavior). `#more` got 3 new `details.more` blocks (#667 notifications + reminders, #670 multi-device sign-in, #671 where your data lives). Added 2 new sprite symbols (`i-agent`, `i-pack`), 4 new ICON map entries, 3 new CSS rules (`.methods.two` 2-col modifier, `nav.toc a.preview` muted-state, `pre.codeblock`). JS now reads `data-preview="true"` on a section to give its TOC link `class="preview"` — used by `#agents`.
  - `docs/manual/starter-packs/worship-leader.json` — 4 rhythms (Sunday music plan, Sunday rehearsal, monthly team huddle, quarterly song rotation review), 3 annual projects (Christmas Eve, Easter, retreat), 3 starter tasks.
  - `docs/manual/starter-packs/pastoral.json` — 4 rhythms (sermon prep, pastoral visits, monthly leadership, quarterly vision review), 3 projects (annual sermon series, Easter sermon series, new-member class), 3 starter tasks.
  - `docs/manual/starter-packs/finance.json` — 4 rhythms (weekly reconcile, monthly bills+payroll+treasurer report, quarterly tax), 3 annual projects (budget cycle, year-end close, annual ministry report), 3 starter tasks.
  - `docs/manual/mcp-setup-prompt.md` — standalone copy of the Claude Cowork interview prompt with design notes, pack-seeding variation, shorter-interview variation, and language note. Referenced inline from `#onboarding`.
  - `.agent-stack/evidence/rhythm-staff-guide-v2/` — `render-report.json` + 4 PNGs (`masthead.png` 77 KB, `onboarding.png` 259 KB, `starter-packs.png` 223 KB, `full-page.png` 3.5 MB).
- Checks run (verification-gate, Skill-tool invoked):
  - Playwright headless render: 17/17 assertions PASS. Section count + exact order match, TOC contains all 17 ids + Reference grouplabel, all 9 `figure.shot` images load (`naturalWidth > 0`), 0 console errors, Inter + JetBrains Mono fonts both registered with `document.fonts`, exactly one `a.dlbtn[href="/download/mac"]`, `#onboarding` has 2 `pre.codeblock` elements (254 B config snippet + 2,813 B interview prompt), TOC entry for `#agents` carries `class="preview"`, sprite sheet contains both `i-agent` and `i-pack`, glossary methods grid has exactly 4 cards (2×2), automation recipes grid has exactly 6 cards. Evidence: `.agent-stack/evidence/rhythm-staff-guide-v2/render-report.json`.
  - JSON lint: `python3 -m json.tool` clean on all 3 starter-pack files.
  - No Flutter / api_server / mcp_server source modified — `ai-workflow checks` not applicable to this docs-only change.
- Decisions:
  - **#663 interview prompt embedded inline in the manual + the standalone `mcp-setup-prompt.md`.** Both ship together. The HTML version is what staff will copy in the moment; the markdown version is the reference + variation guide. Keeping both means the prompt is in the gated guide (visible to authenticated staff only) and in the repo (visible to future agents tuning it).
  - **Starter-pack JSON uses a plain Rhythm-shaped schema** (`rhythms[].cadence/steps`, `projects[].target_anchor/steps[].offset_days`, `tasks[]`), not a formal import schema. There's no "Import starter pack" UI yet (out of scope per #668); the pack files are reference content the user — or Claude via MCP — uses to seed Rhythm. Skipped JSON Schema / YAML alternatives; the manual is the README for the format.
  - **No new screenshots taken**, even where issues hinted at one (e.g. #667 "1 screenshot if helpful"). The existing 9 captures from PR #660 cover every section that needed an image. Inventing a screenshot of the bell toggle from the running app today would have meant pulling a fresh capture from the same smaller display whose dense layout already prompted the recapture follow-up. Stayed honest with text + cross-links.
  - **Batch C (#666, #661) deferred, not attempted.** The screenshots directory mtimes were all `2026-05-30 15:01` — the original PR #660 set, no recapture has landed. Per the brief, deferring is the correct call; filing in the PR body so they stay on the radar.
  - **#671 backup section did not quote a specific cadence.** The deployment runbook at `docs/release/hosted_deployment_synology_cloudflare.md` describes the deploy/restart procedure but does not codify backup schedule (Synology DSM-level concern). Wrote a factual sentence pointing readers to IT for the current cadence instead of inventing "nightly retained 30 days."
  - **Agents placeholder uses a soft "preview" treatment** rather than a hard "WIP" warning — TOC link gets `class="preview"` (62% opacity, muted mk border), section heading gets a neutral `Coming soon` pill (`var(--ink-3)` background, `var(--fg-3)` text). Pairs with a callout linking forward to `#onboarding` so curious users have somewhere to go.
- Concerns / follow-ups:
  - **#663 prompt is untested in a real Cowork session.** Per user direction ("Section + prompt together, you test after"), the live interview must happen before merge — the prompt is the load-bearing artifact for the whole milestone. Failure modes to watch: Claude trying to fetch the gated `rhythmguide.vcrcapps.com/starter-packs/*.json` URLs (Access blocks; the markdown file flags this), Claude bulk-questioning instead of one-at-a-time, Claude finishing without calling `rhythm_get_dashboard`, MCP tool-name drift (the README's `rhythm_add_rhythm_step` etc. must match the deployed MCP server's actual exports).
  - **#664 references a Settings → Claude Integration pane** the MCP server README also claims exists. If that pane isn't yet in the shipping Flutter build, the manual will point staff at a missing screen. Fallback path in step 2 references the CLI route in the MCP README, but verifying the in-app pane exists on the latest desktop release is on the user's manual-smoke list.
  - **Batch C** still owed: #666 "Your first 30 minutes" walkthrough and #661 task inspector. Both want new screenshots from a larger monitor. Track as the next session when captures land.
  - **Worker not redeployed yet** — `npx wrangler deploy` from repo root is the manual step the user will run after merge (or on the open PR for a preview test). Per "Manual merge only" rule, verification-gate didn't probe a live URL; the file:// render is the formal gate.

### 2026-05-30 — feat/staff-guide-and-download-proxy — gated staff guide + GitHub-release download
- New surface: `https://rhythmguide.vcrcapps.com` — a gated, interactive staff manual + one-click desktop download for Rhythm. Mirrors the architecture already in production for `statementsguide.vcrcapps.com` (Statement Automator). Behind Cloudflare Access (same Google Workspace IdP, same `email_domain: visaliacrc.com` policy as the sister tool); the private `ajhochy/Rhythm` repo stays private.
- Files added (all on `feat/staff-guide-and-download-proxy`):
  - `docs/manual/index.html` — self-contained Inter + JetBrains Mono guide, dark "ink" palette recolored to Rhythm blue `#4F6AF5` (cross-tool consistency with Statement Automator). 13 sections: Get the desktop app, Dashboard, Weekly Planner, Tasks, Rhythms, Projects, Automations, Facilities, Messages, Integrations, Settings, More tools & tips, Questions & fixes. Auto-built grouped TOC, live `textContent`-based search, scroll-spy, lightbox, reading-progress bar, print stylesheet.
  - `docs/manual/app-icon.png` — copied from `apps/desktop_flutter/macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_512.png`. Used for the masthead, favicon, and apple-touch-icon.
  - `docs/manual/screenshots/*.png` — 9 captures from the live Flutter desktop app (Dashboard, Weekly Planner, Tasks, Rhythms, Projects, Automations, Facilities, Messages, Integrations). PII (top-right account widget on every shot, worship-rotation names in the planner backlog, message thread previews, "Request Check for Justin" rhythm title) is PIL Gaussian-blurred; sources downscaled 2880→1920px. **Settings screenshot intentionally not included** — too much PII surface in the Permissions list to redact cleanly; the text + warning callout carry the section instead. Follow-up: recapture from a larger display once available.
  - `worker/staff-guide.js` — Cloudflare Worker. Static assets served via the `ASSETS` binding; `/download/mac` route reads the latest release from `ajhochy/Rhythm` using a server-side `GITHUB_WORKER_TOKEN` (read-only Contents PAT, never reaches the client), finds the asset matching `/^Rhythm-macOS\.dmg$/i`, and 302-redirects to GitHub's short-lived signed URL on `release-assets.githubusercontent.com`. Returns 503 "not configured" if the secret is unset.
  - `wrangler.jsonc` — `name: rhythm-staff-guide`, `workers_dev: false` (so the public `*.workers.dev` URL can't bypass Access), custom domain route `rhythmguide.vcrcapps.com`, assets directory `./docs/manual`.
  - `.gitignore` — added `.wrangler/`, `.dev.vars`, `.dev.vars.*` so wrangler local state and local secret files never get tracked.
  - `.agent-stack/evidence/rhythm-staff-guide/` — verification evidence (Playwright render report, masthead/download/full-page screenshots, local `wrangler dev` curl trace showing 302→`release-assets.githubusercontent.com`, deploy + Access summary).
- Deployment (Cloudflare account `b504b8fb1bb0f91bf6ee5b92f93113b5`):
  - Worker uploaded, secret bound (`GITHUB_WORKER_TOKEN`), custom domain attached. Final version `cc0edd32-f188-47ce-a51b-019f7d479b52`. `wrangler deployments list` shows three transitions (initial upload → secret bind → custom domain attach).
  - Cloudflare Access app id `44c01565-5adb-4de3-a548-8e02ee570560`, AUD `15bf46dd...`, IdP `2c2e9eae...` (the same Google Workspace already gating `statementsguide.vcrcapps.com`), policy `Allow visaliacrc.com staff` (decision: allow, include: `email_domain: visaliacrc.com`).
- Checks run:
  - Headless render (Playwright file://): 13 sections present, grouped TOC built (Contents + Reference), every `<figure>` image has `naturalWidth > 0`, 0 console errors, Inter + JetBrains Mono fonts loaded, single `/download/mac` button. Evidence: `.agent-stack/evidence/rhythm-staff-guide/render-{masthead,download,full}.png` + `render-report.json`.
  - Local proxy (`wrangler dev` + curl): `GET /` → 200; `GET /screenshots/dashboard.png` → 200; `GET /download/mac` → 302 → `release-assets.githubusercontent.com/...?...filename=Rhythm-macOS.dmg` with a ~15-min signed JWT. Evidence: `.agent-stack/evidence/rhythm-staff-guide/local-download-proxy.txt`.
  - Live gate (production hostname): `GET https://rhythmguide.vcrcapps.com/` → 302 → `https://visaliacrc.cloudflareaccess.com/cdn-cgi/access/login/rhythmguide.vcrcapps.com?...&redirect_url=/`. `GET .../download/mac` → 302 → same Access login with `redirect_url=/download/mac`. `workers_dev: false` — the worker has no `*.workers.dev` hostname; only `rhythmguide.vcrcapps.com (custom domain)` appears as a deploy target. Evidence: `.agent-stack/evidence/rhythm-staff-guide/deploy-and-access.txt`.
- Decisions:
  - **Reused Statement Automator's PAT for production** (per user direction "reuse the one in statements .env for now"). The PAT's resource access list already covered the Rhythm repo. **Follow-up: rotate to a Rhythm-specific Contents:Read fine-grained PAT** so a compromise of one worker doesn't expose the other.
  - **One download button (`/download/mac` → `Rhythm-macOS.dmg`)**, not a DMG+ZIP pair. The current GitHub release ships a universal `Rhythm-macOS.dmg` (Apple Silicon + Intel) and a `Rhythm-macOS.zip`; the DMG is the standard staff install path. The Worker's `TARGETS.mac` regex `/^Rhythm-macOS\.dmg$/i` will need updating if the release pipeline later switches to arch-split assets.
  - **Visual treatment: dark "ink" recolored to Rhythm blue**, not a light treatment matching the in-app theme. The dark guide chrome is shared with Statement Automator; keeping a single "staff guide" visual identity across tools was higher-value than per-tool theming.
  - **`workers_dev: false`**, not `true` — without it, the public `<worker>.workers.dev` hostname would serve the guide + downloads unauthenticated, bypassing Access. The custom domain is the only public route.
  - **Evidence kept inside the repo** at `.agent-stack/evidence/rhythm-staff-guide/` (mirroring the existing `.agent-stack/postmortems/` pattern) so the PR reviewer can read it without leaving GitHub. Initially landed inside `docs/manual/.evidence/`, but that location got picked up by the wrangler assets directory glob and would have been deployed to the public bucket — moved out.
- Concerns / follow-ups:
  - The 9 captured screenshots were taken on a smaller display; some content is dense. User has asked for re-captures on a larger monitor — track as a follow-up.
  - PAT rotation to Rhythm-specific token (see Decisions, above).
  - If/when the desktop release pipeline emits arch-split DMGs (`Rhythm-macOS-arm64.dmg` / `-x64.dmg`), the Worker's `TARGETS.mac` regex needs to be updated and the guide may want two buttons (mirroring Statement Automator's `mac-arm64` / `mac-intel` split).
  - No automated regression coverage on the Worker (the proxy is small + verified via `wrangler dev` curl). If the GitHub API contract changes (asset envelope shape, signed-URL host), only manual re-test will catch it.

### 2026-05-29 — fix/regression-ai-collab-chat (#651, #652 folded in) — root cause confirmed + 3 hardenings
- v18.38 manual smoke (with the diagnostic shim from the 2026-05-28 entry below) reported "silent failure" — the shim ALSO did not surface anything. Direct curl against production with the user's session token reproduced HTTP 201 + correct body, so the backend was working all along. Inspection of the runtime environment revealed `RHYTHM_LOCAL_SMOKE=1` set at user-launchd level (via `launchctl setenv` from the 2026-05-27 PR #649 smoke), which makes `AgentTriggerWatcher.start()` a no-op per [agent_trigger_watcher.dart:88-95](apps/desktop_flutter/lib/app/core/agents/agent_trigger_watcher.dart#L88). The watcher had been silenced in every release DMG installed since 2026-05-27. Triggers were piling up at the production endpoint (id=19, 20, 21, 25 dating back to the same evening).
- Files modified (all on `fix/regression-ai-collab-chat`):
  - `apps/desktop_flutter/lib/app/core/agents/agent_trigger_watcher.dart` — refactored `isLocalSmokeRun` to call a pure `computeIsLocalSmokeRun(dartDefine, envVar, isDebugMode, onIgnoredInRelease)` helper. Release builds (`!kDebugMode`) now refuse to honor the env var and emit a one-shot stderr WARN via `_warnIgnoredSmokeEnvOnce`. `--dart-define=RHYTHM_LOCAL_SMOKE=1` still works (compile-time, scoped to the binary).
  - `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart` — added `kPendingAgentSentinel = '__pending__'`, `isPendingAgent(agentId)`, `filterStalePendingErrors(messages, isPending)` (all `@visibleForTesting`). `_BubbleHeader.build` overrides `agentLabel` to "Pick a model" + muted color when `isPendingAgent(entry.agentId)` instead of falling through to the raw sentinel (#652). `_CollapsedBubble._badgeLabel` returns "?" for `__pending__` instead of "_" (sentinel's first char). `_ExpandedSessionBubbleState.build` filters `messages` through `filterStalePendingErrors` so stale "Error: Pick a model before sending the first message." system frames from prior pre-model-pick send attempts no longer replay when the bubble re-opens.
  - `apps/desktop_flutter/test/features/tasks/issue_651_contract_test.dart` — extended to c6 (`isPendingAgent` + sentinel pure unit), c7 (`filterStalePendingErrors` keeps task-context system msg + drops "Error:" system frames when pending; passes through unchanged when not pending), c8a/c8b/c8c (`computeIsLocalSmokeRun` matrix: env-var honored only in debug; dart-define honored unconditionally; unset returns false). Original c1-c5 still pass.
  - `docs/ai/contracts/issue-651.json` — updated to PASS for c1-c4 + added c6-c8 entries.
- Checks run:
  - `flutter test test/features/tasks/issue_651_contract_test.dart` → 9/9 ✓ (was 4/4 before; +5 from c6/c7/c8 group)
  - `env -u RHYTHM_LOCAL_SMOKE flutter test` (full suite) → 293/293 ✓ (was 288 before; +5 from #651 extensions). NOTE: must run with `env -u` because launchd's user session env keeps re-injecting RHYTHM_LOCAL_SMOKE=1 into child processes spawned from this shell (the exact failure mode this PR is hardening against).
  - `ai-workflow checks --level pr` → analyze ✓, dart format ✓, api_server tsc ✓, api_server vitest ✓
- Diagnostic agent run (Tier 2/sonnet) returned `CATEGORY: C2, CONFIDENCE: high, EVIDENCE: tasks_repository.ts:1056,1062-1063, tasks_controller.ts:314`. Recorded at `.agent-stack/postmortems/2026-05-29-issue-651-shim-failed-v18.38.json`. Root cause turned out to be neither the suggested SQL no-op nor the type mismatch — the diagnostic agent's hypothesis space was correct for "why no SnackBar" but the actual cause (silenced watcher + correct 201 response) sat outside the diagnostic prompt's framing because the shim only catches >= 400.
- Decisions:
  - **Folded #652 into this PR.** Initially filed as separate follow-up; user pushed back on the artificial scope split ("the app working IS THE FUCKIN SCOPE"). The bubble's `__pending__` rendering surfaced the same week as a direct downstream of unsilencing the watcher; shipping a fix that drained 4 stale triggers into broken-looking bubbles would be a worse user outcome than fixing both at once. #652 closed as superseded.
  - **Env-var route refuses in release builds rather than being removed.** Could have deleted the env-var path entirely and forced all smoke configuration through `--dart-define`. Kept the env-var path for debug builds because (a) easier for ad-hoc `flutter run` smokes, (b) `--dart-define` rebuilds the bundle which is slow during interactive debugging. The warning + `kDebugMode` gate gives both ergonomics for dev and safety for shipped builds.
  - **Stale error filter keyed on prefix "Error:" rather than a new metadata field.** Persisted message rows don't have a "this came from ws_gateway error frame" flag (per #638 they're stored with `role='system'` and the user-readable error text). Adding a new column would require a migration + backfill. The prefix match is fragile-but-pragmatic; `Task context\nTitle:` (the legitimate #629 system message) doesn't start with "Error:" so the filter doesn't false-positive.
- Concerns:
  - DELETE /claude-triggers/:id returned 404 for the 4 backlogged triggers when the watcher first drained them (visible in the `/tmp/rhythm-stderr.log` capture). Eventually the queue emptied, but the "trigger will be retried" log lines suggest the backend's `findByIdAndUser` query may have a race with `listForUser`. Direct curl DELETE works correctly. **Filing as a separate follow-up issue** (orthogonal to this PR — the user-facing app works, the watcher just emits noise on the first poll cycle after a stale-trigger backlog).
  - `c5 manual smoke` still pending — needs user to retest on the v18.39 release.

### 2026-05-28 — fix/regression-ai-collab-chat (#651) — diagnostic+UX shim for vbeta.18.37 regression
- Branch off main at e368a72 (= vbeta.18.37). User reported a regression in vbeta.18.37: adding an AI account ("Visalia CRC") as a task collaborator did nothing — collaborator chip never appeared, agent chat bubble never opened, no error UI. The previously-shipped #644 fix is intact in source on this commit (every `CollaboratorsDataSource` site passes `ServerConfigService.url`; `baseUrl` is required). Production `/health` returns 200. The vbeta.18.36 → vbeta.18.37 diff does not change the collaborator path. Root cause of the regression cannot be pinpointed from source alone because every UI entry point silently swallows the thrown `AppError` from `assertOk`. This run ships a diagnostic+UX shim that surfaces the real failure so the next test reveals the root cause.
- Files modified:
  - `apps/desktop_flutter/lib/shared/widgets/collaborators_row.dart` — added `_formatCollaboratorError` helper; extracted long-press remove to `_attemptRemove(BuildContext, int)` with `try/catch` + `ScaffoldMessenger.showSnackBar`; refactored `_showPeoplePicker` to `await onAdd` inside `try/catch` and surface the message; wrapped the chip and the "+ collaborator" `IconButton` in `Builder`s so each has a live `BuildContext` for messenger lookup.
  - `apps/desktop_flutter/lib/app/core/ui/rhythm_inspector.dart` — imported `app_error.dart`; added `_formatInspectorError(Object)`; added `catch` clauses in `_showPeoplePicker` and `_removeCollaborator` that show a SnackBar with the error message, keeping the existing `finally` clause's loading-state reset.
  - `apps/desktop_flutter/test/features/tasks/issue_651_contract_test.dart` (new) — 4 widget tests, red→green proven: c1 (CollaboratorsRow add error → SnackBar), c2 (CollaboratorsRow remove error → SnackBar; bypasses Tooltip gesture arena by invoking the row's `onLongPress` callback directly), c3 (inspector add error → SnackBar), c4 (inspector remove error → SnackBar). c3/c4 drain non-assertion layout-overflow exceptions emitted by the inspector header at the test viewport so the SnackBar expectation can be evaluated cleanly.
  - `docs/ai/contracts/issue-651.json` (new) — 5 criteria, 4 automated + 1 manual.
  - `docs/ai/generated-issues/fix-collab-add-silent-failure-error-ui.md` (new) — describes the regression, the swallowed-error class, the diagnostic intent of this fix, and the four entry points covered.
- Checks run:
  - `flutter test test/features/tasks/issue_651_contract_test.dart` → 4/4 ✓ (red 0/4 before fix verified explicitly)
  - `flutter test` → 288/288 ✓ (was 284; +4 from #651)
  - `ai-workflow checks --level issue` → flutter analyze ✓, dart format ✓, api_server tsc ✓
  - `ai-workflow checks --level pr` → all above plus api_server vitest ✓
- Decisions:
  - Shipped a **diagnostic+UX shim**, not a guess at the root cause. The user's report ("most recent release", "silently didn't save", "Visalia CRC" who is the env-mapped agent user) plus the intact source code points to something we cannot see — stored `ServerConfigService.url`, expired auth, deployed-backend drift, or a permissions edge case. Any of those produce an `AppError` from `assertOk` that the silent UI throws away. The shim guarantees the next live test on vbeta.18.38 shows the actual status code + message, which becomes the root-cause signal.
  - Did NOT change the long-press-to-remove mechanism in `CollaboratorsRow` despite suspecting the Tooltip's internal `LongPressGestureRecognizer` may absorb the gesture in production (it does in widget tests). Out of scope for #651; the SnackBar surface is what the regression needs. If the long-press path itself is also broken, c5 manual smoke will reveal it.
- Concerns:
  - Root cause of the vbeta.18.37 regression is not fixed by this PR — only made visible. A follow-up issue will be filed once the user re-tests against vbeta.18.38 (or the debug build with this branch) and reports the surfaced error message.
- Manual smoke task: c5 (re-test the Visalia CRC add against the configured production server on a build that contains this shim; capture the SnackBar text verbatim).

### 2026-05-27 — workflow/run-2026-05-27 (#630, #635, #638, #648) — pending smoke (PR #649)
- Combined branch for four open Agents issues; all previous non-mobile issues confirmed already-implemented (7 closed on GitHub).
- Files modified:
  - `apps/api_server/src/services/agent_model_resolver.ts` (#648) — replaced invalid OpenRouter model id `google/gemini-3-flash` → `google/gemini-3-flash-preview` in `ROUTE_FALLBACKS_BY_AGENT['gemini-cli']`.
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (#638, #630) — (1) in `_buildTranscriptBody` hasChat=true branch, collect `role==system` entries from legacyTranscript and append them after chatMessages so WS error frames are visible regardless of which rendering path is active; (2) broadened QuestionToolCard dispatch from `toolName == 'question'` to also match `'askuserquestion'` (the name the opencode SDK actually emits).
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` (#635) — `sendInput()` now prepends an optimistic `role='input'` AgentSessionMessage to `_transcriptsBySession[sessionId]` before the WS send so the mini-bubble renders the user's message immediately.
  - `apps/desktop_flutter/lib/features/agents/views/_question_tool_card.dart` (#630) — `_parseQuestions` now extracts the `label` field from Map-typed option entries `{label, description}` in addition to bare String options.
  - `apps/desktop_flutter/lib/features/agents/views/_message_actions_row.dart` (side fix) — changed `MessageTimeTicker` from a module-level `_globalTimeTick` singleton to a per-widget scoped `ChangeNotifierProvider(create: ...)` so the timer is properly disposed with the widget tree (was leaking in test FakeAsync zone).
  - New contract tests: `issue_648_contract.test.ts` (3 vitest), `issue_635_contract_test.dart` (2 Flutter), `issue_630_contract_test.dart` (2 Flutter), extended `issue_638_contract_test.dart` (+c5 Flutter).
  - New contract JSONs: `docs/ai/contracts/issue-648.json`, `issue-635.json`, `issue-630.json`; updated `issue-638.json` (+c5).
- Checks run: flutter test 284/284 ✓; api_server vitest 545/545 ✓; flutter analyze --no-fatal-infos ✓ (0 errors/warnings, 209 infos only).
- Acceptance contracts: all four issues had failing tests before fix, all green after.
- Manual smoke task created in Rhythm: "Manual smoke: PR #649 — agent issues #630/#635/#638/#648".

### 2026-05-26 — fix/issue-643-645-agents-ui (#643, #645) — merged (PR #647)
- Combined branch off main for two PR #642 smoke follow-ups (both Agents UI, UI-local). Both smoked PASS (#643 popover scroll; #645 badge consistent across all four surfaces on re-smoke).
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/_slash_command_popover.dart` (#643) — the popover command list was unreachable when taller than the viewport. Root cause: it rendered in `Stack(clipBehavior: Clip.none) + Positioned(bottom:0)`, so the list painted OUTSIDE the Stack's bounds where Flutter does not route pointer/scroll hit-tests; and `ListView.builder(shrinkWrap:true)` left no scroll viewport. Fix: replaced Stack+Positioned with `Column(mainAxisSize:min)` (list above the input, within hit-testable bounds) and removed `shrinkWrap:true` so the `Container(maxHeight:240)` is the scroll viewport. Layout-safe: the composer sits below an `Expanded` transcript body, which shrinks to absorb the ≤240px growth (no RenderFlex overflow). UX change: overlay → inline command-palette.
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (#645) — the agent pill (`_AgentKindBadge`) kept the stale icon/label after the session's agent changed. Two bugs: (1) `context.read` (no rebuild subscription) → changed to `context.watch`; (2) it looked up `byId(session.agentId)`, but `setSessionModel` only updates `providerId`/`modelId`, never `agentId`. Fix: added a `providerId` param + top-level `_kProviderToAgentKind` map (anthropic/github-copilot→claude-code, openai→codex, google→gemini-cli) mirroring the server `ws_gateway.ts` `PROVIDER_TO_AGENT`; the badge maps `providerId`→agent-kind and prefers that config when it differs from `agentId`. 3 call sites pass `session.providerId`. Added `@visibleForTesting AgentKindBadgeTestHarness`.
  - New tests: `test/features/agents/issue_643_slash_command_scroll_test.dart` (scroll reachability), `test/features/agents/issue_645_agent_pill_stale_icon_test.dart` (pill label flips for real provider values). Contracts: `docs/ai/contracts/issue-643.json`, `issue-645.json`.
- Checks run: `ai-workflow checks --level issue` ✓; `ai-workflow checks --level pr` ✓ (analyze, dart format, tsc, vitest); both contract test files 6/6 ✓.
- Repair loop (TWO rounds on #645):
  1. **False-green (pre-commit):** the first #645 fix did `byId(session.providerId)` and the contract test injected `providerId='codex'` (an agent-kind), but production stores `providerId='openai'`/`'google'` (the LLM provider, distinct from `CatalogModelEntry.agent`). Caught by orchestrator trust-but-verify; refixed with a provider→agent-kind map and real-value tests.
  2. **Manual-smoke PARTIAL FAIL (post-commit, C2):** smoke showed the badge inconsistent across FOUR render sites — only `_SessionRow` had been threaded. `_ResumableSessionRow`, `_TranscriptHeader`, and the mini/expanded bubble (`agent_bubble_overlay.dart`) still showed a stale "Gemini CLI" after an errored model switch (session truly Claude). Postmortem `.agent-stack/postmortems/2026-05-26-issue-645.json`. Repair: threaded `providerId: session.providerId` into all `_AgentKindBadge` sites; added `providerId` to `AgentBubbleEntry` (populated in `_sync()` from the live session) + `_kBubbleProviderToAgentKind` + `_resolveAgentKind()` + `context.watch` in the bubble. Tests expanded 3→16 covering all four sites incl. c9 (errored switch → all sites show the persisted agent). Re-verified green; full agents suite 147/147.
  - Filed follow-up **#648** (catalog offers invalid model id `openrouter/google/gemini-3-flash` → ProviderModelNotFoundError) — distinct from the badge bug.
- Deviations: none. Manual-only edges (keyboard-nav scroll past fold, mouse-wheel, live picker interaction) listed in each contract's `not_tested`.

### 2026-05-26 — fix/issue-644-collaborator-server-url (#644)
- Files modified:
  - `apps/desktop_flutter/lib/features/tasks/data/collaborators_data_source.dart` — removed the implicit `AppConstants.apiBaseUrl` fallback, made `baseUrl` required, and added injectable `http.Client` support so collaborator requests are testable and cannot silently target the wrong server.
  - `apps/desktop_flutter/lib/features/tasks/views/tasks_view.dart`, `apps/desktop_flutter/lib/features/weekly_planner/views/weekly_planner_view.dart`, `apps/desktop_flutter/lib/features/dashboard/views/dashboard_view.dart` — task collaborator add/remove flows now construct `CollaboratorsDataSource` from `context.read<ServerConfigService>().url`.
  - `apps/desktop_flutter/lib/features/projects/views/projects_view.dart` — project collaborator add/remove flow now uses the configured server URL too, keeping the required constructor compile-clean and preventing the same fallback bug for project collaborators.
  - `apps/desktop_flutter/test/features/tasks/issue_644_contract_test.dart` — new contract test proving add/remove/fetch route to the injected configured base URL and not a hardcoded fallback.
  - `docs/ai/contracts/issue-644.json` — contract for c1 automated routing coverage and c2 live production trigger manual verification.
- Checks run:
  - `flutter test test/features/tasks/issue_644_contract_test.dart` → 4/4 ✓
  - `ai-workflow checks --level issue` → flutter analyze ✓, dart format ✓, api_server tsc --noEmit ✓
  - `ai-workflow checks --level pr` → flutter analyze ✓, dart format ✓, api_server tsc --noEmit ✓, api_server vitest ✓
  - Live c2 smoke via Computer Use → launched debug macOS app without `RHYTHM_LOCAL_SMOKE`; assigned Visalia CRC to task `Find subs for any remaining gaps`; inspector showed the `Visalia CRC` collaborator chip; terminal logged `AgentTriggerWatcher` handling new trigger id `17`; Agents view showed `Task 'Find subs for any remaining gaps' is waiting for an agent` and overlay count changed to `+1 more`.
- Decisions made:
  - Made `baseUrl` required instead of keeping a default because the default was the root cause: collaborator writes could hit a different server than the task list whenever Settings used a non-default URL.
  - Updated every production `CollaboratorsDataSource` construction site rather than only the task inspector, because the required constructor is the guard against this class of regression.
- Deviations from spec: none.
- Concerns: c2 is covered by live manual smoke, not deterministic automation, because it depends on production `claude-trigger` generation and the task-ready bubble path outside `RHYTHM_LOCAL_SMOKE`.

### 2026-05-26 — feat/issue-48-pco-automation-ux (#48)
- Files modified:
  - `apps/desktop_flutter/lib/features/tasks/views/automation_rules_view.dart` — (1) extended "Schedule in service week" day picker from Mon–Fri (options [1..5]) to Mon–Sun (options [1..7], added Saturday=6 and Sunday=7 labels); (2) replaced `helperText` placeholder hint on Task title template and Task notes template fields with clickable `{{token}}` ActionChip rows (new `_placeholderChips` helper + `_insertAtCursor` method); (3) wired `focusNode` params on title/notes template TextFields so chips can request focus and insert at cursor.
  - `apps/api_server/src/__tests__/issue_48_contract.test.ts` — new vitest contract test (3 tests: c1 multi-trigger fires both A and B; c2 targetDayOfWeek=4 with Sunday planDate yields Thursday of same week; c3 scalar trigger_key backward-compat still fires). All 3 green (engine already supported these semantics).
  - `apps/desktop_flutter/test/issue_48_contract_test.dart` — new Flutter widget test (4 tests: c4 PCO action dropdown excludes tag_task/send_notification/auto_schedule; c5 team+position FilterChips render; c6 Saturday+Sunday in day picker; c7 {{title}} chip inserts at cursor). All 4 green after implementation.
  - `docs/ai/contracts/issue-48.json` — new contract JSON (7 criteria, all automated, 0 manual).
- Checks run:
  - `ai-workflow checks --level issue` → flutter analyze ✓, dart format ✓, tsc --noEmit ✓
  - `npx vitest run src/__tests__/issue_48_contract.test.ts` → 3/3 ✓
  - `flutter test test/issue_48_contract_test.dart` → 4/4 ✓
  - `ai-workflow checks --level pr` → all checks ✓
- Decisions made:
  - Sub-changes 1 (multi-select triggers), 2 (multi-select team+position), and 4 (PCO action cleanup) were already implemented in the view. The backend engine already supported triggerConfig.triggerKeys and targetDayOfWeek. Only c6 (day picker Mon–Sun) and c7 (clickable placeholder chips) needed new implementation.
  - Used ISO weekday numbers 1–7 (1=Mon, 7=Sun) matching the existing `scheduleToWeekdayInSameWeek` function in the engine — same convention, no engine changes needed.
  - `_insertAtCursor` uses `TextEditingValue` to insert at cursor position and handles collapsed and range selections. Focus is requested after insert so keyboard stays visible.
  - `_placeholderChips` reuses `_availableTemplateTokens()` for source-appropriate token list — automatically correct for all sources (Gmail, PCO, Calendar).
- Deviations from spec: none. The issue called `actionConfig.dueWeekday` but the existing engine field name is `actionConfig.targetDayOfWeek`; the spec was using a shorthand — kept the existing name.
- Concerns: The day picker dropdown for c6 renders inside a scrollable dialog; the widget test needed `ensureVisible` + `warnIfMissed: false` to tap it (it's below the default 600px test viewport). This is expected test-environment behavior, not a production issue.

### 2026-05-26 — fix/issue-631-slash-command-popover-empty (#631)
- Files modified:
  - `apps/api_server/src/services/opencode_client_service.ts` — added `listCommands()` method that guards on `!this.client` (returns []), casts the client to access `command.list()` (SDK type doesn't surface `command` via CommonJS import), unwraps the `{data, error}` envelope, maps to `{name, description}`, wraps in try/catch with logger.warn → returns [].
  - `apps/api_server/src/app.ts` — replaced hard-coded `res.json([])` placeholder in `GET /opencode/commands` with `async (_req, res)` that calls `await opencodeClient.listCommands()` and returns the array; retains outer try/catch for resilience.
  - `apps/api_server/src/__tests__/issue_631_contract.test.ts` — new vitest contract test (4 tests): c1 (returns [] when not ready), c2 (maps to {name, description}), c3 (returns [] on error), c4 (route calls listCommands not hard-coded []). Red proven: 4/4 fail before fix. Green: 4/4 pass after.
  - `docs/ai/contracts/issue-631.json` — new contract JSON (5 criteria, 4 automated, 1 manual).
- Checks run:
  - `ai-workflow checks --level issue` → flutter analyze ✓, dart format ✓, tsc --noEmit ✓
  - `npx vitest run src/__tests__/issue_631_contract.test.ts` → 4/4 ✓ (red: 4 fail before fix)
  - `ai-workflow checks --level pr` → all checks ✓ (539/539 vitest, was 535)
- Decisions made: cast `this.client` to `Record<string, { list: () => Promise<unknown> }>` to access `command.list()` — the SDK's exported `OpencodeClient` type doesn't surface `command` through CommonJS import resolution, but the runtime object has it (sdk.gen.d.ts:391 confirms `command: Command`). This matches the pattern used in existing dynamic-import cast sites throughout the file. The route try/catch is outer-only (not wrapping listCommands again) since listCommands is already resilient internally.
- Deviations from spec: none. Exact envelope unwrap pattern (`raw.data ?? []`) matches existing methods. Guard condition is `!this.client` not `!this.isReady` — same as `listProviders`.
- Concerns: The SDK's `command.list()` result envelope shape (`{data: Array<Command>}`) was inferred from the CommandListResponses type in types.gen.d.ts. If the SDK changes the envelope schema, `raw.data ?? []` will silently return []. A warning log fires in the catch path, so failures are visible in server logs.

### 2026-05-26 — fix/issue-629-task-context-system-message (#629)
- Files modified:
  - `apps/api_server/src/controllers/agent_sessions_controller.ts` — captured returned `Task` from `findByIdIncludingLegacy` (was discarding it; c.137); after `repo.insert(dto)` and before the agent-less early return, appended a `'system'` message via `messagesRepo.append(session.id, 'system', text, text)` where text is `"Task context\nTitle: <title>\n\n<notes>"` (notes paragraph omitted if null). Fallback: when taskId is not in local DB but taskTitle is provided, the provided taskTitle is used instead. The `'system'` role is display-only — never sent to SDK — so this cannot cause #624.
  - `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart` — added `isSystem` branch in `_MiniMessageBlock.build()` rendering a muted italic text block (matches the `agents_view.dart` `_MessageBlock` system render style). The full-view `_MessageBlock` already handled `role=='system'` (lines 1673-1685) — no change needed there.
  - `apps/api_server/src/__tests__/issue_629_contract.test.ts` — new vitest contract test (4 tests): c1 (title in system msg), c2 (notes in system msg), c3 (taskTitle fallback when FK miss), c4 (no extra promptAsync for agent-less session). Red proven on current code before fix.
  - `docs/ai/contracts/issue-629.json` — new contract JSON (5 criteria, 4 automated, 1 manual).
- Checks run:
  - `ai-workflow checks --level issue` → flutter analyze ✓, dart format ✓, tsc --noEmit ✓
  - `npx vitest run src/__tests__/issue_629_contract.test.ts` → 4/4 ✓ (red: 3 fail before fix; green: 4/4 after)
  - `npx vitest run` (full suite) → 535/535 ✓
- Decisions made: placed the system message append BEFORE the agent-less early return so both agent-less (task bubble path) and agent-assigned sessions get the context. Used an inline block `{ }` around the append logic to keep scope clean. The `resolvedTask` variable uses an inline `import('../models/task').Task` type reference to avoid adding a top-level import for a type that's only used in one spot.
- Deviations from spec: none. The spec called for `messagesRepo.append(session.id, 'system', text, text)` exactly as implemented.
- Concerns: `resolvedTask?.notes` may be empty string (`""`); guarded with `notes.trim()` check before appending the notes paragraph. The fallback path (c3) uses `typeof taskTitle === 'string' && taskTitle` to avoid appending a system message when taskTitle is an empty string.

### 2026-05-20 — fix/pr-617-fifth-round-smoke (#638 c4)
- Fifth-round smoke on commit 4f921ac surfaced: #638 still fails for newly-created sessions despite the c3 race-merge fix. Root cause is upstream of the controller: api_server's `streamBridge.streamSession()` was fire-and-forget, so the SSE listener loop wasn't subscribed when `promptAsync` fired immediately after. SDK-level errors (e.g. "Model not found") arrived before the bridge could resolve `localSessionId`, so the WS broadcast went out with the SDK UUID and the Flutter client couldn't route it.
- Files modified:
  - `apps/api_server/src/controllers/agent_sessions_controller.ts` — two call sites (`createSession` ~L251 and `resumeSession` ~L565) changed from `streamBridge.streamSession(...).catch(...)` to `await streamBridge.streamSession(...)` with try/catch. `streamSession` resolves promptly after `subscribeToEvents` completes (the long-running `_listen` for-await loop is fire-and-forget *inside* `streamSession`), so awaiting it doesn't block — it just guarantees the listener is consuming events when `promptAsync` fires (#638 c4).
- New tests/contracts: `docs/ai/contracts/issue-638.json` c4 added; `apps/api_server/src/__tests__/issue_638_contract.test.ts` (new server-side vitest with 2 assertions). Both assertions FAIL on commit 4f921ac and PASS after this commit.
- Checks run: `tsc --noEmit` ✓, `flutter analyze --no-fatal-infos` ✓ (no new warnings/errors), `dart format` ✓, `npx vitest run` 529/529 ✓ (was 527 baseline + 2 new c4 tests), all 7 flutter contract tests for #638 + #639 ✓.
- Decisions made: chose awaiting `streamSession` over restructuring `streamSession` itself or making the bridge buffer pre-listener events. `streamSession`'s contract (resolves once subscription is established; _listen is internal fire-and-forget) makes await safe and the call-site fix surgical.
- Deviations from spec: none.
- Follow-up still open: #635 (mini-bubble user messages) deferred.

### 2026-05-20 — fix/pr-617-fourth-round-smoke (#638 c3, #639 c3)
- Fourth-round smoke on commit 987cfe8 surfaced two remaining gaps: (#638) full-view error frame works for old sessions but NEW sessions silently swallow the error; (#639 c2) Settings visibility toggle doesn't refresh the picker.
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — `selectSession` and `reconnectSession` now MERGE REST messages with locally-appended WS frames instead of unconditionally overwriting. The merge keeps any existing entry whose id is NOT in the REST result's id set. WS-synthesized error frames carry `id: 0`; REST persisted messages have positive server ids; so locally-appended frames survive. Also added a `_disposed` guard in `_loadModelRoutes` to prevent post-teardown notifyListeners (#638 c3).
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — `refreshModelRoutes()` now also calls `refreshCatalog()` so the unified cross-agent `_catalog` cache (from PR #602) is refreshed when Settings visibility changes, not just the per-session `_modelRoutes` (#639 c3).
- New tests/contracts: `docs/ai/contracts/issue-638.json` c3 added; `issue-639.json` c3 added; matching new test groups in the existing contract test files. Both new tests FAIL on commit 987cfe8 and PASS after this commit.
- Checks run: `tsc --noEmit` ✓, `flutter analyze --no-fatal-infos` ✓ (194 info-only, no warnings/errors), `dart format` ✓, `npx vitest run` 527/527 ✓, all 7 flutter contract tests for #638 + #639 ✓.
- Decisions made: chose merge-by-id-set over a "skip-overwrite-if-empty" check because the merge is correct in all cases (handles late WS frames after REST returns persisted messages, not just the new-session race). The 4-line patch lands identically at both call sites. Added the `_disposed` guard in `_loadModelRoutes` because the async fire-and-forget tail was triggering post-teardown crashes when the test harness disposed the controller mid-fetch.
- Deviations from spec: none.
- Follow-up still open: #635 (mini-bubble hides user messages) — diagnosis stalled at server-query investigation. Out of scope.



### 2026-05-20 — fix/pr-617-third-round-smoke (#638, #639)
- Third-round smoke on commit 2d5c7d6 surfaced: (a) the #636 error frame rendered in the mini-bubble but not in the full Agents view, and (b) the OpenRouter picker section showed duplicate routes the user has direct auth for, and didn't update when Settings visibility changed. Two new tickets filed (#638, #639), both fixed here.
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart:1197` — changed `final legacyTranscript = controller.transcript;` to `final legacyTranscript = controller.transcriptFor(session.id);`. The full-view transcript now reads from the same per-session store the mini-bubble uses, bypassing the `_selectedSessionId == msg.id` race that caused `WsErrorMessage` frames to be dropped when session selection was briefly out of sync (#638).
  - `apps/api_server/src/routes/agents_models_routes.ts` — both the root `GET /agents/models` handler and the `GET /agents/models/catalog` handler now drop openrouter aggregator entries whose modelId prefix matches a directly-authed provider. Concretely: when authedSet contains `anthropic`, `anthropic/claude-opus-4.7` via openrouter is suppressed. Avoids duplicate routes that the user can hit directly through their provider auth (#639 c1).
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — added public `Future<void> refreshModelRoutes()` method that re-invokes the private `_loadModelRoutes(_selectedSessionId!)` when a session is selected (#639 c2).
  - `apps/desktop_flutter/lib/features/agents/views/_open_router_models_section.dart` — `_setVisible` now calls `context.read<AgentsController>().refreshModelRoutes()` after a successful `patchVisibility`. The picker is already `Consumer<AgentsController>` so it rebuilds immediately on `notifyListeners()` (#639 c2).
- New tests/contracts: `docs/ai/contracts/issue-638.json`, `issue-639.json`; test files: `apps/desktop_flutter/test/features/agents/issue_638_contract_test.dart` (widget pump of full AgentsView; FAILS before fix on `find.textContaining('Model not found')` finding 0 widgets), `apps/api_server/src/__tests__/issue_639_contract.test.ts` (server dedup), `apps/desktop_flutter/test/features/agents/issue_639_contract_test.dart` (client refresh).
- Checks run: `tsc --noEmit` ✓, `flutter analyze` ✓, `dart format` ✓, `npx vitest run` 527/527 ✓ (was 522 baseline + 5 new contract tests), all 10 flutter contract tests ✓.
- Decisions made: #638 contract redone after first acceptance-contract pass produced regression-guard tests that passed today — the discipline requires the contract test to FAIL before implementation. Used a `testWidgets` pump of the real `AgentsView` with a hanging `getSession` repository so the controller stays in the intermediate state where the bug manifests. #639 server dedup applied symmetrically to both `/` and `/catalog` handlers so the picker and Settings AI Account page see consistent shapes.
- Deviations from spec: none.
- Follow-up still open: #635 (mini-bubble hides user messages) — diagnosis stalled at server-query investigation. Out of scope for this batch.

### 2026-05-20 — fix/pr-617-633-smoke-followups (#634, #636, #637)
- Smoke on commit 6a05544 surfaced 4 FAILs. Three fixed here; #635 deferred (needs server-side query investigation, separate PR). Postmortem: `.agent-stack/postmortems/2026-05-20-pr-617-633-batch.json`.
- Files modified:
  - `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart` — removed `maxLines: 5` + `overflow: TextOverflow.ellipsis` from `_MiniMessageBlock` assistant branch and `maxLines: 10` + `overflow: TextOverflow.ellipsis` from `_MiniLiveBlock`. The bubble's existing 460px Expanded+ListView envelope handles overflow by scrolling rather than clipping (#634).
  - `apps/api_server/src/services/opencode_stream_bridge.ts` — `session.idle` handler now broadcasts `{v:1, type:'error', id, message:'The model returned an empty response.'}` when `pendingText` is empty (zero tokens streamed this turn). Gated on `!erroredSessions.has(localSessionId)` so we don't double-emit when `session.error` already fired. Catches the OpenRouter Gemini 3 Flash silent-close case where the SDK returns a data envelope but emits idle without any `message.part.delta` (#636).
  - `apps/api_server/src/routes/agents_models_routes.ts` — `GET /agents/models?agentId=...` root handler now runs the same curated-promotion block that `/catalog` runs: visibility-table rows with `visible=1`, confirmed by the SDK's live OpenRouter catalog, are emitted with `agent` derived from the model id prefix (openai/→codex, google/→gemini-cli, else claude-code), filtered to match the requested agentId. Same conservative gate as #632: skip when SDK catalog is empty (#637 Bug A).
  - `apps/desktop_flutter/lib/features/agents/views/_open_router_models_section.dart:80` — `_isVisible` default flipped from `?? true` to `?? false`. Models with no visibility row are now opt-in (unchecked) instead of "all visible by default" (#637 Bug B).
- New tests/contracts: `docs/ai/contracts/issue-634.json`, `issue-636.json`, `issue-637.json`; test files: `apps/desktop_flutter/test/features/agents/issue_634_contract_test.dart`, `apps/api_server/src/__tests__/issue_636_contract.test.ts`, `apps/api_server/src/__tests__/issue_637_contract.test.ts`, `apps/desktop_flutter/test/features/agents/issue_637_contract_test.dart`.
- Checks run: `tsc --noEmit` ✓, `flutter analyze` ✓, `npx vitest run` 522/522 ✓ (was 517 baseline + 5 new contract tests), all 5 Dart contract tests ✓.
- Decisions made: #636 fix uses `pendingText` map as the "did we stream anything this turn" signal — empty after idle means zero tokens — same convention as the existing flush-on-idle path. Avoided adding a separate turn-start flag. #637 Bug A replicated /catalog's promotion block in /root rather than asking the picker to merge two endpoints — keeps the wire format symmetric and reduces Flutter-side complexity.
- Deviations from spec: none.
- Follow-up still open: #635 (mini-bubble hides user messages) — diagnostic agent's optimistic-echo hypothesis was wrong; renderer at agent_bubble_overlay.dart:880-901 already handles `role=='input'`. Real cause is upstream (server query or persistence), needs ~15-min investigation in its own PR.

### 2026-05-19 — fix/pr-617-batch-smoke-followups (#627, #628, #632, #633)
- Smoke on PR #617 batch surfaced 5 FAIL/PARTIAL + 1 new bug + 1 latent launch regression. Postmortem at `.agent-stack/postmortems/2026-05-19-pr-617-batch-smoke.json`. Dominant pattern: C1 missing-contract (acceptance-contract skipped for the batch) — recorded as W1 in workflow_adherence.
- Files modified:
  - `apps/desktop_flutter/macos/Runner/AppDelegate.swift` — removed invalid `super.applicationDidFinishLaunching(notification)` call (latent regression from PR #473, ea206d0; caused black-screen launch). User-applied fix; committed in this batch (#633)
  - `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` — `_findServer` no longer prefers a stale local `dist/server.js` in dev mode; always uses `npx tsx src/server.ts` against source. Production .app bundle path unchanged (still uses bundled dist as built by CI) (#627)
  - `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart` — `_ExpandedSessionBubbleState.initState` now schedules `agents.reconnectSession(sessionId)` via post-frame callback so cold mini-bubbles back-fill historical messages on expand (#628)
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — `reconnectSession` notifies listeners unconditionally after writing `_transcriptsBySession[id]`; previously gated on `_selectedSessionId == id` so cold bubbles never rebuilt (#628)
  - `apps/api_server/src/services/opencode_client_service.ts` — `promptAsync` tightened: returns `false` (with warning log) when SDK response carries neither `error` nor `data` (silent no-op case from OpenRouter on unrecognized model ids) (#632)
  - `apps/api_server/src/routes/agents_models_routes.ts` — removed `skipLiveCheck` permissive bypass in `GET /catalog` curated-entries block. When SDK openrouter catalog is empty, NO curated entries are promoted — defer rather than admit unverified ids (#632)
- New tests/contracts: `apps/desktop_flutter/test/features/agents/issue_628_contract_test.dart`; `apps/api_server/src/__tests__/issue_632_contract.test.ts`; `docs/ai/contracts/issue-628.json`; `docs/ai/contracts/issue-632.json`
- Checks run: `tsc --noEmit` ✓, `flutter analyze` ✓, `npx vitest run` 511 passed / 6 pre-existing failures (confirmed identical on baseline 61c468f), contract tests #628 (1/1) ✓ and #632 (3/3) ✓, `npm run build` ✓, smoke probes against fresh tsx :4001 — `/health` 200, `/agents/capabilities` 200, `POST /sync/now` 200 ✓
- Decisions made: dev-mode tsx preference makes source changes immediately visible in the Flutter-spawned :4001 (no manual `npm run build` step). Removed skipLiveCheck rather than tightening — conservative gate is correct even if it briefly hides valid ids during SDK startup race.
- Deviations from spec: #628 widget-level wiring (c1b) covered by manual smoke not unit test — pumping the private state class has higher bug surface than the 3-line fix.
- Follow-ups still open: #629 (task linkage — OUT-OF-SCOPE for this PR), #630 (question tool — BLOCKED upstream SDK), #631 (slash popover empty — OUT-OF-SCOPE; endpoint is hard-coded `[]` placeholder).

### 2026-05-19 — feat/agents-per-message-action-row (#606)
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/_message_actions_row.dart` — new file; `MessageActionsRow` StatefulWidget with Copy icon (flash animation), Bell/notify toggle, relative timestamp; `MessageTimeTicker` wrapper using a global `_TimeTick` ChangeNotifier (single `Timer.periodic` shared across all rows); `_relativeTime` helper (just now / Xm / Xh / full date).
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — wired `MessageActionsRow` and `MessageTimeTicker` into `_buildTranscriptBody`; `copyText` computed from parts before `_ChatBubble` call; action row inserted in Column after bubble, inside `ListView.builder`.
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — `_notifyOnCompletion` Set<String>, `isNotifyArmed`, `toggleNotify`, `_fireArmedNotifications`; `LocalNotificationService.showMessageNotification` called when session finishes working with armed messages.
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: used a single global `_TimeTick` ChangeNotifier (one Timer for all rows) instead of per-bubble timers to avoid timer proliferation in long transcripts. Action row is outside `_ChatBubble` (in the ListView itemBuilder Column), not inside, to keep `_ChatBubble` a pure renderer. Notify key format is `"$sessionId:$messageId"` to scope flags per session.
- Deviations from spec: none — all acceptance criteria implemented; action row not shown for "…" placeholder (empty children guard in `_ChatBubble` returns early before the Column wrapping the row is reached).
- Concerns: `_globalTimeTick` is a module-level singleton — it runs for the app lifetime even when no chat is visible. Overhead is minimal (one tick per minute, no widget rebuild unless `MessageTimeTicker` is in tree). Timer is properly cancelled in `_TimeTick.dispose()` but dispose is never called on the singleton; acceptable for a long-lived app-level resource.

### 2026-05-19 — feat/agents-archive-ui (#601)
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — added `_confirmDelete` method and "Delete permanently" `PopupMenuButton` to `_ArchivedSessionRow` so hard-delete is available from archived rows; all other acceptance criteria were already implemented on this branch
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: All archive infrastructure (model `archivedAt` field, data source `archiveSession`/`unarchiveSession`, controller `archiveSession`/`unarchiveSession`/`loadArchivedSessions`/`archived` getter, WS `session.updated` routing, collapsible Archived section in `_SessionListPanelState`, `_SessionRowMenu` with Archive + Delete items, `_ArchivedSessionRow` with Restore button) was already implemented in prior runs on this branch (#605 WS broadcasts). The only gap was "Delete permanently" on archived rows — added as a `PopupMenuButton` with confirm dialog.
- Deviations from spec: none — all four acceptance criteria satisfied
- Concerns: none; the `deleteSession` controller method handles archived rows correctly (removes from `_sessions` but `_archived` is managed by WS `session.removed` broadcast; optimistic local removal works because `deleteSession` filters all three lists indirectly via WS)

### 2026-05-19 — fix/sync-production-task-mirror (#620)
- Files modified:
  - `apps/api_server/src/config/env.ts` — added `prodApiUrl` and `prodAuthToken` fields (read from `PROD_API_URL` / `PROD_AUTH_TOKEN` env vars); defaults to `null` so existing deployments are unaffected
  - `apps/api_server/src/services/sync_orchestrator_service.ts` — added `mirrorProductionTasksAsync()` method and `fetchProductionTasks()` helper; `runSync()` now calls the mirror before integrations loop. Pagination: fetches pages of 100 until a page is shorter than the limit. Upsert strategy: tasks whose ID already exists verbatim in local DB (pre-split) are updated in-place; new tasks are inserted as `source_type='prod_mirror'` + `source_id=<prod uuid>` so subsequent syncs are idempotent.
  - `apps/api_server/src/jobs/sync_orchestrator_job.ts` — cron tightened from `*/30` to `*/10` minutes (issue: 30-min window is too large)
  - `apps/api_server/src/controllers/sync_controller.ts` — new; `POST /sync/now` handler; calls `mirrorProductionTasksAsync()` synchronously and fires `runSync()` in background; returns `{ status, upserted, skipped }`
  - `apps/api_server/src/routes/sync_routes.ts` — new; mounts `/sync/now`; respects `AGENT_LOCAL` bypass same as all other agent-local routes
  - `apps/api_server/src/app.ts` — added `syncRouter` import and `app.use('/sync', syncRouter)`
  - `apps/api_server/src/services/__tests__/sync_orchestrator_service.test.ts` — new; 6 unit tests covering: first-sync upsert, idempotency, pagination, no-op when env unconfigured, graceful failure on network error, in-place update for pre-split tasks
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓. Vitest: pre-existing ABI mismatch (`better-sqlite3` compiled for NODE_MODULE_VERSION 127, runtime requires 137) prevents all SQLite-based tests from running in this environment; this is a known pre-existing condition affecting ALL tests in the repo, not introduced here.
- Decisions made: root cause is architectural — `SyncOrchestratorService` never had production task mirroring; the local SQLite only had tasks created locally or pre-split. Fix adds OPTIONAL mirroring (no-op when env vars absent) so existing deployments are unaffected. `source_type='prod_mirror'` is used rather than inserting with the original UUID to keep upsert idempotent without collision risk against locally-created tasks with the same UUID; verbatim-ID tasks (pre-split) are handled as a special case. Cron tightened to */10 + manual `/sync/now` endpoint added as dual mitigation.
- Deviations from spec: none
- Concerns: `mirrorProductionTasksAsync()` fetches ALL tasks in pages — for very large task lists this could be slow. No incremental sync (e.g. `updatedSince`) because the production API endpoint (`GET /tasks`) doesn't expose a filter param. A future incremental-sync feature would require a server-side `updated_since` query param. The test file is logically correct but cannot execute in this CI environment due to the pre-existing better-sqlite3 ABI issue.

---

### 2026-05-19 — feat/agents-session-ws-events (#605)
- Files modified: none — all implementation was already committed to this branch prior to this coding-agent run.
  - `apps/api_server/src/services/ws_gateway.ts` — exports `broadcastSessionUpdated(session)` and `broadcastSessionRemoved(id)` helper functions.
  - `apps/api_server/src/controllers/agent_sessions_controller.ts` — imports and calls `broadcastSessionUpdated` in `remove` (soft-close) and `update` (PATCH, including archive toggle), and `broadcastSessionRemoved` in `destroy` (hard-delete).
  - `apps/desktop_flutter/lib/features/agents/models/agent_ws_message.dart` — `SessionUpdatedMessage` and `SessionRemovedMessage` classes with `fromJson` factories; both registered in `AgentWsMessage.parse` switch.
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — `_onWsMessage` handles `SessionUpdatedMessage` (upsert via `_upsertById` across sessions/resumable/archived based on archivedAt/status) and `SessionRemovedMessage` (filter from all three lists + clean up liveOutputBuffer, sessionFirstSeenAt, selectedSessionId).
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✗ (pre-existing errors in out-of-scope files `sync_orchestrator_service.ts` and `sync_routes.ts`; owned files compile clean).
- Decisions made: this coding-agent run confirmed all changes already in place. Stream bridge status transitions deferred per issue spec (no trivial hook; regression risk). Follow-up needed: "emit session.updated on stream bridge status transitions".
- Deviations from spec: stream bridge transitions deferred as spec allowed.
- Concerns: pre-existing TypeScript errors in out-of-scope files cause `ai-workflow checks` to show failure; owned code is clean.

---

### 2026-05-19 — fix/server-bundled-sentinel-abi-fallback (#615)
- Files modified:
  - `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` — implementation was already present from commit `726a5c4` ("fix(server): lifecycle cleanup + ABI-matched Node selection"). No code change was needed; coding-agent verified completeness and ran checks.
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓ (0 errors), `dart format` ✓ (0 changes), `tsc --noEmit` ✗ (pre-existing errors in out-of-scope unstaged WIP files `sync_orchestrator_service.ts`, `sync_routes.ts`, `sync_controller.ts`; owned `api_server_service.dart` compiles clean)
- Decisions made: Issue #615 was fully implemented in commit `726a5c4` on 2026-05-16. The implementation covers: (1) `_readRuntimeSentinelFull()` probes both dev walk-up path and `Resources/api_server/.node-runtime.json` bundled path; (2) `File(sentinelNodePath).existsSync()` validation; (3) `_findAbiMatchedNode()` scans candidates + `which node` login-shell fallback with `node -e 'process.stdout.write(process.versions.modules)'`; (4) Rich rebuild error message when no ABI match found.
- Deviations from spec: none — all four acceptance requirements satisfied in existing code
- Concerns: ABI fallback startup time: `_findAbiMatchedNode` runs `which node` via login shell + probes up to 4 Node binaries; login shell spawn is ~100-200ms and each `node -e` probe is ~50-100ms. Total overhead on worst-case path: ~500ms. Results are not cached between app launches (no persistent cache). In practice this path only runs when the sentinel's nodePath is missing (e.g. Node uninstalled/moved), so it's not on the hot path.

---

### 2026-05-19 — fix/lifecycle-terminate-spawned-processes (#614)
- Files modified: none — all implementation was already committed in prior coding-agent runs on this branch
  - `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` — `stopGracefully()` (SIGTERM→2s→SIGKILL), `_killOrphanIfPresent()` (orphan-port reclaim on boot with PPID=1 check)
  - `apps/desktop_flutter/lib/main.dart` — SIGINT/SIGTERM signal handlers; `didChangeAppLifecycleState(detached)` calls `stopAndDispose()`
  - `apps/desktop_flutter/lib/app/core/layout/app_shell.dart` — `WindowListener.onWindowClose()` with `preventClose=true`; calls `AgentServerController.stopAndDispose()` then `windowManager.destroy()`
  - `apps/api_server/src/server.ts` — SIGTERM/SIGINT shutdown handler: stops cron jobs, calls `opencodeClient.dispose()`, closes WS server, closes HTTP server with 1s force-exit fallback; parent-PID watchdog (polls ppid every 2s; self-shuts on orphan)
  - `apps/api_server/src/services/opencode_client_service.ts` — `dispose()` calls `server.close()` to kill the opencode subprocess on :4096
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: all lifecycle work was already in place from prior runs in this batch. This coding-agent run confirmed completeness by reading all owned files, then ran validation.
- Deviations from spec: none
- Concerns: `didChangeAppLifecycleState(detached)` is a best-effort last resort; Cmd+Q flows through `onWindowClose` which is the primary graceful path. Force-quit (Cmd+Opt+Esc) cannot be intercepted but is handled by the startup orphan-reclaim logic.

---

### 2026-05-19 — fix/agents-ws-gateway-model-follow-up (#624)
- Files modified:
  - `apps/api_server/src/services/ws_gateway.ts` — two changes: (1) in the `__pending__` block, persist `providerId`+`modelId` on the session row when the first turn resolves agent kind, so follow-up turns use `resolveModelForSessionTurn`'s session-level path instead of falling back through the authed-provider list; (2) after model resolution, added a guard that sends a `type: 'error'` WS frame and returns early if `model` is `undefined` (unknown agentKind not in resolver catalog), with a `console.log` logging the resolved route for every turn to make silent failures visible
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: fix by code-review only (no opencode SDK available for live reproduction). Root-cause theory: `__pending__` sessions' first `session.input` carries `perTurnOverride` but never persisted `providerId`/`modelId` on the session row; follow-up turns (no override) fell back to `resolveModelForAgent` which could return a different model or `undefined` for unknown agent kinds. Added both the persistence fix and the defensive guard. Analogous to commit `40d4fee` which added model resolution in the first place.
- Deviations from spec: none
- Concerns: live reproduction requires the opencode SDK; manual smoke at end of batch will confirm. The `updateFields` call in the `__pending__` block is best-effort (wrapped in try-catch); if it fails, the follow-up will still use `resolveModelForAgent` as fallback. The new guard for `undefined` model will surface previously-silent failures as a WS error frame.

---

### 2026-05-19 — feat/agents-question-tool-selector (#622)
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/_question_tool_card.dart` — new file; `QuestionToolCard` StatefulWidget; parses `toolArgs.questions[]` into interactive answer buttons; submits via `AgentsController.sendInput`; shows "Answered: <label>" stub after selection; handles multi-question batch flows
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — added `sessionId` param to `_ChatBubble`; routing in tool-part loop: `toolName == 'question'` → `QuestionToolCard`, else → `ToolCallPart`; added import for `_question_tool_card.dart`; updated `_buildTranscriptBody` call site to pass `session.id`
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: tool lookup key is `part.toolName?.toLowerCase() == 'question'` (case-insensitive match for the SDK's tool name); submission goes via existing `controller.sendInput(sessionId, text)` — no new controller methods; `session.input` is the only upstream path in the WS gateway (see `ws_gateway.ts`); a TODO comment marks the spot to switch to a dedicated tool-result path if one is added later (#622 follow-up)
- Deviations from spec: "free-text Other" not implemented — the SDK's `question` tool schema doesn't expose a free-text field in `toolArgs`; spec item is aspirational. Multi-select via checkboxes replaced by multi-question sequential selection (each question still gets exactly one answer per the SDK contract).
- Concerns: submission path uses `session.input` which triggers a new agent turn rather than a true tool-result reply. This is the only path available in the current WS gateway. If the SDK exposes a `question.answer` or `tool.result` event type in the future, `_submit()` in `_question_tool_card.dart` is the one place to update.

---

### 2026-05-19 — feat/agents-bubble-agentless-session (#623)
- Files modified:
  - `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart` — replaced `startAgent(String agentId)` + multi-button layout with `_openChat()` that creates an agent-less session (`agentId: null`); single "Open chat" button; simplified `_bubbleHeight` to a fixed getter
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: preferred-agent default not plumbed — `PendingTrigger` / `AgentBubbleEntry` carry no `preferredAgentId`; wiring it into the composer would require touching `agents_view.dart` (out of scope); left `TODO(#623 follow-up)` comment in `_openChat()`
- Deviations from spec: preferred-agent default for claude-trigger payloads deferred (spec said "if no clean way, leave a TODO" — done)
- Concerns: none; `createSession(agentId: null)` path already verified working server-side per PR #617/#602

---

### 2026-05-19 — fix/agents-bubble-transcript-per-session (#625)
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — added `_transcriptsBySession` map and `transcriptFor(sessionId)` getter; updated all `_transcript` write sites (reconnect, selectSession, TranscriptAppendMessage, WsErrorMessage) to also write per-session
  - `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart` — replaced `agents.transcript` + `isSelected` gate with `agents.transcriptFor(sessionId)` so bubble always shows its own session's transcript
- Checks run: `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: added `_transcriptsBySession` as an additive map alongside the existing `_transcript` flat list; `_transcript` retained unchanged for backward compat with the main Agents tab view; both stores are updated in lock-step at every write site
- Deviations from spec: none
- Concerns: `_transcriptsBySession` grows unbounded for long-running sessions with many messages (same as `_liveOutputBuffer`); no concern for typical church-staff use; same behavior as existing `_liveOutputBuffer`.

---

## Current Status (2026-06-12 — watchdog --parent-pid fix: MERGED PR #684)

🟢 **[PR #684](https://github.com/ajhochy/Rhythm/pull/684) merged to `main`** — `--parent-pid` watchdog fix. Server CI + Desktop CI green.

- **Root cause fixed:** In dev mode (`flutter run`), Flutter→npx→tsx→Node chain meant `process.ppid` was never 1 from the Node process's perspective; the `ppid===1` watchdog never fired on Cmd+Q. Production (direct Flutter→Node) was already correct per code analysis.
- **Fix:** `ApiServerService.start()` passes `--parent-pid=${pid}`; `server.ts` watchdog probes it with `process.kill(trackedRootPid, 0)` / ESRCH. Legacy fallback retained for older launchers.
- **Manual smoke pending (c5):** `flutter run -d macos` → Cmd+Q → `lsof -iTCP:4096 -sTCP:LISTEN` should return no results.

## Prior Status (2026-06-11 — #674 + #675 SHIPPED: merged, deployed, released v18.43, smoke PASS)

🟢 **[PR #676](https://github.com/ajhochy/Rhythm/pull/676) merged to `main`** (commit `64c6b06`), API image published + **manually deployed on the Synology**, desktop **v18.43** released (signed/notarized DMG). Manual smoke **PASS** on 2026-06-11 after one environment hiccup (below). Issues #674/#675 closed.

- **#674** (POST /tasks drops `scheduledDate`): controller fix live on api.vcrcapps.com; Postgres path (contract c5) verified live — planner task persisted its day.
- **#675** (inspector edit-mode default + full create inspector in planner): all smoke items confirmed by user — inspector opens editable on existing + new tasks, save/cancel/close correct, created task lands in its day column.
- **Smoke FAIL → PASS lesson (C5/W5, postmortem `.agent-stack/postmortems/2026-06-11-pr-676-smoke.json`):** the GitHub workflow "API Deploy (Synology)" only **publishes the image to GHCR** — deployment is a manual `docker compose pull && up -d` on the NAS (runbook: `docs/release/hosted_deployment_synology_cloudflare.md`). First smoke ran against the stale container and failed the headline criterion; after the user updated the NAS, re-smoke passed with zero code changes. **Never claim "deploy is live" off the publish workflow + /health** — /health carries no version info.
- **Follow-up [#677](https://github.com/ajhochy/Rhythm/issues/677)**: expose build commit in `GET /health` so deploys are one-curl verifiable; consider renaming the publish workflow.
- **[PR #678](https://github.com/ajhochy/Rhythm/pull/678)** (open, observability-only): postmortem + resolution, contract closeouts (674-c5, 675-c7/c8 → pass), this status update.

## Prior Status (2026-05-26 — PR #642 smoke follow-ups #644/#643/#645)

🟢 **PR #642 merged to `main`** (commit `9e3cfe4`). Three follow-ups filed during its manual smoke are now in flight:
- **#644** (task collaborator does not persist) → branch `fix/issue-644-collaborator-server-url` → **[PR #646](https://github.com/ajhochy/Rhythm/pull/646)** open (NOT merged), Desktop CI green. c1 automated + c2 live smoke PASS.
- **#643** (slash popover scroll) + **#645** (agent pill stale icon) → combined branch `fix/issue-643-645-agents-ui` → verified by `verification-gate`, PR pending (about to open). Both UI-local; #645 required one repair loop (false-green provider mapping, see above + decisions.md).

Prior run below (PR #642):

🟢 **Branch `workflow/run-2026-05-26` → [PR #642](https://github.com/ajhochy/Rhythm/pull/642)** (merged). HEAD `6a17b91`. Server CI + Desktop CI green.

Five issues, all verified by `verification-gate`. Two were already implemented on `main` and just never closed (locked with regression tests); three had real gaps that were implemented:

- **#626** (session.updated on stream bridge): already implemented (commit 163c7a6). Added regression contract tests only — `issue_626_contract.test.ts` 2/2.
- **#476** (gate AgentTriggerWatcher in dev): guard already implemented (`RHYTHM_LOCAL_SMOKE` no-op). Documented the flag in `docs/testing/manual-smoke.md` §12.
- **#629** (Open Chat ↔ task): taskId already persisted; added server-seeded non-triggering `system` context message + mini-bubble render. `issue_629_contract.test.ts` 4/4.
- **#631** (slash popover empty): `/opencode/commands` returned hard-coded `[]`; wired `OpencodeClientService.listCommands()` → SDK `command.list()`. `issue_631_contract.test.ts` 4/4.
- **#48** (PCO rule editor UX): sub-changes 1/2/4 already implemented; added #48.3 (day picker Mon–Sun) + #48.5 (placeholder insert chips). Backend 3/3 + Flutter widget 4/4.

Plus 23 deterministic widget/controller tests (`test/features/agents/issue_62[69]_*`, `issue_631_*`) converting most of the manual smoke surface to `flutter test`. better-sqlite3 was rebuilt locally for Node ABI 127 so vitest runs.

**Residual manual smoke (live-SDK only, see manual-smoke.md §12):** #631 real command list in popover; #629 task-context note on Open Chat from a live trigger; #626 chip flips live during a real agent run.

**Companion:** [PR #641](https://github.com/ajhochy/Rhythm/pull/641) — mcp_server build-config fix (separate, CI green).

**Previous trunk:** PR #617 merged to `main` on 2026-05-20 (commit 313e3ff); this run branched off post-merge `main`.

### #48 summary

Five sub-changes from the issue spec:
1. **Multi-select triggers** — already implemented (PCO checklist in view; engine `triggerKeys` already supported). c1+c3 contract tests green.
2. **Multi-select team + position** — already implemented (FilterChip rows in view; engine `teamIds`/`positionNames` already supported). c5 contract test green.
3. **Day-of-week picker extended Mon–Sun** — was Mon–Fri only (`options: [1..5]`); extended to `[1..7]` with `6: Saturday`, `7: Sunday` labels. c6 contract test red→green.
4. **Action dropdown cleanup** — already implemented (PCO filtered to `create_task` + `create_project_from_template` only). c4 contract test green. Engine `templateId` lookup already supported.
5. **Placeholder insert chips** — replaced `helperText` hint on task title/notes template fields with clickable `{{token}}` ActionChips using new `_placeholderChips` + `_insertAtCursor` helpers; inserts at cursor using `TextEditingValue`. c7 contract test red→green.

Files changed:
- `apps/desktop_flutter/lib/features/tasks/views/automation_rules_view.dart` — day picker options + placeholder chip methods
- `apps/api_server/src/__tests__/issue_48_contract.test.ts` — new (3 backend contract tests)
- `apps/desktop_flutter/test/issue_48_contract_test.dart` — new (4 Flutter widget contract tests)
- `docs/ai/contracts/issue-48.json` — new contract (7 criteria, all `status: pass`)

### #631 fix summary

- `apps/api_server/src/services/opencode_client_service.ts` — new `listCommands()` method.
- `apps/api_server/src/app.ts` — `GET /opencode/commands` wired to `listCommands()`.
- Contract: `docs/ai/contracts/issue-631.json`. Test: `apps/api_server/src/__tests__/issue_631_contract.test.ts` (4/4 green).

### #629 fix summary

- `apps/api_server/src/controllers/agent_sessions_controller.ts` — appends `'system'` message with task title + notes.
- `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart` — renders `role=='system'` as muted italic.
- Contract: `docs/ai/contracts/issue-629.json`. Test: `apps/api_server/src/__tests__/issue_629_contract.test.ts` (4/4 green).

---

## Prior Status (2026-05-19 — follow-up fixes for #606, #622, #623, #624, #625 committed; smoke pending)

🟡 **Branch `follow-up` stays open. PR #617 still not merged.** PR #621 stacked on top — FK tolerance for production task IDs in the local SQLite. Independent and shippable.

### Today's work

[**PR #621**](https://github.com/ajhochy/Rhythm/pull/621) — `fix(agent-sessions): tolerate taskId missing from local SQLite (rebased onto #617/follow-up)`. Branch `fix/agent-session-fk-task-id-tolerance-followup`. Supersedes the closed PR #619 (which was against stale `main`).

**Bug fixed**: POST `/agent-sessions` with a `taskId` not in the local SQLite `tasks` table returned 500. Flutter picker reads tasks from production (`api.vcrcapps.com`) but POSTs hit localhost; the sync mirror is incomplete; SQLite raises `SQLITE_CONSTRAINT_FOREIGNKEY` on `agent_sessions.task_id REFERENCES tasks(id)`; controller doesn't catch it. New-session dialog showed "Something went wrong on the server"; Task-ready bubble showed "Internal server error".

**Fix**: in `agent_sessions_controller.create()`, probe `TasksRepository.findByIdIncludingLegacy(taskId)` before insert. On miss, log `warn` and null out `task_id`; `task_title` is preserved (the schema stores them independently — see migration comment introducing `task_title`).

**Acceptance contract** at `docs/ai/contracts/pr-619.json`. Two strengthened tests assert the full launch path: HTTP 201 + reconciled taskId + preserved taskTitle + `opencodeClient.createSession(name, cwd)` invoked + `opencodeSessionMap` populated + `promptAsync` invoked with initial prompt containing taskTitle. Red proven by reverting the controller fix → 2 fail with `expected 500 to be 201`. Green: 508/508.

**Smoke infrastructure**: `apps/api_server/scripts/smoke-launch.sh` (`npm run smoke:launch`). Verifies sentinel Node + ABI match + dist build, spawns the api_server with exactly the env Flutter uses (`PORT=4001 AGENT_LOCAL=true DB_PATH=/tmp/rhythm-smoke/smoke.db`), hits `/health`, `/agents/capabilities`, and the PR's regression POST. Uses `set -m` + process-group kill on cleanup + `pkill -9 -f "opencode serve"` so the SDK's child server on `:4096` can't orphan and surface as "Reusing existing server on :4001" on the next Rhythm.app launch (which silently coupled stale dev servers earlier in this session).

**Live verification**: against the running `flutter run -d macos` app, POST with bogus taskId returned **HTTP 201**, WARN was logged, taskTitle preserved. End-to-end through the actual SDK and Anthropic provider.

### Bugs caught during manual smoke and filed as follow-ups

| # | Title | Notes |
|---|---|---|
| [#620](https://github.com/ajhochy/Rhythm/issues/620) | sync: local SQLite tasks table missing tasks that exist on production | The underlying gap PR #621 defends against. #621 is the boundary fix; #620 fixes the mirror. |
| [#622](https://github.com/ajhochy/Rhythm/issues/622) | agent chat: `question` tool call renders as raw args instead of an answer selector | Wall of JSON shown instead of clickable options. Any agent that asks structured questions becomes unusable. |
| [#623](https://github.com/ajhochy/Rhythm/issues/623) | agent chat: Task-ready bubble forces agent pre-selection instead of using the composer picker | Bubble's `startAgent(agentId)` predates the #602 composer redesign. Should open agent-less. |
| [#624](https://github.com/ajhochy/Rhythm/issues/624) | agent chat: follow-up user message accepted by SDK but no LLM call fires; UI stuck on "working" | **Critical**: first prompt's 7-step output works; second prompt logs only `message.updated` — no `step=N loop`, no `service=llm`, no deltas. Smells like a regression of the `40d4fee` "model on follow-up turns" fix. Includes the SDK timeline as repro. Also covers the related persistence desync (`lastActivityAt` stays null even after streamed output). |
| [#625](https://github.com/ajhochy/Rhythm/issues/625) | agent chat: mini-bubble transcript blanks when a different session is selected in the Agents tab | Bubble reads from `_transcript[selectedSessionId]` instead of its own `widget.entry.sessionId`. Breaks the persistent-chat premise of the bubble overlay entirely. |

### Follow-up bug status (2026-05-19 batch fixes)

| # | Title | Status |
|---|---|---|
| [#622](https://github.com/ajhochy/Rhythm/issues/622) | `question` tool renders as raw args | ✅ Fixed — commit `3abb2f4` |
| [#623](https://github.com/ajhochy/Rhythm/issues/623) | Task-ready bubble forces agent pre-selection | ✅ Fixed — commit `1844fce` |
| [#624](https://github.com/ajhochy/Rhythm/issues/624) | Follow-up prompt: no LLM call fires, UI stuck on "working" | ✅ Fixed — commit `37fcc26` (code-review fix; manual smoke to confirm) |
| [#625](https://github.com/ajhochy/Rhythm/issues/625) | Mini-bubble transcript blanks on session switch | ✅ Fixed — earlier commit |
| [#620](https://github.com/ajhochy/Rhythm/issues/620) | Local SQLite tasks table missing production tasks | 🟡 Open — lower priority; PR #621 defends the boundary |

### Critical-path before next release

- All critical-path blockers (#606, #622–#625) have fixes committed on `follow-up`.
- **#624 fix needs manual smoke confirmation** — no opencode SDK available for live reproduction; fix was by code review. Key behavior: follow-up user messages in an agent session should trigger a new LLM stream.
- **#606 (action row)** — purely additive Flutter UI; no API changes. Manual smoke should confirm: Copy copies text, Bell arms notification, timestamp shows correctly below each bubble.
- **#620** is lower-urgency; PR #621 keeps the symptom invisible.

### Tooling lessons recorded

Postmortem: `.agent-stack/postmortems/2026-05-19-pr-621-agent-fk-tolerance.json`. Two reusable artifacts:

1. `apps/api_server/scripts/smoke-launch.sh` — repeatable build+spawn pipeline check. Catches ABI mismatches and orphan-port issues programmatically instead of "click Retry, repeat."
2. The acceptance-contract pattern (`docs/ai/contracts/pr-619.json`) — tests that prove **launch**, not just **insert**. The mandate "PASS = sessions actually launch" came directly from the user when the earlier test was only proving the row was inserted.

Workflow lesson: **before branching off `main`, check `gh pr list --state open` for an active draft trunk** (#617 was the real trunk; the original PR #619 was wasted effort branching off stale `main`).

---

## Previous Status (2026-05-18 — manual smoke of vbeta.18.36; iterate on `follow-up`, do not merge #617 yet)

🟡 **Branch `follow-up` stays open. PR #617 NOT merged.** User decision after a full manual smoke pass: keep grinding bugs on this branch, re-smoke after each fix cluster, merge to `main` only when ≥80% of the original smoke checklist passes cleanly.

### What landed this session

Six commits on `follow-up` (mine + a parallel agent's):

1. **`promptAsync` TypeError** — commit `49ef628`. `apps/api_server/src/services/ws_gateway.ts` was extracting `opencodeClient.promptAsync` as a bare function reference (cast-to-alias pattern from `acdc835`), losing `this`. Every send threw `Cannot read properties of undefined (reading 'client')`. Fix: `.bind(opencodeClient)`. Most user-visible regression on the branch — user hit it ~5× during smoke before root-cause.
2. **PATH discovery for opencode binary** — folded in via merge `34d57bf` (closed PR #618). `apps/api_server/src/services/opencode_client_service.ts` exports `augmentPathForOpencode()`, prepends `~/.opencode/bin`, `/opt/homebrew/bin`, `/usr/local/bin` before `createOpencode()`. GUI-spawned `.app` children get a stripped PATH; without this, opencode binary not found. +4 unit tests.
3. **Parent-PID watchdog** — `apps/api_server/src/server.ts` polls `process.ppid` every 2s; if it flips to 1 (orphaned to launchd), runs the SIGTERM clean-shutdown. Defense in depth for Cmd+Q via NSApp.terminate killing the Dart engine before its lifecycle hooks fire.
4. **`server.close()` in `dispose()`** — `OpencodeClientService.initialize()` now destructures and stores the `server` handle from `createOpencode()`; `dispose()` calls `server.close()` to actually kill the :4096 subprocess (previous `client.close()` / `client.shutdown()` probes didn't exist on the SDK).
5. **`_pendingTurnOverride` in `setSessionModel`** — `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`. Picking session-default in the model picker no longer leaves the per-turn override unset; "Pick a model before sending the first message" error gone.
6. **From parallel agent:** `ensureReady()` auto-recovery + dispose stack traces (`2f5fbdb`), curated OpenRouter models in catalog (`6b341d4`), Express body limit → 1 MB (`f52d3b0`).

Verification: **503/503 vitest**, **218/218 flutter test**, `tsc --noEmit` clean, `dart format` + `flutter analyze` clean.

### Smoke results (vbeta.18.36 against `/Applications/Rhythm.app/`)

**6 PASS / 1 PARTIAL / 10 FAIL** of 20 testable items. Lifecycle 4 (ABI fallback) skipped — needs v24-only machine.

PASS: Cmd+Q clears :4001 and :4096 ≤3s; new session + model picker + send to DeepSeek (TypeError gone); soft-close + hard-delete live; new-session has no agent dropdown + "Choose a model" placeholder; unified picker layout with Connect on unauthorized rows.

PARTIAL: Archive — DB write + active-list removal live, but **Archived section doesn't update live** (needs refresh). Issue: `docs/ai/generated-issues/fix-archived-section-not-updating-live.md`.

FAIL (each filed under `docs/ai/generated-issues/`):
- **Permissions pipeline never fires for Claude direct in default mode (#608)** — Bash runs unprompted, no PermissionCard. Highest severity, safety feature broken. `fix-permission-pipeline-not-firing-claude-direct.md`.
- **Reasoning effort + fast-mode never reach SDK (#604)** — 5th `sdkOpts` param in ws_gateway promptFn alias silently dropped; `OpencodeClientService.promptAsync` only accepts 4 params. `fix-thinking-budget-fast-mode-never-applied.md`.
- **File-attach paperclip is a no-op (#602)** — `fix-composer-file-attach-paperclip-no-op.md`.
- **Slash popover never appears (#610)** — `fix-slash-command-popover-not-firing.md`.
- **Notify-on-completion + relative timestamp ticker dead (#606)** — copy works; the other two don't. `fix-notify-on-completion-not-firing.md`.
- **OpenRouter curation overhaul (#609)** — picker filter too aggressive (hundreds curated → ~6 visible) + duplicate `anthropic/claude-sonnet-4.6` row. `fix-openrouter-curation-overhaul.md`.
- **VCS branch dropdown (#603)** — Dart type cast error `String is not subtype of Map<String, dynamic>?`, no "Current" section, switch fails silently. `fix-vcs-branch-dropdown-type-cast-and-switch.md`.
- **VCS chip never renders in session header (#607)** — entire surface invisible. `fix-vcs-chip-not-rendering-in-session-header.md`.

Inline UX findings filed: auto-scroll steals focus during streaming (`fix-agent-chat-auto-scroll-steals-focus.md`); pill mislabels non-Anthropic OpenRouter models as "Claude Code" (`fix-agent-kind-mislabels-non-anthropic-openrouter-models.md`); default model should be Sonnet not Opus (`tweak-default-model-sonnet-over-opus.md`); Google OAuth dialog hangs because route + UI assume auto-callback but SDK requires paste-back (`fix-google-oauth-paste-back-ui.md`).

### Next-session plan

1. High-severity: permission pipeline (#608), VCS parse error (#603), VCS chip (#607).
2. Medium: thinking/fast-mode SDK plumbing (#604), file attach (#602), slash popover (#610), notify + ticker (#606), OpenRouter curation overhaul (#609).
3. UX: archived live update, auto-scroll, pill mislabel.
4. Trivial: default Sonnet.
5. Re-smoke each cluster on a new DMG. Merge #617 only at ≥80% checklist pass.

## Prior Status (2026-05-18 — triage round 2: isReady flip + dispose diagnostics)

🟡 **Branch `follow-up` — 3 commits this session on top of PR #617 batch.**

### Fixes this session (2026-05-18)

1. **Chat broken for all sessions (`promptAsync` TypeError)** — committed as `49ef628`. Root cause: commit `acdc835` (#604) extracted `opencodeClient.promptAsync` from its object and cast it as a bare function reference, losing `this`. Every prompt threw `TypeError: Cannot read properties of undefined (reading 'client')`. Fix: `.bind(opencodeClient)` preserves `this`.

2. **Curated OpenRouter models not surfacing in model picker** — `listAllRoutes()` in `agent_model_resolver.ts` only iterates the hardcoded `ROUTE_FALLBACKS_BY_AGENT` map. The `agent_model_visibility` table (used by the "Browse & Curate" UI) was only applied to *hide* models from this hardcoded list — it never *added* curated models. **Fix**: Modified `GET /agents/models/catalog` to include curated OpenRouter models with `visible=1` not in the hardcoded fallback list. Commit `6b341d4`.

3. **`isReady` flip between `/opencode/health` and `POST /agent-sessions`** — the `OpencodeClientService.isReady` getter returned `true` for the health endpoint but `false` for the session-creation controller. Root cause: the PARENT_GONE watchdog (2s interval in `server.ts`) fires when `process.ppid` becomes 1 (parent process exits). This resets `this.status = 'uninitialized'` via `dispose()`, which is called by the shutdown handler. The watchdog is designed to catch macOS Cmd+Q (Flutter killed before it can SIGTERM the child), but it also fires during development when the shell or process-manager parent exits between requests.

   **Fix (commits `2f5fbdb`):**
   - Added `ensureReady()` to `OpencodeClientService` — auto-reinitializes the engine when `isReady` is false, unless the server is in intentional shutdown (`_shuttingDown` flag).
   - Made `initialize()` idempotent and re-entrant with `_initializing` guard (prevents double-init races from concurrent `ensureReady` calls).
   - Added dispose diagnostics: stack-trace logging on `dispose()`, idempotency guard, `isDisposed` getter.
   - Controller `create()` and `resume()` now log the current `statusMessage` and call `ensureReady()` before failing — gives a recovery window if the watchdog fired seconds earlier.
   - Server shutdown handler sets `_shuttingDown` on `opencodeClient` so `ensureReady()` does not wastefully re-initialize during teardown.
   - Raised Express JSON body parser limit to 1 MB (default 100 KB was causing `PayloadTooLargeError` on large OAuth callback payloads).

### What this branch lands
- **Install hardening (#614, #615)**: SIGTERM/SIGINT shutdown chain in api_server + lifecycle hooks in Flutter (window_manager onWindowClose, SIGINT/SIGTERM watchers, AppLifecycleState.detached). Orphan self-heal on next launch kills any node holding :4001 with PPID=1. `ApiServerService._readRuntimeSentinel` reads the bundled `Resources/api_server/.node-runtime.json` and ABI-matches against installed Node binaries; on total mismatch the failure dialog surfaces the exact `npm rebuild better-sqlite3 --build-from-source` command.
- **Sessions / archive / WS events (#601, #605)**: `agent_sessions.archived_at` column; `PATCH { archived }`; `?includeArchived` and `?archivedOnly` filters; new "Archive" row action and collapsible Archived section. `session.updated` / `session.removed` WS events emitted from every status / archive / PATCH / hard-delete touchpoint; Flutter dedupes and routes rows into sessions/resumable/archived live.
- **Permissions (#608, #611)**: `permission.asked` events from the SDK now broadcast via WS and surface as a PermissionCard (modal when DestructiveModalService.enabled). `accept` / `deny` endpoints invoke `respondPermission`. `agent_sessions.permission_mode` column with `default | acceptEdits | plan | bypassPermissions`. All four paths invoke `respondPermission` so the SDK never hangs. First selection of `bypassPermissions` requires confirmation.
- **Model picker enhancements (#604, #609, #610)**: Variant rows in `ROUTE_FALLBACKS_BY_AGENT['claude-code']` (Opus 4.7, Opus 4.7 1M, Opus 4.6 Legacy) and `['codex']`. `thinking_budget` + `fast_mode` columns; effort picker (Low → Max → budget_tokens map) + fast-mode toggle wired through WS `session.input`. New `agent_model_visibility` table + `GET /opencode/models?provider=openrouter` proxy + `GET/PATCH /agent-models/visibility`; AiAccountSection gains an expandable OpenRouter catalog with search/pricing/checkboxes. `SlashCommandPopover` anchored to the composer TextField with arrow-key navigation.
- **Per-message action row (#606)**: copy / notify-on-completion (LocalNotificationService) / relative timestamp under every bubble. Single global ticker drives timestamp updates.
- **Branch / VCS (#603, #607)**: `vcs_probe.listBranches` + `gitCheckout` helpers. New-session dialog gets a Branch dropdown with current/recent/local sections and "+ New branch from current" inline input. Dirty-tree → Stash/Cancel confirm. The VCS chip becomes a button; tapping it opens a popover with the same branch list, Stash/Discard/Cancel dirty-tree handling, and verbatim git errors in a SnackBar.
- **Composer redesign (#602)**: `GET /agents/models/catalog` returns the whole catalog grouped by Authorized — Claude/Codex/Copilot/Gemini → Free — OpenRouter, with `connectUrl` for unauthorized rows. Model picker, permission-mode pill, reasoning effort, fast-mode toggle, and a new file-attach button all live in the composer area. New sessions start agent-less (`agent_kind='__pending__'`); `agent_kind` is resolved from the first `modelOverride` on the first turn.

### Verification (local, 2026-05-16)

| Check | Result |
|---|---|
| `apps/api_server` `tsc --noEmit` | clean |
| `apps/api_server` `vitest run` | **506/506** (catalog curated-model test added + opencode_client_service object-map unwrap) |
| `apps/api_server` `npm run build` | clean |
| `apps/desktop_flutter` `dart format --set-exit-if-changed lib test` | clean |
| `apps/desktop_flutter` `flutter analyze --no-fatal-infos` | 0 errors (180 pre-existing infos) |
| `apps/desktop_flutter` `flutter test` | **218/218** |
| Server-side endpoint smoke (HTTP) | **22/22** — catalog, visibility, archive, permission modes, tuning fields, branch list + checkout, OpenRouter proxy |

### What still needs a human

Playwright cannot drive the Flutter macOS UI. The server side is fully smoked; the UI bits below need a manual pass against `flutter run -d macos`. Before launching, **fully quit Rhythm.app and free :4001** because #614 changes the lifecycle of the spawned child:

```
lsof -iTCP:4001 -sTCP:LISTEN -n -P    # find pid
kill <pid>
```

Then walk the PR #617 manual smoke checklist (full list lives in the PR body — copied here for reference):

- Install / lifecycle (#614, #615): Cmd+Q ↔ `lsof` empty; force-quit + relaunch self-heals; ABI-fallback on a v24-only machine.
- Sessions / archive / WS (#601, #605): live status updates without manual refresh; archive↔unarchive round-trip.
- Permissions (#608, #611): each of the four modes exhibits the documented behavior against a bash/write/edit prompt.
- Composer (#602, #604, #606, #609, #610): unified picker layout, agent-less new session, file attach, effort/fast-mode, slash popover, action row.
- Branch / VCS (#603, #607): branch dropdown in new-session, clickable chip with branch popover, dirty-tree handling.

After smoke, merge PR #617 manually on GitHub.

## Prior Status (2026-05-16 evening — vbeta.18.31 shipped; install-time gotchas filed)

🟢 **PR #598 merged to `main` via commit `d7a0775`.** Desktop release `vbeta.18.31` is **published** (DMG + ZIP) and verified running locally. Sibling PRs #593–#596 closed (content lives on main via #598); their branches deleted.

### Release-day discoveries (worth knowing before the next install)
Two install-time issues bit the post-install smoke after the DMG landed. Both have follow-up issues filed; the immediate workarounds are recorded here so the next person doesn't re-debug.

1. **First release build failed** — the "Bundle CLI server into app" workflow step ran `npm install` inside the bundled `Rhythm.app/.../api_server/`, which triggered the `package.json` postinstall (`node scripts/postinstall.js`) — but the workflow only copied `dist/`, `package.json`, and `package-lock.json` into the bundle, not `scripts/`. Fixed in **PR #613**: copy `scripts/` alongside `dist/` and add `test -f $DEST/scripts/postinstall.js` to the verify step so it fails at the gate next time. Re-triggered run was green.

2. **Orphan api_server kept old code alive across app updates** — quitting Rhythm.app does not kill the spawned api_server (PPID=1 orphan). The orphan keeps holding port :4001, the next launch of the updated app silently connects to the stale orphan, and the user sees ghost behavior that looks like the new fixes never shipped. **Workaround**: `kill <pid>` from `lsof -iTCP:4001`. **Proper fix tracked in #614**: window_manager.onWindowClose → SIGTERM → 2s grace → SIGKILL on the Node child; matching SIGTERM/SIGINT handler in api_server that also disposes the opencode subprocess; force-quit safety net auto-detects the PPID=1 orphan on next launch and kills it with a clear recovery log line.

3. **better-sqlite3 ABI mismatch after orphan kill** — the bundled `better-sqlite3` is built in CI against Node v22.22.2 (ABI 127); `ApiServerService._readRuntimeSentinel()` only checks the dev sentinel path (`$dir/apps/api_server/.node-runtime.json`), not the bundled one at `Resources/api_server/.node-runtime.json`. So on a fresh machine the runtime falls through to `/opt/homebrew/bin/node` (commonly v24 ABI 137 on Apple Silicon today) and the spawn fails with NODE_MODULE_VERSION mismatch, surfacing as "Agent server unavailable". **Workaround**: `cd Rhythm.app/Contents/Resources/api_server && /opt/homebrew/bin/node $(dirname /opt/homebrew/bin/node)/npm rebuild better-sqlite3 --build-from-source`. **Proper fix tracked in #615**: Flutter reads the bundled sentinel, validates `nodePath` existence, ABI-matches against installed Node binaries when the install-time one is missing, and surfaces the rebuild command in the error dialog instead of the generic 502.

### Bottom line for the next agent or sprint
- The release is up and working locally.
- **#614 and #615 are the highest-priority follow-ups** — they bite every install until fixed.
- Everything else is iterative UX (composer redesign, permissions, OpenRouter curation, branch selector, etc.) — see the full follow-up list below.

### What PR #598 landed
Everything below is now on `main`, embedded in the `vbeta.18.31` build.

**M1–M5 consolidation** (originally stacked PRs #593–#596 — superseded):
- M1 — projects rail + VCS chip + per-project session filter.
- M2 — `PATCH /agent-sessions/:id` (rename + provider/model override), per-turn `modelOverride` over WS, cancel endpoint.
- M3 — inspector side panel + tool-call cards (now actually rendering inline) + permission card widget (WS pipeline still pending #608).
- M4 — composer attachments + structured-parts WS protocol + commands data source (slash popover deferred #610).
- M5 — settings services (destructive-modal, keybinds, opencode-server-URL).

**Net-new in this PR**:
- Session-list decode fix: client accepts the `{sessions, resumable}` envelope (server has returned this since #580).
- Closed sessions no longer filtered out of the list. Greyed via status chip; hard-deletable via the three-dot menu.
- `DELETE /agent-sessions/:id/hard` endpoint (true row delete + cascade) + per-row trailing menu + confirm dialog.
- Shift-click multi-select on session rows + bulk-delete banner.
- Model picker (`SessionModelPicker`): sub-grouped by provider (Anthropic / OpenAI / Google / GitHub Copilot direct vs Via OpenRouter); check-mark + accent-bold on the active row; pill reflects resolver precedence (turn override > session default > fallback).
- `GET /agents/models?agentId=…` endpoint joining `ROUTE_FALLBACKS_BY_AGENT` with authed providers.
- Expanded model catalog: claude-opus-4-7 / 4-5, sonnet-4-6, haiku-4-5 across anthropic + github-copilot + openrouter; gpt-5.3-codex / 5.3 / mini; gemini-3-pro-preview + flash.
- Agent settings sheet (gear icon on session list header): four sections — Accounts (full `AiAccountSection` moved here from main Settings), Behavior (destructive-modal toggle), Keybindings (4 actions + reset), Opencode server URL.
- AI Accounts section removed from main app Settings.
- Manage Agents view and button removed (file deleted, references cleaned up).
- "OpenCode" agent label renamed to "OpenRouter" via migration — the catch-all kind routes through OpenRouter in practice.
- Projects rail loads from server on mount; new-session dialog cwd defaults to selected project's folder; duplicate-cwd guard rejects with 400.
- Project name auto-derives from picked folder when empty or matches previous basename.
- Folder picker uses `osascript "choose folder"` (file_picker plugin's beginSheetModal was suppressed under the showDialog overlay).
- Icon field accepts long emoji (dropped `maxLength: 7` that was truncating multi-codepoint emoji into U+FFFC).
- Refresh button on session list header (stop-gap for #605).
- Capabilities refetched on new-session dialog open (server's first response often arrives before the SDK boot finishes, so `opencode: false` was cached stale).
- Keybinds + opencode-server-URL persistence: switched from onSubmitted/onEditingComplete to onChanged so closing the sheet without pressing Enter still saves.
- Tool-call cards default to expanded inline so output shows without an extra click.
- `_ChatBubble` now walks parts in order: text → SelectableText spans; tool → `ToolCallPart` cards. Previously it joined every part's text and silently dropped tool parts.
- CI repairs: `vcs_probe.ts` calls `git` directly (no zsh dep, fixes Ubuntu runners); `agents_models_routes.test.ts` count-agnostic shape assertions; duplicate `features/settings/services/*` imports in `main.dart` removed.

### Smoke pass (manual)
Confirmed end-to-end on local build:
1. Session list populates and historical rows visible.
2. Project rail loads + filter narrows correctly.
3. Bulk shift-click + bulk-delete confirm flow.
4. Folder picker + name auto-derive on new project.
5. Cwd defaults to selected project on new session.
6. Send turn through model picker (per-turn + session-default).
7. Session-default model persists across Cmd+Q restart.
8. Closed-session refresh via the new refresh icon.
9. AI Accounts moved into gear → Accounts; removed from main Settings.
10. Tool-call inspector renders bash output inline by default.
11. VCS chip displays current branch.
12. Picker sub-groups (Anthropic / OpenAI / GitHub Copilot / Via OpenRouter).
13. OpenCode label is "OpenRouter" and selectable (not greyed).
14. Manage Agents button gone.
15. Keybinds + Opencode-server-URL persist across restart.

### Known data-layer-only items (functional gap, not regressions)
- M5 **destructive-modal toggle**: no permission flow exists for the SDK's tool calls. The toggle is armed but nothing triggers it — tool calls fire instantly. Tracked in **#608**.
- M5 **Opencode-server-URL switch**: `OpencodeClientService` doesn't consume the persisted URL yet — value persists but the SDK stays on the embedded endpoint. Tracked separately as part of M5 follow-ups.
- M5 **Keybind editing**: persists, but no `Shortcuts`/`Actions` widget tree consumes the values yet — typed shortcuts don't actually fire.

### Open follow-up issues
- **#599** — Per-turn / per-session model picker (closed-by #598).
- **#600** — Agent settings sheet (closed-by #598).
- **#601** — Archive / soft-delete for sessions (separate column + `?includeArchived`).
- **#602** — Composer redesign: relocate model picker to composer area, add file attach, agent-less session start, unified agent selector with Authorized/Connect rows.
- **#603** — Branch selector in new-session dialog (git checkout before session start; dirty-tree UX).
- **#604** — Variant model IDs (1M context, legacy) + reasoning effort + fast-mode.
- **#605** — Server broadcasts `session.updated` / `session.removed` WS events on status / row changes.
- **#606** — Per-message action row (copy, notify on completion, timestamp).
- **#607** — Clickable VCS chip → branch switcher with dirty-tree handling.
- **#608** — Permission flow: surface `permission.asked` WS events + accept/deny endpoints + gate destructive tools.
- **#609** — OpenRouter model curation: browse full catalog in Agent Settings; pick which surface in the in-session picker.
- **#610** — Composer slash-command popover (`CommandsDataSource` already exists, widget never built).
- **#611** — Permission Mode pill in chat sessions (default / acceptEdits / plan / bypassPermissions) — depends on #608.
- **#612** — Docs: project-state snapshot after #598 merge (merged).
- **#613** — Release: bundle `apps/api_server/scripts` into the macOS .app so postinstall can run during the bundling step (merged).
- **#614** — Lifecycle: quitting Rhythm.app must terminate spawned api_server + opencode subprocesses (no orphans). Force-quit safety net on next launch. **High priority — bites every install today.**
- **#615** — `ApiServerService`: read bundled `.node-runtime.json` + ABI-match fallback when the install-time Node is missing. Surface a copy-paste rebuild command in the error dialog. **High priority — same root cause class as #614.**

### Release
- **No Synology release needed.** The api_server in this PR is bundled inside the macOS .app; production Synology server owns only user-facing data (tasks, rhythms, project-templates, messages, facilities, users, claude-triggers) — none of which changed.
- Desktop release `vbeta.18.31` in flight on Actions run 25968794136. Triggered with version `beta.18.31` since the latest stable was `v18.30` and the latest beta was `vbeta.18.29`.

## Prior Status (2026-05-15 — M1–M5 consolidated + UX follow-ups on PR #598)

PR #598 was open at this point; this prior status is preserved for chronology.

### What PR #598 contains
- **M1–M5 merged in**: projects rail + VCS chip (M1), session header PATCH + per-turn override + cancel (M2), inspector + tool-call parts + permission card (M3), composer attachments + commands (M4), settings services + opencode-auth surfaces (M5). Brought in via `git merge origin/m5-settings` after the original `fix-session-list-decode` branch shipped the decode fix off `main`.
- **Session list decode fix**: `agents_data_source.listSessions()` now accepts the `{sessions, resumable}` envelope (server has returned this since #580; client was still casting to `List`).
- **Show closed sessions**: controller stopped filtering `status='closed'`, so historical rows are visible. Greyed by the row status chip; removable via hard-delete.
- **Model picker (#599)**: `GET /agents/models?agentId=…` joins `ROUTE_FALLBACKS_BY_AGENT` with authed providers; rows tagged `routeKind: 'direct' | 'aggregator'`. Picker pill in transcript header shows the **active** model with a check-mark on the matching row when open; sections separate "Direct accounts" vs "Via OpenRouter/Together/Groq". Catalogue expanded to opus-4-7 / opus-4-5 / sonnet-4-6 / haiku-4-5 (claude-code), gpt-5.3 / -codex / -mini (codex), gemini-3-pro / -flash (gemini-cli).
- **Agent settings sheet (#600)**: gear button on Agents header opens dialog with four sections — Accounts (full `AiAccountSection` moved here from main Settings), Behavior (destructive-modal toggle), Keybindings (4 actions + reset), Opencode server URL. Wired in `main.dart`.
- **Hard-delete session**: new `DELETE /agent-sessions/:id/hard` route (true delete + FK cascade). Three-dot trailing menu on each row → "Delete session" with confirm dialog. Distinct from existing soft-close `DELETE /agent-sessions/:id`.
- **Shift-click multi-select + bulk delete**: `_SessionListPanel` is stateful; Shift-click toggles membership in `_multiSelected`; banner at top of list shows "N selected · Cancel · Delete" → confirm dialog → parallel hard-deletes with per-row rollback on failure.
- **Manage agents view removed**: the page, the button on Agents header, the agent-bubble-overlay link, and the source file — all gone.
- **AI Accounts removed from main Settings**: section moved into the gear sheet.
- **Folder picker (osascript)**: the file_picker plugin's `beginSheetModal` was being suppressed under Flutter's showDialog overlay; replaced with `/usr/bin/osascript "choose folder"` for a standalone Finder dialog. Wired in the project create/edit dialog.
- **Auto-derived project name**: picking a folder fills the Name field with the folder's basename if empty or unchanged from the previously-picked basename.
- **Icon field accepts long emoji**: dropped `maxLength: 7` from the project Icon TextField; multi-codepoint emoji no longer truncate to `U+FFFC`.
- **Projects rail loads on mount**: `ProjectsRail` is now stateful and calls `controller.load()` in `initState`, so the rail reflects server state (not just in-session creations).
- **New-session dialog defaults cwd to selected project's folder** when one is active.
- **CI repairs**: `vcs_probe.ts` now calls `git` directly (Ubuntu runners don't ship zsh, which the original `/bin/zsh -lc` wrapper relied on); `agents_models_routes.test.ts` asserts shape rather than length so the expanded catalogue doesn't break it; duplicate `features/settings/services/*` imports in `main.dart` dropped.

### Open follow-up issues (filed during this session)
- [#599](https://github.com/ajhochhalter/Rhythm/issues/599) — Model picker (closed-by #598).
- [#600](https://github.com/ajhochhalter/Rhythm/issues/600) — Agent settings sheet (closed-by #598).
- [#601](https://github.com/ajhochhalter/Rhythm/issues/601) — Archive / soft-delete for sessions (separate column in DB; opt-in `?includeArchived`).
- [#602](https://github.com/ajhochhalter/Rhythm/issues/602) — Composer redesign: relocate model picker to composer area, add file attach, agent-less session start, unified agent selector with Authorized/Connect rows.
- [#603](https://github.com/ajhochhalter/Rhythm/issues/603) — Branch selector in new-session dialog (git checkout before session start; dirty-tree UX).

### Pre-merge state
- CI: latest run on `4b4f7b3` — server tests fix + duplicate-imports fix in flight. Watch [#598 checks](https://github.com/ajhochhalter/Rhythm/pull/598/checks).
- Smoke: see `docs/testing/manual-smoke.md` (predates this work; gap noted — sheet/picker/multi-select/projects rail/hard-delete need explicit smoke steps).
- M2–M5 sibling PRs (#592–#596) remain open but their content lives on this branch; manual merge of #598 effectively supersedes them.
- Manual merge only. No auto-merge.

## Prior Status (2026-05-14 v3 — all five milestones shipped to draft PRs)

🟢 **All five milestones (M1–M5, 25/26 atomic issues) landed across stacked draft PRs in a single power-through session.**

| Milestone | Branch | PR | Status |
|---|---|---|---|
| M1 — Sessions ↔ Projects | `m1-projects` | [#592](https://github.com/ajhochy/Rhythm/pull/592) base=main | 6/6 issues #586–#591, full UI shipped |
| M2 — Session header toolbar | `m2-session-header` | [#593](https://github.com/ajhochy/Rhythm/pull/593) base=m1-projects | Backend + Flutter data layer; visible header UI follow-up |
| M3 — Details / inspector | `m3-inspector` | [#594](https://github.com/ajhochy/Rhythm/pull/594) base=m2-session-header | Widgets + endpoints shipped; agents_view rewrite follow-up |
| M4 — Composer upgrades | `m4-composer` | [#595](https://github.com/ajhochy/Rhythm/pull/595) base=m3-inspector | WS protocol + data sources; popover widgets follow-up |
| M5 — Settings surface | `m5-settings` | [#596](https://github.com/ajhochy/Rhythm/pull/596) base=m4-composer | Persistence services + backend stubs; tab UI + dark-mode audit follow-up |

**Automated checks at every milestone boundary:** `ai-workflow checks --level pr` exited 0 (flutter analyze, dart format, tsc --noEmit, vitest, flutter test 218/218, vitest 38/38 incl. M3-1 tool-call fixture).

**The stacked PR chain is ordered for sequential review:**
1. Review and merge #592 first (smoke the rail, VCS chip, project dialog).
2. Then #593 (PATCH endpoint, cancel, per-turn override — data layer only).
3. Then #594 (tool-call widgets, side panel, permission card — visual integration in a follow-up).
4. Then #595 (composer parts protocol — visible popovers in a follow-up).
5. Then #596 (settings services — tab UI in a follow-up).

### Known UI integration follow-ups (intentional gaps)

This session shipped backend completeness for M2–M5 and Flutter data-layer + scaffold widgets, but **did not** rewrite the live UI surfaces to integrate them. The composable pieces are import-clean and tested where reasonable. Visible follow-ups:

- **M2 session header**: model picker dropdown chip, Stop button on `working` status, token/cost meter, inline rename.
- **M3 chat thread**: hang `SessionSidePanel` off `agents_view`, render `ToolCallPart` inside assistant bubbles when `ChatPart.type == 'tool'`, surface `PermissionCard` for `permission.asked` WS events, wire backend `respondPermission` to the real SDK call.
- **M4 composer**: drag-drop region (needs `desktop_drop` plugin), slash-command popover widget, @-mention fuzzy file finder, file picker.
- **M5 settings**: `SettingsView` left-rail tab scaffold + Providers/Appearance/Keybinds/Servers/About tab widgets. **Full dark-mode token audit across all 11 screens** (Tasks/Projects/Rhythms/WeeklyPlanner/Messages/Facilities/Dashboard/Integrations/Imports/Agents/Settings) — services exist, but per-screen hex-literal flush deferred.
- **M5-1 destructive modal**: `PermissionCard` does not yet read `DestructiveModalService.enabled`; needs a single-line wiring in the consumer when the inline-vs-modal switch is implemented.
- **M5-5 server switching**: `OpencodeClientService` does not yet consume `OpencodeServerService.effectiveUrl`. Restart-on-switch is a follow-up.

### Backend stubs vs. functional endpoints

These endpoints return graceful empty/501 responses until the SDK methods are wired:

- `GET /agent-sessions/:id/diff` → `[]` when `opencodeClient.diffSession` is absent.
- `POST /agent-sessions/:id/permission/:permissionId/{accept,deny}` → 204 no-op when `opencodeClient.respondPermission` is absent.
- `PUT /opencode/providers` → 501 ("edit opencode.json directly") until `opencode_plugin_config.ts` writer lands.
- `GET /opencode/commands` → `[]` until `client.command.list` is wrapped.

### Project-state hygiene

- Local plan/issues match GitHub state (milestone #86, issues #586–#591 closed; M2–M5 implementations posted to PRs without per-issue tickets).
- All 5 branches pushed and tracked; no uncommitted local work outside `auth-strategy-probe.ts` (pre-existing untracked dev script).

## Prior Status (2026-05-14, session-end snapshot — PRE-merge)

🟢 **Agents chat was fully working end-to-end** at PR #574 merge: user bubble right-aligned, assistant streams in place, Enter sends, auto-resume rebinds orphan sessions.

**Routing verification (live, `/opencode/auth/`):** authed providers = `["openrouter","anthropic","openai","github-copilot"]`. Local cred sources = `{"claudeCode":true,"codex":true}`. So:
- `claude-code` → `anthropic / claude-sonnet-4-6` (direct, via `opencode-claude-auth` Keychain bridge)
- `codex` → `openai / gpt-5.3-codex` (direct, via `opencode-openai-codex-auth`)
- `gemini-cli` → `openrouter / google/gemini-3.1-pro-preview-customtools` (Google not signed in)
- `opencode` (bare) → `openrouter / anthropic/claude-sonnet-4.6` (fallback)

Automated checks (last run, post 9b26aa1):
- **417/417 tests** (vitest, api_server) — `agents_ws_e2e.test.ts` has 4 cases (chat→server, server→chat, full round-trip, auto-resume regression)
- **tsc --noEmit** — clean
- **flutter analyze --no-fatal-infos** — clean (info-level findings only)
- **dart format --set-exit-if-changed** — clean
- **flutter test** — 180/180
- `ai-workflow checks --level pr` → exit 0

## Outstanding Issues (must verify before merge)

| # | Issue | Status | Notes |
|---|---|---|---|
| 1 | **Follow-up WS prompts dropped / no chat messages rendered** | **CLOSED** — user smoke-verified the parts-based chat thread renders user + streaming assistant bubbles correctly across all four agent kinds. Full chain in "Opencode Desktop UI port + auto-resume" section below. | — |
| 2 | **Gemini direct route requires Google OAuth, no other path** | UI tile shipped (`f501791`), user has not signed in. | `opencode-gemini-auth` plugin handles the listener on :8085; user clicks "Sign in with Google AI account" → polls /opencode/auth/ until `google` appears. Without it, gemini-cli falls back to `openrouter` which is rate-limited on this account. |
| 3 | **OpenRouter key rate-limited** on the live test account | Not a code issue. | Surfaces as `Error: Key limit exceeded (total limit). Manage it using https://openrouter.ai/settings/keys` via the new error-message extractor. User should top up at https://openrouter.ai/settings/keys or remove openrouter as fallback. |
| 4 | **macOS Keychain prompt on every app launch** | Cached per session, but the OS still prompts the first call after each app restart. User asked for this earlier. | Working as designed — Keychain access requires confirmation each new process. Cache lives inside `CredentialsBridgeService` and only re-prompts on `auth.set` failure within the same process. |
| 5 | **User-input messages not persisted to DB** | Known gap; assistant-only persistence currently. | `agent_session_messages` only contains `role: 'output'` (assistant) and `role: 'system'` (errors). User prompts are sent via WS and never written to the table. If a user reopens an old session they see assistant turns but no preceding user inputs. |
| 6 | **Local SDK type defs hand-maintained** | Risk: drift from `@opencode-ai/sdk` releases. | `apps/api_server/src/@types/opencode-ai-sdk.d.ts` is a hand-written subset. The cast pattern `as unknown as { data?: T; error?: E }` covers the actual runtime shape. After SDK upgrades, re-run `apps/api_server/scripts/auth-strategy-probe.ts` (gitignored) to catch breakage. |
| 7 | **`tasks_controller.test.ts` vitest flake** | Pre-existing, not blocking. | One test ("returns only open tasks (default)") intermittently fails when the full suite runs; passes in isolation. Cross-test pollution. Survives the rework unchanged. |
| 8 | **GitHub Copilot OAuth is custom-implemented** | Working, but tied to an upstream client_id. | We reimplemented the device-flow in `api_server/src/services/github_copilot_device_auth.ts` because the SDK's plugin polling can't be driven over HTTP RPC. Hard-codes GitHub `client_id=Ov23li8tweQw6odWQebz`. If GitHub revokes/rotates that ID, we have to update. |

## Opencode Desktop UI port + auto-resume (2026-05-14, commits d8b929d, 5591d51, a067083, 1fc8768, ef5ea12)

End state: confirmed working in the running app — claude-code, codex, opencode sessions all stream user + assistant bubbles correctly via OpenRouter.

The path to "working" required **five** distinct fixes, in this order. Future agents should treat this section as the canonical record of what these commits actually solve.

1. **Parts-based chat model (d8b929d).** Mirror Opencode Desktop's renderer (`/tmp/opencode-ref/packages/app/src/context/global-sync/event-reducer.ts`): one ChatMessage per session, one ChatPart per message, deltas mutate `part.text` in place. Replaces the old `_LiveOutputBuffer` + `_transcript` split. New WS event types forwarded by the bridge: `message.updated`, `message.part.updated`, `message.part.delta`, `message.removed` — each carries the SDK's `messageID`/`partID` intact so the Flutter reducer can address parts correctly.

2. **End-to-end WS suite (5591d51).** `agents_ws_e2e.test.ts` spins up a real http.Server + ws_gateway + stream bridge with a vi-hoisted SDK event queue. **Caveat:** the original three tests fed event shapes I assumed; one of them (`message.part.delta`) DID match the real SDK, the others use the SDK's actual SSE event union. Always verify mock fixtures against `/tmp/opencode-ref` before trusting the suite.

3. **`opencode` agent OpenRouter fallback + auto-resume (a067083).** Two distinct fixes in `ws_gateway.ts` + `agent_model_resolver.ts`:
   - `agent_model_resolver` now lists `openrouter / anthropic/claude-sonnet-4.6` for the bare `opencode` agent kind. Without this, OpenRouter-only setups got `Routing opencode session ... via <unmapped>` and prompts were silently dropped.
   - `ws_gateway.session.input` now auto-resumes orphan sessions: if `opencodeSessionMap.get(id)` is undefined (post-restart), pull cwd + name from the DB row, create a fresh SDK session, register the mapping, start the stream bridge, then forward the prompt. The user never sees the seam. Regression test in `agents_ws_e2e.test.ts`.

4. **WS connect only after server-ready (1fc8768).** `AgentsController.initialize()` runs at app launch, before the spawned api_server is up — `_agentServerController.isReady` is false, the controller gated out of `_repository.connect()` and never retried. Now it subscribes to `AgentServerController` (a ChangeNotifier) and calls `_tryConnectWs()` on every transition. This was the actual reason no WS frames reached Flutter for the longest time.

5. **Enter-to-send in chat composer + messages reply box (1fc8768 + ef5ea12).** `Focus` + `KeyEvent` handler around each TextField; `Enter` sends, `Shift+Enter` newlines.

## Chat round-trip fix (2026-05-14, commits 3e4df87 + f547a2c)

Diagnosed seam (recorded so future agents don't rediscover it):

- Backend `opencode_stream_bridge.ts` broadcasts deltas as `{type:'output', id, data}` which Flutter routes to `_liveOutputBuffer` (preview only). On `session.idle` it persisted the assistant turn to DB and broadcast `session.status` — **never `transcript.append`** — so the streamed text never finalized into the visible chat transcript.
- Flutter `agents_controller._onWsMessage` had no case for `TranscriptAppendMessage`, `output.flush`, or `error`, so any such frame would have been silently dropped anyway.

Fix applied (3e4df87):
- Bridge emits `{type:'transcript.append', id, role:'output', text}` on `session.idle` after persisting (only when `pendingText` is non-empty and the session has not errored this turn).
- On `session.error` with partial `pendingText`, the bridge flushes a `transcript.append` BEFORE the `error` frame and clears `pendingText` so a follow-up `session.idle` does not re-emit.
- `streamSession` logs an entry line so SSE subscription start is visible.
- Flutter controller handles `TranscriptAppendMessage` (append to `_transcript`, clear `_liveOutputBuffer[id]`) and `WsErrorMessage` (append role:`'system'` entry, clear live buffer). Both scoped to `_selectedSessionId` so background-session frames don't pollute the visible transcript — background transcripts reload on session select.
- `WsErrorMessage` model now carries `id`.

Cleanup (f547a2c): removed pre-existing dead `_hasCodex` field in `ai_account_section.dart` that was blocking `flutter analyze --no-fatal-infos`.

Tests added: `apps/api_server/src/__tests__/opencode_stream_bridge.test.ts` — 3 cases (delta+idle → transcript.append with accumulated text; error after partial delta → transcript.append precedes error; idle with empty buffer → no transcript.append).

Remaining: manual UI smoke. The "split UI" (live preview block + finalized transcript) stays in place until issues #593/#594 collapse it into a parts-based chat thread.

## Recent Commits (31 stacked on opencode-engine-issue-564 since 70b87d7)

### Auth rework — spec phase
| SHA | Topic |
|---|---|
| `af7100e` | docs(spec): opencode auth rework design |

### Issue A — SDK `.data` unwrap (5 commits)
| SHA | Topic |
|---|---|
| `7375953` | unwrap res.data in listProviders |
| `9d3fa2c` | unwrap res.data in listModels |
| `ee7b283` | unwrap res.data in setAuth |
| `c99b821` | unwrap res.data in session methods |
| `7e9dfa4` | unwrap res.data in OAuth methods |

### Issue B — Auth source-of-truth (4 commits)
| SHA | Topic |
|---|---|
| `d29f4b5` | add OpencodeAuthStore (reads ~/.local/share/opencode/auth.json) |
| `e3a590f` | expose listAuthedProviders via auth store |
| `5ecc83a` | capabilities now reads from auth store, not catalog |
| `7199c1a` | GET /opencode/auth/ returns authed providers from auth store |

### Issue C — Anthropic Claude Code creds bridge (4 commits)
| SHA | Topic |
|---|---|
| `4f26be9` | read Claude Code creds from Keychain or file |
| `54cc1dd` | bridgeAnthropic + refresh via claude.ai (correction from `console.anthropic.com`) |
| `b740ea6` | bridge route + sources discovery |
| `9b09f58` | 30-min background refresh loop |

### Issue D — Flutter UI rework (1 commit, bundled D1/D2/D3)
| SHA | Topic |
|---|---|
| `4b2f6a4` | Flutter auth UI rework (subscription tile, polling, capability refresh) |

### Smoke-driven fixes E/F/G + iterations
| SHA | Topic |
|---|---|
| `b9fd5de` | OpenAI OAuth uses methodIndex=1 paste-back |
| `10df29d` | reimplement GitHub Copilot device flow in api_server |
| `1bc44f8` | route agent sessions to preferred provider/model |
| `08c4ada` | route via openrouter + show connected indicators |
| `bde0b91` | smart route fallback + persist session errors |
| `b2eefaa` | prefer github-copilot over openrouter for claude-code |
| `592624b` | persist session status + assistant messages |
| `cd80584` | look up sessionID from info/part for message events |
| `2184fef` | subscribe per-cwd + persist assistant turns |
| `2d51e9c` | readable error messages + don't clobber closed status |
| `928a28b` | route to user's direct provider account, not aggregator |
| `7499416` | auto-install community auth plugins on startup (claude-auth, codex-auth, gemini-auth) |
| `f501791` | Google Gemini OAuth tile + polling completion |
| `40d4fee` | **[verified by code review]** WS gateway passes model to follow-up prompts |
| `3e4df87` | **[chat round-trip]** Bridge emits transcript.append on idle/error; Flutter handles TranscriptAppendMessage + WsErrorMessage |
| `f547a2c` | chore: remove pre-existing unused `_hasCodex` field that was blocking flutter analyze |

## Issues Completed

| # | Description | Commit |
|---|---|---|
| #564 | Install @opencode-ai/sdk + OpencodeClientService | `f13b033` |
| #565 | Init SDK on startup + /opencode/health endpoint | `baaa245` |
| #566 | Replace which-based capabilities with SDK providers | `de0f00b` |
| #567 | Replace PTY subprocess with SDK sessions | `6b797a4` |
| #568 | Opencode SSE stream bridge | `6b797a4` |
| #569 | Auth endpoints (OAuth + API key) | `aacaba0` |
| #570 | Flutter auth UI (Settings + ManageAgentsView) | `2109324` |
| #571 | Remove old PTY transcript, status service, reaper | `71697c6` |
| #572 | Remove .clideck-workflow directory | `8a95360` |
| #573 | Flutter data sources for Opencode engine | `8a95360` |

## Post-Issue Integration Fixes

| Fix | Description | Commit |
|---|---|---|
| WS gateway | Replaced `ptyRunner.sendInput()` with `opencodeClient.prompt()`. Removed all ptyRunner refs | `f152e69` |
| Stream bridge | Rewrote to properly subscribe to Opencode SSE events and map to WS format | `f152e69` |
| Session ID mapping | `opencodeSessionMap` routes local session IDs → SDK session IDs for prompt routing | `f152e69` |
| Auth flow | OAuth opens system browser via `url_launcher`. `GET /opencode/auth/` lists connected providers | `f152e69` |
| Tests | Updated agent_sessions.test.ts to mock opencode_engine instead of pty_runner | `e2a35c7` |

## Settings UI Cleanup (2026-05-13, issues #575–#579)

| # | Fix | Commit |
|---|---|---|
| #575 | Remove CLI command field, "Supports session resume" checkbox, and Configured/Needs-setup badge from Manage Agents cards. Drop unused CLI-era fields from `AgentConfig` (DB schema retained). | `f99fa7d` |
| #576 / #578 / #579 | Surface real OAuth/auth error message instead of generic fallback. Guard `jsonDecode` in `_saveApiKey` against non-JSON (HTML) error bodies. `getOAuthUrl` now returns `{error}` rather than swallowing exceptions. Provider IDs `anthropic` and `github-copilot` confirmed correct against SDK models cache. | `ab79260` |
| #577 | Remove "Claude Code CLI" / "Codex CLI" install rows + Refresh button + "Install Claude Code" banner from Settings AGENT SERVER card. Collapsed to a single "Running on localhost:4001" indicator. | `143f1eb` |

## Resolved Gaps (2026-05-13, branch `opencode-engine-issue-564`, pending merge)

| # | Resolution |
|---|---|
| #580 | `AgentSessionsController.resume()` now creates a new SDK session via `opencodeClient.createSession(name, cwd)`, registers `opencodeSessionMap`, starts the SSE stream bridge, and sets status to `starting`. Resumed sessions do NOT reattach prior SDK conversation history — per #580 scope. |
| #581 | `agent_configs_repository` no longer persists or echoes the five legacy CLI fields (`command`, `canResume`, `resumeCommand`, `sessionIdPattern`, `outputMarker`). DB columns retained for rollback safety. |

## Code Review Fixes (2026-05-13)

| Fix | File | Commit |
|---|---|---|
| Test mock missing `promptAsync` → TypeError → 400 not 201 | `agent_sessions.test.ts` | `55f8bff` |
| `_ready` closure not reset in afterEach → test order poisoning | `agent_sessions.test.ts` | `55f8bff` |
| `subscribed` stuck true when `subscribeToEvents()` returns null | `opencode_stream_bridge.ts` | `55f8bff` |
| `opencodeSessionMap` never cleaned up on session DELETE (memory leak) | `agent_sessions_controller.ts` | `55f8bff` |
| Double `expandHome(cwd.trim())` — redundant re-expansion | `agent_sessions_controller.ts` | `55f8bff` |
| Silent catch blocks with no logging in service methods | `opencode_client_service.ts` | `55f8bff` |
| `_refreshConnectedProviders` called wrong endpoint, never populated state | `ai_account_section.dart` | `55f8bff` |

## Smoke-Found Fixes (2026-05-13, stacked onto `opencode-engine-issue-564`)

| # | Resolution | Commit |
|---|---|---|
| #585 | `apps/api_server/scripts/postinstall.js` force-rebuilds `better-sqlite3` from source against install-time Node and writes `apps/api_server/.node-runtime.json` sentinel. Flutter `_findNode()` reads the sentinel first so the api_server is spawned with the same Node the binary was built against; fallback candidate order now puts `/opt/homebrew/bin/node` ahead of `/usr/local/bin/node`. `engines: ">=20 <25"` pinned. `SKIP_BETTER_SQLITE3_REBUILD=1` escape hatch for CI. | `44fc175` |
| #583 | Settings AI Accounts now collects the OAuth code via a paste-back dialog (matches the SDK's out-of-band flow). After opening the browser we show the SDK's `instructions` field plus a code input, then `GET /opencode/auth/<provider>/callback?code=<pasted>` and refresh the connected-providers list. | `b374279` |
| #584 | `agents_capabilities_routes.ts` introduces `AGGREGATOR_PROVIDERS = ['openrouter', 'together', 'groq']` and extends `agentToProvider` so each CLI agent treats any aggregator as a satisfying provider. Connecting only OpenRouter now flips `claude-code` / `codex` / `gemini-cli` to true. | `b7859ce` |
| #582 | `_NoCLIDetected` → `_NoAgentsAvailable`. Copy rewritten to "Connect a provider in Settings → AI Accounts" with an inline `FilledButton.icon` that pushes `SettingsView` directly. | `5b3c8c4` |

## Known Gaps (tracked, not blocking merge)

| Gap | Detail |
|---|---|
| `pty_runner.ts` dead code | Still present in the repo. No production imports. Tracked in existing [#571](https://github.com/ajhochy/Rhythm/issues/571) (deletion of legacy PTY files). |
| Custom (non-preset) agent configs always show "Unavailable" (#575) | `AgentServerController.isAgentAvailable` keys the capabilities map by preset ID (`claude-code`, `codex`, `gemini-cli`, `opencode`). Custom configs have no entry. Acceptable until users can author custom Opencode providers. |
| Controller-side validation of legacy CLI fields on POST/PATCH | Repository no longer persists or echoes legacy CLI fields (#581 resolved), but `agent_configs_controller` still requires `command` and validates `resumeCommand`/`canResume` on input. Follow-up needed if/when the Flutter client stops sending them. |
| GitHub Copilot OAuth may use device flow (#579) | Current flow assumes redirect URL. The paste-code dialog from #583 will display the SDK's `instructions` field, but a device-flow payload may still need bespoke UX. Self-diagnosing — defer redesign until first user hits it. |
| `tasks_controller` vitest flake | One `GET /tasks` test ("returns only open tasks (default)") intermittently fails when the full vitest suite runs, but passes in isolation and on re-run (367/367 green). Cross-test pollution; not blocking merge. |
| Aggregator API-key registration (#584 follow-up) | Per #584 notes, `opencodeClient.listProviders()` may not surface API-key-only providers in every case. If smoke shows the API-key path doesn't register an aggregator with `listProviders()`, file as a follow-up against `opencode_client_service`. |

## End-to-End Flow
```
Flutter → POST /agent-sessions → controller creates SDK session + stores mapping + starts bridge
Flutter → WS session.input → ws_gateway → opencodeClient.prompt(sdkId, text)
Opencode → SSE events → stream bridge → WS broadcast → Flutter output
Flutter → DELETE /agent-sessions/:id → controller stops bridge + clears map entry + marks closed
```

## Branch / PR
`m1-projects` — branched off clean `main` at `84eef44` (post PR #574 merge). Local-only commit `7ccadbf` adds the M1 issue bodies under `docs/ai/generated-issues/`. M1-1 implementation is on disk, not yet committed.

Historic: `opencode-engine-issue-564` → PR #574 — **MERGED** 2026-05-14.

## Active plan
`docs/ai/current-plan.md` is no longer a placeholder. It contains the full 8-issue UI port plan (Opencode Desktop reference at `github.com/anomalyco/opencode/tree/dev/packages/desktop`). Status of the plan's issues:

- **#590 / #591** (chat round-trip fix) — **DONE** (3e4df87). Manual UI smoke pending.
- **#592** (error path partial flush) — **DONE in 3e4df87** (folded into same commit).
- **#593–#597** (parts-based chat thread, sessions sidebar polish, details panel, model echo in DTO) — not started.

## Issue backlog state (2026-05-14)

All Opencode-implementation issues (#564–#585) are closed. Final disposition:

- **#564–#570, #572, #573, #575–#578, #582, #584, #585** — closed with commit references. Implementation matched the original issue.
- **#571** — closed by ae597b2; `pty_runner.ts` deleted.
- **#581** — closed by ae597b2; controller-side validation of legacy CLI fields removed; route tests updated to assert accept-and-ignore.
- **#579 (GitHub Copilot OAuth)** — closed; different approach taken (device flow in api_server instead of redirect-based OAuth through the SDK plugin).
- **#583 (OAuth callback lands on opencode.ai)** — closed; different approach taken (paste-back dialog in Settings instead of redirect-back to localhost).
- **#580 (resume() implementation)** — closed; scope note: resumed sessions get a fresh SDK session bound to the same local id, do not reattach prior SDK conversation history. DB-persisted assistant messages still render via the legacy transcript REST path.

Open issues remaining (none Opencode-related): #48 (PCO automation rules UX), #71 (mobile MVP scope), #418 (mobile smoke fail), #476 (AgentTriggerWatcher dev-gating).

## M1 — Sessions ↔ Projects (milestone #86)

| # | Issue | Status |
|---|---|---|
| #586 | M1-1 Backend: projects table + CRUD with VCS detection | **Implemented + verified** on `m1-projects`, uncommitted |
| #587 | M1-2 Backend: agent_sessions.project_id FK + per-project listing | Not started |
| #588 | M1-3 Backend: auto-assign project on session create | Not started |
| #589 | M1-4 Flutter: Project model + repository + controller | Not started |
| #590 | M1-5 Flutter: sidebar rail + project panel with VCS chip | Not started |
| #591 | M1-6 Flutter: edit-project dialog | Not started |

### M1-1 (#586) summary

Files added/changed on `m1-projects`:
- `apps/api_server/src/database/migrations.ts` — `CREATE TABLE IF NOT EXISTS projects` + `idx_projects_archived` (additive, idempotent)
- `apps/api_server/src/models/project.ts` (NEW) — `Project`, `CreateProjectDto`, `UpdateProjectDto`
- `apps/api_server/src/services/vcs_probe.ts` (NEW) — `probeVcs(cwd)` via `/bin/zsh -lc` (rev-parse → symbolic-ref → status --porcelain); best-effort, never throws
- `apps/api_server/src/repositories/projects_repository.ts` (NEW)
- `apps/api_server/src/controllers/projects_controller.ts` (NEW) — expandHome, absolute-path rejection (400), trailing-slash normalization, VCS re-probe on cwd change
- `apps/api_server/src/routes/projects_routes.ts` (NEW) — mirrors `agent_sessions_routes` AGENT_LOCAL bypass
- `apps/api_server/src/app.ts` — register `projectsRouter` at `/projects`
- `apps/api_server/src/__tests__/vcs_probe.test.ts` (NEW) — 5 tests (git, non-git, dirty toggle, detached HEAD, mocked spawn failure)
- `apps/api_server/src/__tests__/projects_routes.test.ts` (NEW) — 8 tests (CRUD + archive filter + cwd re-probe + refresh-vcs)

Endpoints: `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `POST /projects/:id/refresh-vcs`.

## What to do next (resume notes)

1. **Manual UI smoke** of M1 in particular — rail visible, project create/edit dialog, VCS chip, session filter. PR #592 is the gating change for everything stacked on top.
2. **Merge PRs in order** (`#592 → #593 → #594 → #595 → #596`); each one rebases cleanly because of the stacked branch strategy.
3. **Pick up the UI integration follow-ups** as separate small PRs:
   - Session header chip (M2) — biggest user-facing win.
   - agents_view rewrite to host `SessionSidePanel` + render tool/permission cards inline (M3).
   - Settings tabs scaffold (M5) — unblocks the dark-mode audit.
4. Outstanding non-M1..M5 items still apply: Google AI sign-in for direct gemini routing; OpenRouter rate-limit on test account; plugin requirements doc in CLAUDE.md.
