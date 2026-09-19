---
date: 2026-09-18
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: https://github.com/ajhochy/Rhythm/pull/1544
issues: [1373, 1496, 1509, 1510, 1511, 1512, 1513, 1514, 1515, 1516, 1517, 1518, 1519, 1520, 1521, 1522, 1523, 1524, 1540, 1541, 1542, 1543]
status: draft-pr
tags: [run, rhythm]
---

# Mega mobile, Electron, and Hermes run

## Files

### Shared Electron web UI

- Added the shared `ListInspector` and `useSelectedId` contract, then adopted it in Agents Tasks, Agent Tools, Agent Settings, Facilities, Messages, Projects, Automations, Integrations, and main Settings.
- Added the shared `Splitter` primitive across Shell, Agents, SessionRail tools, and `ListInspector`, with persisted sizes, keyboard control, reset, and responsive clamping.
- Refined Tasks and Agents transcript reading comfort, the Agents view-options and child-loading controls, Add project, native directory selection, and the per-profile editor.

### Mobile and Electron shell

- Added the mobile relay kill switch and direct-pairing fallback for #1373.
- Made processing audio opt-in, migrated the legacy saved default once, hardened playback cleanup, and repaired Electron notification deduplication for #1510.
- Added native directory-picker IPC for #1496 and deterministic Rhythm icon assembly/identity coverage for #1520.

### Hermes inside Rhythm

- Added the consent-gated Hermes sidecar supervisor on `127.0.0.1:9121`, honest lifecycle states, owned-process shutdown, and the `RHYTHM_HERMES_ENABLED` gate.
- Added the isolated Hermes dashboard route and `WebContentsView`, a two-intent document-bound bridge, main-process-only dashboard token handling, and Rhythm theme injection.
- Recorded a Phase 0 packaging NO-GO: no bundled Python/Hermes payload ships from the unqualified 404.5 MiB diagnostic.

### Rhythm inside Hermes

- Restored `packages/rhythm-workspace-ui` as a standalone host-neutral package with React 18/19 singleton coverage and root convenience scripts.
- Finished the unified fork feature pack, its bounded operations and tools, production packaging checks, local installer, provenance, and lifecycle/live-gate guide.

### Evidence and documentation

- Added issue snapshots, worker reports, acceptance-contract summaries, Hermes campaign issues, gate receipts, and durable decision records under `docs/ai/`.

## Checks

The aggregate gate log is copied verbatim below.

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

The final standalone mobile E2E rerun was **pending at time of writing**.

## Notes

- The run used one Codex worker per isolated `.mega-wt/<workstream>` worktree; the integration worktree collected worker commits and reports while workers left their own trees uncommitted.
- The first 13 workers used `gpt-6-astra`. After AJ's 19:15 instruction, remaining dispatches used `gpt-5.6-sol` to reduce token burn.
- Wave 2 launched eight view migrations in parallel. Host load rose from 22 to a one-minute peak of 170; follow-up fixes and adversarial reviews were queued behind a load-below-30 waiter rather than killing active workers.
- Reviews used issue-first expected-behavior checklists derived from the committed issue bodies before inspecting code. Review 2 was relaunched with that framing; review 1 was retained and scheduled for a second framed pass over its scope.
- The Phase 0 bundled-payload spike returned NO-GO. The supervised installed-Hermes sidecar remains the only shipping Hermes runtime path in this draft.
- Merge, signed-package qualification, production/provider verification, physical-device checks, and AJ's manual smoke remain separate gates.

## Finishing pass — current evidence supersedes the earlier snapshot

### Files

- Relay server/client/protocol and mobile PTY routing now carry text/binary terminal traffic with bounded frames, device/host authorization, repeated credential checks, and sanitized diagnostics. See the dedicated #1373 run.
- Messages preserves title search, read hydration/receipts, original path deep links, creation/deletion navigation and recovery. Facilities retains conflicts/setup/external signals, invalid-item recovery, selected details across filtering, and valid definition-list semantics. Shared ListInspector gains optional filtering, loading and no-results content without changing default callers.
- LiveSchedulesTool selects the authorized history root before navigating Agents. Tasks omits redundant visible grouping metadata while preserving full accessible status/date context. Planner reduces vertical padding and uses 184px initial day widths, retaining 44px actions and 120px title assertions.
- Electron readiness receives injectable time/delay; HTTP rejection and invalid-JSON tests retain exact retry/deadline assertions. E21 uses a controlled browser clock to distinguish socket updates from the existing two-second poll.
- Hosted cleanup now matches only the current run's name/title/label marker; another run's rows and marker mentions in notes are preserved.
- Fork final source repairs the reproduced JSX shim failure through host React only. The speculative SDK hook replacement and its unsupported mock were removed. Fork commit `60dbbc3906` pushed to draft PR #17; no checks reported by GitHub at observation.

### Checks

- Native brief: **1 PASS / 0 FAIL / 9 BLOCKED**. Live build and owned Electron launch completed; sidecar ready and HTTP 200. Native sign-in failed before browser launch because the public Google desktop client ID was absent. Packaged Finder/Get Info icon passed. No :4001/:4096 listener or `RHYTHM_LIVE_TOKEN` was present at preflight. See the visual table and numbered screenshots.
- Hosted requested command: **0 passed / 1 setup failure / 33 not run**. Six collection probes returned 403. No writes were reached; no global zero-prefix claim is possible without authentication. Messages lacks delete and Automations lacks atomic paused-create in the current live suite, so those writes remain explicit skips even after credentials are supplied.
- Fork operator checklist: **5 PASS / 1 FAIL / 5 BLOCKED**. Final canonical tests **283/283** and packaging **62/62**. Native route registration/current diagnostic module were confirmed but no workspace mounted. CLI reload is unsupported; process-local rediscovery is narrower. Disable/removal passed on disk and in CLI, while the running backend retains a cached tool row. Both backups and auth were preserved. Final JSX-only package was not reinstalled after cleanup.
- Electron: `npm test` **163/163 three consecutive times**, plus `npm run typecheck && npm test` final parent run **163/163**, exit 0. `npm run package:mac` exited 0; icon smoke used that package before final relay callback edits and does not establish final packaged relay behavior.
- Mobile: typecheck/lint/contract exit 0; **32 suites / 133 tests**; three pre-existing lint warnings.
- Focused web repair evidence: initial task metadata **2 red**, then shared primitive/comfort **19 green**; schedule-history **1 red → 1 green**, full dedicated file **4 green**; Planner/dashboard **26 green**; Integrations **15 green**; Messages/Facilities/Projects **55/58**, then exactly three repaired failures **3/3 green**. The Facilities accessibility failure was a real invalid `<dl>` grouping; the announcement moved to `<dd>`.
- E21 originally passed one run and failed another, then **failed alone** (2 expected lists versus 4 observed). The source's two-second timer fired during the two 800ms waits plus setup. Controlled-clock repair: **1/1 passed**, preserving zero token-driven requests and separately requiring two scheduled list requests. No production polling change.
- Preliminary full web run: **422 passed / 34 failed / 47 skipped**. Product and rendered-contract repairs followed; concurrent package builds also changed dist, so final browser production builds were serialized. Preliminary evidence is retained locally and is not claimed green.
- Earlier API full run reported a sandbox-foreground timing failure and was stopped after prolonged inactivity; another was stopped when source changed. Final source is being checked separately. Earlier fork M10 full-run failure followed by isolated **5/5** remains a flake; its 2,500ms threshold is unchanged.
- `cd apps/web && npm run test:electron-slices`: **155 passed / 4 skipped / 0 failed**, all 16 configurations completed, exit 0. The skips require live backends.
- Final API build exited 0. `cd apps/api_server && npx vitest run --maxWorkers=2 --silent` exited 0: **660 files / 6,180 tests passed**, 130 files / 250 tests skipped; 707.36s.
- Exact-source real API/engine/relay live gate: **1/1 passed in 4.12s**, same behavioral assertions listed above; `tools/dev/sandbox.sh down` exited 0, synthetic fixtures removed, all four reserved ports free.
- Final full web gate is recorded in the authoritative outcome below.
- GitNexus compare against main: `node .gitnexus/run.cjs detect_changes --scope compare --base-ref main --repo /Users/ajhochhalter/Documents/Rhythm/.mega-wt/integration --limit 5` exited 0: **369 files / 2,218 symbols / 4 flows / MEDIUM**. This is the whole mega branch and a structural index, not runtime evidence. Pre-edit ListInspector impact was CRITICAL (30 direct, 1 flow); Planner page impact HIGH; both were reported before edits. TaskCard/usePlannerLayout were LOW. Anonymous E21 test title did not resolve in the index (UNKNOWN); its only edit controls test timing.

### Notes and cleanup

Only the owned Electron smoke instance was quit; its sidecar stopped. Flutter, Hermes Desktop, and the user's live service ports were not killed. No hosted/native product rows were created and no draft was sent. Synthetic relay fixture data belongs only to the disposable sandbox. No new worktree was created in this finishing pass. Preserve concurrent commits `238438da` and `86bfd1a7` and the fork's four pre-existing dashboard-dist deletions.

The remaining acceptance includes missing configuration/authentication and the installed-host mount blocker, in addition to physical iPhone/audio, TestFlight/device and Cloudflare/NAS work. Narrower local proof cannot satisfy those gates.

## Decisions

The full finishing-pass decision ledger is [CHECKLIST.md](../../../.proof/mega-2026-09-18/CHECKLIST.md#decisions), supplemented by the issue-first review, relay, Electron timing, and fork run documents. Decisions 1–43 preserve the original-issue contracts, credential/data boundaries, strict timing assertions, current-artifact distinctions, draft status, and exact cleanup ownership. Earlier campaign decisions remain in Git history; none of its historical gate counts replace current evidence.

### Final web storage repair

The settled-source full web run exited 1: **456 passed / 1 failed / 47 skipped** (15.6m). The sole failure was the existing sandboxed Studio shell test. Trace records show `SecurityError` from `readLocalUserPreferences`: its `localStorage` default parameter was evaluated before its try/catch, crashing Composer/SessionRail boot in an opaque-origin iframe. A new Node regression with a throwing storage getter failed first (**2 pass / 1 fail**) and passed after moving default resolution inside the guard (**3/3**). Existing storage, sandbox and rendered assertions remain intact; the focused shell/settings group passed **4/4**. GitNexus pre-edit impact: **HIGH, five direct callers, zero indexed flows, three modules**; warning reported before the two-line source edit. Full web and Electron-slice gates are rerunning on this final source.

### Historical mobile parity follow-up

The previously pending #1174 isolated mobile parity rerun used only the normal fake OpenCode and Expo fixture servers: **3 passed / 1 failed** (terminal menu timed out). The exact failed case then passed alone **1/1**. This is recorded as a flake under the user's rule, not a repaired product defect. No source or assertion changed and no real API ran. The earlier pending snapshot above is retained as history.

### Final artifact and preference-boundary follow-up

The exact JSX-only fork package was reinstalled after the diagnostic cleanup. Installed SHA matched the validated final artifact; native registry probing confirmed final SDK-hook code and successful React element creation, but still zero workspace roots. The M3/read/ACP/draft gate remains blocked. Screenshots 15/16 supersede candidate-only uncertainty; cleanup again preserves the running app, backups and auth.

Final review found remaining preference writes/resets could throw from Settings and View options. Red rendered tests established both failures. SessionRail and Settings now catch persistence errors, display failure and update current/saved state only after successful writes. Failed keyboard Save/Reset preserves the dirty draft. Opaque-origin tests retain storage denial; the Settings harness permits form events, while the original shell sandbox remains unchanged. GitNexus impact was LOW for both enclosing components. Focused rendered checks **14/14**, preference unit checks **3/3**; full web and slice reruns use this settled source.

Final fork evidence-only follow-up pushed as `c5c9c1e17b`; PR #17 updated. Final native Rescan again removed the Desktop toggle/destination and retained the running host's cached native-tools row. Both install roots and CLI registrations are absent; no restart was performed.

The first post-preference Electron manifest rerun stopped before E22 because port 4189 was occupied. PID 56675 and npm parent 56626 matched this run's interrupted E22 log, launch time and integration Vite path. Only those proven owned processes were terminated; a clean full-manifest rerun followed. No protected app/API/engine process was touched.

Final-source clean Electron manifest rerun: `cd apps/web && npm run test:electron-slices` → **155 passed / 4 skipped / 0 failed**, exit 0 across all 16 configurations (`web-final-slices-clean.log`). This run follows every preference source edit and the owned orphan cleanup.

## Authoritative final local outcome

- `cd apps/web && npm run typecheck && npm run build && npx playwright test`: **459 passed / 47 skipped / 0 failed**, exit 0, 13.1m after every source edit; `web-final-complete.log`.
- `cd apps/web && npm run test:electron-slices`: **155 passed / 4 skipped / 0 failed**, exit 0; `web-final-slices-clean.log`.
- `cd apps/web && npm run test:dist-smoke`: exit 0, index and two relative assets verified.
- API build and full Vitest: **6,180 passed / 250 skipped / 0 failed**; final-source real relay **1/1**; mobile **133/133**, Electron **163/163** with three consecutive readiness-proof runs; all required typecheck/build/lint/contract commands exited 0.
- Fork source tests **283/283**, packaging **62/62**; exact final native package registered and created an element but did not mount its workspace.
- Final GitNexus comparison: **370 files / 2,218 symbols / 4 flows / MEDIUM**, exit 0, after the preference changes. `git diff --check` passed.
- Restored five generated fixture PNGs to their pre-run versions; retained all requested native proof. No new worktree was created; owned Electron/sidecar, sandbox and fixture servers were stopped. No hosted/native product row was created, no draft sent, and no user row changed. Protected apps/services were not killed.

Current operator gate counts: native **1/0/9**, hosted runner **0/1/33**, fork **5/1/5**, required code/review groups **6/0/1**, in PASS/FAIL/BLOCKED order. Code groups are API, real relay, mobile, full web, Electron slices, and Electron unit/typecheck; the remaining review group has three native/subjective criteria open (#1513 8/9; #1509 9/11). Historical failures and flakes above are not erased by these current counts. Records and exact-head publication/CI are reported on the draft PRs.

### Dashboard receipt

The explicitly requested `node publish-to-rhythm.mjs run` command exited 0: `RUN reactElectronLiveSuite OK: rev 4395 -> 4396, 10 runs`. Payload status was `pending`; its data-only note was `1/0/9;0/1/33;5/1/5;6/0/1`. This proves the requested manual publication, not automatic lifecycle capture.
