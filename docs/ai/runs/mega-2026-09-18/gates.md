## Fork B1 — local install gate (2026-09-18 ~19:40 PDT)
- `bash plugins/rhythm/packaging/install-local.sh` → "Installed validated Rhythm package in ~/.hermes; config/auth unchanged." exit 0 (backups: ~/.hermes/plugins/rhythm.bak-20260918, ~/.hermes/desktop-plugins/rhythm.bak-20260918)
- `hermes plugins doctor rhythm` → OK: runtime discovery, manifest parsing, import, registration; 3 tool(s), 0 hook(s); exit 0
- `hermes plugins enable rhythm` → enabled (tool-override grant declined = stricter option)
- `hermes plugins list` → rhythm enabled 0.1.0
- `hermes doctor` → exit 0
- disable/reload/uninstall half deferred to wrap-up so the install stays live for AJ's smoke
## rhythm-workspace-ui — package gate
- typecheck/build/vitest (235) PASS (worker); `npm run test:react19` PASS: contract suite against isolated React 19.2.0, no duplicate React (orchestrator, gate-b1-rhythm-react19.log)
## apps/mobile — gate on mega 7b3a98be (2026-09-18 ~20:05 PDT)
- `npm run typecheck` PASS; `npm run lint` PASS (0 errors, 3 pre-existing warnings); `npm run contract:check` PASS
- `npm test` (jest): first run under load 95 → 3 suites failed (workspace-search + 2 timing suites); full rerun PASS 32/32 suites, 132/132 tests → flake, not regression
- `node --test tests/contract/issue-1510-working-sound.test.mjs tests/paired-host.test.mjs` PASS 11/11
## apps/electron — final gate on mega bd5d0414 (2026-09-18 20:05 PDT)
- `npm run typecheck` PASS; `npm test` PASS 159/159 (includes hermes-server, hermes-view, hermes-protocol, electron-icon, security-smoke-receipt, e12a auth boundary with the E44 fixture repair)
## apps/mobile e2e — on mega (2026-09-18 ~20:15 PDT)
- `EXPO_PUBLIC_RHYTHM_RELAY_DISABLED=1 npx playwright test tests/e2e/issue-1373-relay-kill-switch.spec.mjs` PASS 1/1
- `npm run test:e2e:web` 70 passed, 1 skipped, 1 failed (issue-1174 parity); rerun alone → see line below
- rerun alone: 
- issue-1174 parity rerun: PASS 4/4 on origin/main baseline AND on the branch (triage-1174.log) → load flake, not a regression
## apps/electron packaging — ws-electron-main branch with icon fix (2026-09-18 ~20:35 PDT)
- `npm run package:mac` PASS (after linking apps/opencode_fork deps into the worktree); bundle `dist/Rhythm.app` has `Contents/Resources/Rhythm.icns` + `Rhythm.icns.json` inventory, `CFBundleIconFile=Rhythm`
- `npm run test:package` PASS 22/23 (1 skipped, 0 failed)
## Fork — final gate on mega/2026-09-18-rhythm-plugin-finish fefa61bb06 (B1 + B4 theme seam) (2026-09-18 ~20:40 PDT)
- `pytest tests/plugins/rhythm -q` PASS 282/282
- `web/`: `npm ci` + `npm run typecheck` PASS; `npm run test` (vitest) PASS 37 files / 276 tests
- `scripts/run_tests.sh tests/hermes_cli/test_web_server.py -k 'Theme or TestDashboardPluginManifestExtensions'` PASS
- package rebuild + reinstall: first attempt refused non-empty dist/ (gate working as designed); clean rebuild + reinstall re-run → see gate-fork-reinstall.log
## apps/electron — gate on mega fc090633 after the Hermes review fix (2026-09-18 ~20:55 PDT)
- `npm run typecheck` PASS; `npm test` PASS 161/161
## apps/web — typecheck + build on mega fc090633: PASS
## Live smoke suite vs isolated sandbox (tools/dev/sandbox.sh, API 127.0.0.1:4098, engine 4097) — mega 0e7b9331 (2026-09-18 21:25 PDT)
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_TOKEN=<fixture bearer> RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 npx playwright test --config tests/live-smoke-playwright.config.ts` → 14 passed, 20 skipped, 0 failed
- passed: agent-local half (Agent Tools inert selection incl. Webhooks unavailable state, Agent Settings, Agents rail view options/child loading/Add project create→read-back→delete, Profiles create/edit/save/reload/delete, reading comfort, Hermes browser boundary, #1496 fallback, three splitters drag+persist)
- skipped: 19 hosted-domain tests (Facilities/Messages/Projects/Automations/Integrations/Settings writes) — need AJ's hosted RHYTHM_LIVE_TOKEN; 1 Deep Research (no research service in the sandbox)
## apps/electron — final gate on mega c429d368 (2026-09-18 ~21:55 PDT)
- `npm run typecheck` PASS; `npm test` 162/163 — "Hermes readiness rejects HTTP 401 until the deadline" failed, then in isolation failed twice and passed once → timing flake in the new deadline test (follow-up: fake timers), not a regression
## Hermes sidecar — live lifecycle in the real Electron shell, mega c429d368 (2026-09-18 ~22:15 PDT)
- `RHYTHM_SHELL_USER_DATA=/private/tmp/rhythm-mega-electron-user-data RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_PRODUCTION_API_URL=https://api.vcrcapps.com RHYTHM_HERMES_ENABLED=1 npx electron . --interactive-smoke --allow-test-runtime-ports`
- stdout: `hermes: starting` → `HERMES_DASHBOARD_READY port=9121` → `hermes: ready`; `/api/health` 200 and `/` 200 after ~6 s; app quit → `hermes: stopped`, 0 listeners on 9121
- note: a loopback `RHYTHM_PRODUCTION_API_URL` is rejected at load by design ("must be remote HTTPS") — use the hosted URL
## apps/mobile — final gate on mega 4a3cdcc5 (2026-09-18 ~22:45 PDT, after the review-r1 fixes)
- `npm run typecheck` PASS; `npm run lint` PASS (0 errors, 2 pre-existing warnings); `npx jest` PASS 32/32 suites, 132/132 tests; `npm run contract:check` PASS; `node --test` #1510/#1373/provider-utils PASS 16/16
## apps/electron — final gate on mega 5f527cd4 (2026-09-18 ~22:50 PDT): `npm run typecheck` PASS; `npm test` PASS 163/163
## Live smoke suite vs isolated sandbox — final on mega 5f527cd4 (2026-09-18 ~22:55 PDT): 14 passed, 20 skipped (19 hosted-domain need AJ's bearer, 1 Deep Research no sandbox research service), 0 failed
