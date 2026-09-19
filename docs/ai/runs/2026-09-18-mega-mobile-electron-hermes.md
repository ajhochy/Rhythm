---
date: 2026-09-18
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: TBD
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
