# Rhythm — Project State

## Current focus

React/Electron parity program: bringing `apps/web` + `apps/electron` up to the shipping Flutter
desktop app's real, live capabilities (not just a fixture-mode prototype). Milestone 1 (9/9 slices)
shipped earlier. This is the post-M1, 11-phase capability build.

## Active branch / PR

- Branch: `codex/react-electron-live-suite`, pushed to origin at `745909cf`.
- PR #1399 open (draft) — not merged. Awaiting AJ's manual smoke test.
- PR #1400 (`codex/post-m1-phase-11-signing` → `codex/react-electron-live-suite`) open — signed,
  notarized `dist/Rhythm.app`. Not merged.

## In progress

- Phases 1, 3, 4, 5, 6, 7 (13/13), 8, 9, 10 are durably green and pushed — zero known gaps left in
  the fixture/live suites.
- Phase 11 (signing/notarization): real Developer ID signing + Apple notarization done locally
  (Accepted, stapled). CI dispatch not yet run — issue #1403.
- `apps/electron` now spawns and owns its own local `api_server` (mirroring Flutter's
  `ApiServerService`/`AgentServerController` field-for-field), including a real Keychain-backed
  P-256 human-approval signer wired to the same live server it spawns.

## Risks / known issues

- Two data-loss incidents overnight (2026-08-16/17): a concurrent, unrelated Claude Code session ran
  `git checkout main` in a shared working directory twice, discarding uncommitted work both times.
  Recovered both times; all further phase work moved to dedicated git worktrees, one per agent, each
  committing its own work immediately on green rather than batching. No further incidents since.
- `gateway/sessions.ts`'s `dispatchMcp()` is an honest, real-but-rejecting method: the opencode
  engine has no primitive to execute one MCP tool for a session outside a model-originated MCP App
  interactive binding. Documented in code; not fabricated.
- `security/humanApprovalSigner.ts`'s Web Crypto fallback path (used only when no Electron main
  process is attached — plain browser, every Playwright redspec) still self-generates its key and
  capability independently, with no server to synchronize against. This is now structural, not an
  open gap: whenever the app actually runs inside Electron, `agent-server.mjs` and
  `human-approval-main-signer.mjs` are the same process spawning `api_server` AND answering the
  renderer's signing IPC calls, so a real Electron launch's signatures do verify against the server
  it spawned.
- Two pre-existing, unrelated native-notification test gaps in `apps/electron`
  (`post-m1-p7-c4e`/`c4f-policy`) — filed as issue #1401.
- `apps/electron` doesn't yet bundle `api_server` into a packaged `.app`; only the dev-mode spawn
  path (walking up to find `apps/api_server` in a monorepo checkout) is reachable today — filed as
  issue #1402.
- Three distinct "Developer ID Application" certs exist in the signing keychain; PR #1400 picked the
  one with standard 5-year validity over two shorter-lived ones — needs AJ's confirmation, filed as
  issue #1404.
- Playwright test configs across `apps/web/tests/` (including `tests/gateway/`) share a fixed set of
  hardcoded webServer ports (4173/4175/4176/4178/4179/4180/4181/4185). Running more than one
  worktree's suite concurrently WILL silently cross-contaminate results via `reuseExistingServer:
  true` unless ports are temporarily offset per worktree. Watch for this again if dispatching parallel
  agents in fresh worktrees.

## Test status

Full regression as of `745909cf` (single worktree, canonical ports):
- Fixture suites: phase-3 129/129, phase-4 2/2, phase-5 17/17, phase-6 14/14, phase-7 13/13, phase-8
  10/10, phase-9 4/4, phase-10 12/12, auth 9/9 — **210/210**.
- Live suites: phase-3 13/13, phase-4 9/9, phase-9 mobile-access 1/1, phase-9 session-continuity 1/1,
  phase-10 2/2 — **26/26**.
- `apps/api_server` `post_m1_phase_8_live_artifacts.test.ts`: 4/4.
- `apps/electron`: `npm test` 30/32 (2 pre-existing, unrelated native-notification gaps — issue
  #1401); `slice-7-c2`-`c6` (packaged live smoke, renderer isolation, deterministic packaging) 5/5
  against the SIGNED+notarized bundle.
- `npm run typecheck` clean in `apps/web` and `apps/electron`.
- Full M1 `verify-all.mjs` gate and provenance/SHA256SUMS reconciliation have NOT been re-run since
  tonight's phase work landed — issue #1405.

## Next step

1. Re-run `node tools/validation/verify-all.mjs`, reconcile `apps/web/SHA256SUMS`/`PROVENANCE.md`,
   and regenerate the parity matrix against current `origin/main` Flutter (issue #1405).
2. AJ: manual smoke test of PR #1399 in a real browser/packaged build, focused on Phase 5-10 UI
   (permission/question cards, MCP/skill/command catalogs, live files/diffs/worktrees, live artifacts
   sharing + HTML import, mobile pairing, research/cookbook/playbooks/gallery/report-card, approval
   decision cards) and the new Electron-spawned local agent server.
3. AJ: confirm the Developer ID signing identity PR #1400 chose (issue #1404).
4. Dispatch `.github/workflows/electron_release.yml` and verify on a clean machine (issue #1403).
5. Bundle `api_server` into the packaged Electron app for a real standalone spawn path (issue #1402).
6. Build native Electron notification support (issue #1401).
