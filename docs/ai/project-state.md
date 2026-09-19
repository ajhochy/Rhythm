# Rhythm — Project State

## Current focus

Draft the 2026-09-18 mega PR covering the mobile relay/audio changes, unified Electron list-and-inspector surfaces, resizable panes, the Hermes sidecar/dashboard tab, and the standalone Rhythm workspace package. The bundled Hermes payload remains NO-GO; this draft ships the installed-runtime sidecar path only.

## Active branch / PR

- Integration branch: `mega/2026-09-18-mobile-electron-hermes`.
- Draft PR: [#1544](https://github.com/ajhochy/Rhythm/pull/1544) (Rhythm) and [hermes-rhythm-plugin #17](https://github.com/ajhochy/hermes-rhythm-plugin/pull/17) (fork). Do not merge before manual smoke.
- Draft body: [mega PR body](runs/mega-2026-09-18/PR-BODY.md); evidence: [run record](runs/2026-09-18-mega-mobile-electron-hermes.md).

## In progress

- AJ's manual smoke across Electron, mobile, and the installed Hermes Rhythm feature pack.
- The orchestrator is filling final gate numbers and the live Playwright command.
- Issue-first adversarial reviews are still running or awaiting reconciliation.

## Risks / known issues

- #1373 still lacks relay PTY, bounded credential-freshness handling, and sanitized operator/session diagnostics.
- The Hermes live gate needs AJ's hosted credential or approved authentication flow plus installed Desktop/browser and ACP checks.
- #1520 still needs installed-app icon inspection in Finder, Dock, Command-Tab, and Get Info.
- #1510 still needs audible attribution and verification on a physical iPhone and the actual Electron candidate.
- Adversarial review findings remain pending and may require repair before handoff.

## Test status

- Fork B1 local install, plugin doctor, enable/list, and `hermes doctor` passed; reload/disable/uninstall and credentialed/rendered gates remain open.
- `rhythm-workspace-ui` typecheck/build/vitest passed with 235 tests; the isolated React 19.2.0 contract suite passed without duplicate React.
- Mobile typecheck, lint, contract check, 32 Jest suites / 132 tests, and 11 focused relay/audio tests passed after a load-related flaky first run.
- Electron typecheck and all 159 tests passed, including Hermes server/view/protocol, icon, security receipt, and repaired E44 coverage.
- Relay-disabled mobile Playwright passed 1/1. The full mobile web E2E run reported 70 passed, 1 skipped, and one #1174 parity failure; its standalone rerun was pending at time of writing.

## Next step

AJ grants Codex Computer Use access to Electron + Finder and runs `docs/ai/runs/mega-2026-09-18/finish-brief.md` (visual smoke, hosted live smoke with a disposable bearer, fork live gate, remaining #1373 work); then manual smoke per PR #1544 and manual merge.
