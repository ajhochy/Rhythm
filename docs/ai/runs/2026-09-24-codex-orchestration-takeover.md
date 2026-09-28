---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1558, 1577, 1574, 1565, 1491, 1579, 1582, 1572, 1468, 1569]
status: partial
tags: [run, rhythm]
---

# Claude orchestration takeover

Recovered Claude session `e8595af3-fedf-40cd-ace4-7a64f90ded3f` and its repair-3 prompts/results. All ten workers had finished before takeover; none was restarted. The September 24 authorization allowed one third repair, now exhausted. Parent read product diffs and independently reviewed web, backend, and credential-contract groups. No fourth product repair, main merge, deployment, signed/packaged native qualification, or worktree removal occurred.

## Files

- `2a9855d4`: #1558 selected project expands on each mount without rewriting saved collapse preferences. Includes contract wording reconciliation and affected fixture tests. Excludes already integrated #1552.
- `76cb29a6`: #1579 U1/U2 notification lifecycle and closed event bridge. Main owns notification text, validates targets and bounds, and clears pending state on authentication changes. Packaged U3 remains unqualified.
- This run record and project-state capture current evidence; unrelated pre-existing dirty plans/runs remain untouched.

## Independent review ledger

| Candidate | Decision and evidence | Preserved state |
|---|---|---|
| #1558 | Integrate. 9 contract + 9 regression tests; selected group reopened with saved false unchanged. | `2a9855d4` |
| #1579 | Integrate U1/U2 only. 53 host tests and 5 browser cases. Native U3 excluded. | `76cb29a6` |
| #1577 / PR #1578 | Reject P1: `ws_gateway.ts:863-866` sends provider-kind `claude-code` as engine agent, instead of profile `ocAgent=build`. Writer excludes CLI selectors and engine rejects unknown agent names; c9 mock hides regression. Required live c7 also unverified. | `dd8717ad` swarm/pr-1578-review |
| #1574 / #1573 | Hold. Current-port-only stray inventory misses older random ports (`engraph_manager.ts:137-143,637-640,965-977`). Parent-death during indexing untested. Existing serving-parent-death live test passes. | `a2581505` swarm/issue-1574 |
| #1565 | Reject P1: Integrations fixture supplies display prose to strict Timestamp parser; Google Calendar renders “Last synced Time unavailable.” Eight-surface test stops before Automations. | `db4e90a1` swarm/issue-1565 |
| #1491 | Reject P2: occupied composer schedules setState every frame while draft remains pending (`agents_view.dart:642-649`). Flutter format check also fails. | Prior `957c73c7` plus retained dirty repair; binary patch saved, no Flutter commit |
| #1582 | Reject P1: functional setSessions updater mutates transcript ref (`store.tsx:508-515,333-340`), allowing StrictMode updater replay to append a delta twice. Fixture sessions tests do not cover this. | `a47ef221` swarm/issue-1582; separate evidence `bbf5c65e` unchanged |
| #1572 | Reject P1: unknown/unavailable direct provider suppresses a valid OpenRouter route (`agents_models_routes.ts:141,160-170`), then catalog filters out direct rows. | `9f1b5da2` sol/1572-api |
| #1468 | Hold: all-issue PASS claim exceeds S1 helper evidence; actual >512 serialized request, S2 durable/multiprocess behavior, and last-message model fallback remain unproved. | `e7a45256` sol/1468-s1 |
| #1569 S0 | Reject contract freeze: five requested additions exist, but required no-write-open assertion and outbound production-secret sentinel still lack explicit contract coverage. No S1/S3/S5 branches. | `c192c8fe` sol/1569-contract |

These snapshots preserve rejected work; their internal PASS claims are superseded by this ledger. Seven WIP commits were created; #1491 stays dirty because AGENTS requires a clean Flutter format gate before any Flutter commit. No fourth repair is authorized without AJ revalidating intent.

## Checks

All checks used integration based on `a3834bf3` plus the exact two accepted slices, subsequently committed unchanged as `2a9855d4` and `76cb29a6`. The canonical gate began before the notification patch was applied; its Flutter/API/MCP/fork/mobile inputs did not change. Dedicated web/Electron checks ran after both slices were applied.

- `ai-workflow checks --level pr`: exit 0, all 16 configured stages passed (Flutter analyze/format/tests, API typecheck/lint/tests/build, MCP typecheck/tests/build, fork typecheck/session tests, mobile static/contract/fake-server/browser). This includes ISSUE_CHECKS; no redundant issue-level rerun.
- Web: `npm run build` passed (existing >500 KiB bundle warning); includes `tsc -b`.
- Standard Electron `npm test` initially returned 167 passed / 1 failed: the directory-picker preload mock lacked `ipcRenderer.on`, newly used by the accepted notification bridge. Added only the missing inert listener method to that unrelated test mock; directory-picker assertions unchanged. GitNexus file impact LOW, zero callers/processes. This is integration harness reconciliation, not a fourth candidate product repair. Full Electron rerun: 168 passed, zero failed (exit 0), recorded in `c6cee9e4`. Standard suite includes its isolated hidden Electron shell smoke; this is not signed/packaged native notification qualification. Its regenerated tracked electron-m1-shell.png was copied to local evidence then restored to HEAD, not committed.
- Electron: `node --experimental-vm-modules --test --test-concurrency=1 test/e12a-auth-boundary.test.mjs test/issue-1579-contract.test.mjs test/post-m1-phase-7-native-notifications.test.mjs` — 53 passed. `npm run typecheck` passed.
- Web: `RHYTHM_E2E_PORT=6521 RHYTHM_DIST_PORT=6522 ./node_modules/.bin/playwright test tests/contract/issue-1558-collapsed-projects.spec.ts tests/sessions.spec.ts tests/agents-add-project.spec.ts --workers=1` — 18 passed, 1 live-only skipped.
- `E16_FIXTURE=1 ./node_modules/.bin/playwright test --config tests/electron-e16-playwright.config.ts` — 1 passed; `./node_modules/.bin/playwright test --config tests/electron-e20-playwright.config.ts` — 30 passed. Initial invocation through default config selected no tests; corrected dedicated configs above provide evidence.
- `./node_modules/.bin/playwright test --config tests/issue-1579-playwright.config.ts` — 5 passed.
- Canonical integration sandbox: `RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-open-issue-swarm-fixture RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-open-issue-swarm-fixture/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-open-issue-swarm-fixture/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-codex-integration-sandbox RHYTHM_SANDBOX_API_PORT=6808 RHYTHM_SANDBOX_ENGINE_PORT=6807 RHYTHM_SANDBOX_GATEWAY_PORT=6809 RHYTHM_OPTIMIZER_MODE=shadow tools/dev/sandbox.sh up` built and started successfully. `curl -fsS http://127.0.0.1:6808/health` returned status ok; `/opencode/health` returned ready, bridgeLive true. Same sandbox/ports `tools/dev/sandbox.sh down` removed runtime and preserved sanitized diagnostics. No live 4001/4096 processes were managed.
- #1574 candidate only: same canonical fixture workflow with sandbox `/private/tmp/rhythm-codex-review-sandbox`, ports 6798/6797/6799; `RHYTHM_LIVE_E2E=1 RHYTHM_1574_FIXTURE_ROOT=/private/tmp/rhythm-codex-review-sandbox ./node_modules/.bin/vitest run src/__tests__/live_e2e_issue_1574_engraph_process.test.ts` — 1 passed, 12.75s. Sandbox shut down. This does not qualify missing index-parent-death or old-port inventory cases.
- #1491 candidate: 16 API tests passed, 9 Postgres-live skipped; Flutter 18 passed, analyze exit 0 (319 infos), nonwriting format check exit 1. #1565 browser: 1 passed, 1 failed. #1582 fixture sessions: 3 passed, not live-delta evidence.
- GitNexus impact before accepted edits: LOW; staged detect_changes: #1558 8 files/3 symbols/0 processes LOW; #1579 20 files/58 symbols/0 processes LOW. Snapshot #1491 CRITICAL warning reported before preservation; no edits or commit followed. Index predates candidates; direct diff review is the primary evidence. Detect was run from each candidate cwd using registered Rhythm index.

## Publication

Accepted source is through `76cb29a6`; `c6cee9e4` adds the test-only IPC mock correction. Repository gate and all relevant focused checks passed before push. Draft PR remains draft; pushed-head CI is tracked in the PR.

## Notes and evidence boundaries

Full review receipts, pre/post SHA256 manifests, logs, and patch snapshots are retained locally at `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-takeover/`. Source review did not change candidates: web manifests covered all non-generated tracked/untracked files; backend manifests covered changed/untracked files only. Credential docs hashes also matched. Three #1558 screenshots show fresh/collapsed/remounted fixture rail; parent inspected remount image. The #1565 failure screenshot visibly contains “Time unavailable.” These are browser fixtures, not packaged runtime screenshots.

No global PASS or release-readiness claim. #1579 c9-c12 native macOS banner/sound/click/OS settings and packaged U3 remain not tested. #1558 packaged runtime and previous mega native/hosted/device release gaps remain open. No new closing keywords are added. Prior accepted slices and their manual gaps remain as recorded in `2026-09-24-open-issue-swarm-resume.md`. The #1569 moved integration plan remains untracked and unfrozen, per the user's conditional S0-freeze instruction.
