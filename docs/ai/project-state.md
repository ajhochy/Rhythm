# Rhythm — Project State

## Current focus

React/Electron parity program: bringing `apps/web` + `apps/electron` up to the shipping Flutter
desktop app's real, live capabilities (not just a fixture-mode prototype). Milestone 1 (9/9 slices)
shipped earlier. This is the post-M1, 11-phase capability build.

## Active branch / PR

- Branch: `codex/react-electron-live-suite`, pushed to origin at `9eda840f`.
- PR #1399 open (draft) — not merged. Awaiting AJ's manual smoke test.
- PR #1400 (`codex/post-m1-phase-11-signing` → `codex/react-electron-live-suite`) open — signed,
  notarized `dist/Rhythm.app`. Not merged.

## In progress

- Phases 1, 3, 4, 5, 6, 7 (13/13), 8, 9, 10 are durably green and pushed — zero known gaps left in
  the fixture/live suites.
- Phase 11 (signing/notarization): real Developer ID signing + Apple notarization done locally
  (Accepted, stapled). CI dispatch of `.github/workflows/electron_release.yml` not yet run.

## Risks / known issues

- Two data-loss incidents overnight (2026-08-16/17): a concurrent, unrelated Claude Code session ran
  `git checkout main` in a shared working directory twice, discarding uncommitted work both times.
  Recovered both times; all further phase work moved to dedicated git worktrees, one per agent, each
  committing its own work immediately on green rather than batching. No further incidents since.
- `gateway/sessions.ts`'s `dispatchMcp()` is an honest, real-but-rejecting method: the opencode
  engine has no primitive to execute one MCP tool for a session outside a model-originated MCP App
  interactive binding. Documented in code; not fabricated.
- `security/humanApprovalSigner.ts` (post-m1-p7-c4d) self-generates its P-256 keypair and capability
  in the renderer (IndexedDB/localStorage) rather than being issued by a server. Nothing yet
  synchronizes this with a real server's `HUMAN_APPROVAL_PUBLIC_KEY`/`HUMAN_APPROVAL_CAPABILITY_SHA256`
  env vars — Flutter's bootstrap for that is "the desktop app spawns api_server itself and injects
  both values at launch" (`apps/desktop_flutter/lib/app/core/server/api_server_service.dart`);
  `apps/electron` doesn't own that process lifecycle the same way yet. The redspec's structural
  assertions (real computed signature, correct owned-session focus) pass; a live round-trip against
  a real server's stored public key has not been exercised.
- Playwright test configs across `apps/web/tests/` (including `tests/gateway/`) share a fixed set of
  hardcoded webServer ports (4173/4175/4176/4178/4179/4180/4181/4185). Running more than one
  worktree's suite concurrently WILL silently cross-contaminate results via `reuseExistingServer:
  true` unless ports are temporarily offset per worktree. Watch for this again if dispatching parallel
  agents in fresh worktrees.

## Test status

Full regression as of `9eda840f` (single worktree, canonical ports):
- Fixture suites: phase-3 129/129, phase-4 2/2, phase-5 17/17, phase-6 14/14, phase-7 13/13, phase-8
  10/10, phase-9 4/4, phase-10 12/12, auth 9/9 — **210/210**.
- Live suites: phase-3 13/13, phase-4 9/9, phase-9 mobile-access 1/1, phase-9 session-continuity 1/1,
  phase-10 2/2 — **26/26**.
- `apps/api_server` `post_m1_phase_8_live_artifacts.test.ts`: 4/4.
- `apps/electron` `post-m1-phase-8-artifact-policy.test.mjs`: 2/2; `slice-7-c2` through `c6` (packaged
  live smoke, renderer isolation, deterministic packaging) 5/5 against the SIGNED+notarized bundle.
- `npm run typecheck` clean in `apps/web`.
- Full M1 `verify-all.mjs` gate and provenance/SHA256SUMS reconciliation have NOT been re-run since
  tonight's phase work landed — do that before claiming the whole gate green.

## Next step

1. Re-run `node tools/validation/verify-all.mjs` and reconcile `apps/web/SHA256SUMS`/`PROVENANCE.md`.
2. Regenerate the parity matrix against current `origin/main` Flutter and diff.
3. AJ: manual smoke test of PR #1399 in a real browser/packaged build, focused on Phase 5-10 UI
   (permission/question cards, MCP/skill/command catalogs, live files/diffs/worktrees, live artifacts
   sharing + HTML import, mobile pairing, research/cookbook/playbooks/gallery/report-card, approval
   decision cards).
4. AJ: confirm the Developer ID signing identity PR #1400 chose (`CF6C1EF1...`, expires 2031) is the
   intended one — the keychain has two other "Developer ID Application" certs with shorter validity.
5. Dispatch `.github/workflows/electron_release.yml` once ready to prove the CI signing path.
