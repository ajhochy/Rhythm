# Rhythm — Project State

## Current focus

React/Electron parity program: bringing `apps/web` + `apps/electron` up to the shipping Flutter
desktop app's real, live capabilities (not just a fixture-mode prototype). Milestone 1 (9/9 slices)
shipped earlier. This is the post-M1, 11-phase capability build.

## Active branch / PR

- Branch: `codex/react-electron-live-suite`, pushed to origin at `5cdd8b79`.
- PR #1399 open (draft) — not merged. Awaiting AJ's manual smoke test.

## In progress

- Phases 1, 3, 4, 5, 6, 7 (12/13 criteria), 8, 9, 10 are durably green and pushed.
- Phase 11 (signing/notarization) deliberately not attempted — see
  `docs/ai/plans/2026-08-15-post-m1-parity-phases.md`'s "Decisions taken by the orchestrator" section.
  It needs real Apple Developer ID/notary credentials and an actual CI release dispatch, both gated
  on AJ's explicit per-release approval; nothing here fabricates a fake signature to get past that.

## Risks / known issues

- Two data-loss incidents overnight (2026-08-16/17): a concurrent, unrelated Claude Code session ran
  `git checkout main` in a shared working directory twice, discarding uncommitted work both times.
  Recovered both times; all further phase work moved to dedicated git worktrees, one per agent, each
  committing its own work immediately on green rather than batching. No further incidents since.
- `post-m1-p7-c4d` (approval decision cards) is honestly red: the server verifies a P-256 decision
  signature against a key that only a signed native app's Keychain holds, and no signer exists in this
  Electron/React build yet. The card UI is real and live-wired; `decideApproval()` rejects rather than
  fabricating a signature. Needs a native (Electron main / Keychain) bridge to close.
- `gateway/sessions.ts`'s `dispatchMcp()` is the same kind of honest, real-but-rejecting method:
  the opencode engine has no primitive to execute one MCP tool for a session outside a
  model-originated MCP App interactive binding. Documented in code; not fabricated.
- Playwright test configs across `apps/web/tests/` (including `tests/gateway/`) share a fixed set of
  hardcoded webServer ports (4173/4175/4176/4178/4179/4180/4181/4185). Running more than one
  worktree's suite concurrently WILL silently cross-contaminate results via `reuseExistingServer:
  true` unless ports are temporarily offset per worktree. Watch for this again if dispatching parallel
  agents in fresh worktrees.

## Test status

Full regression as of `5cdd8b79` (single worktree, canonical ports):
- Fixture suites: phase-3 129/129, phase-4 2/2, phase-5 17/17, phase-6 14/14, phase-7 12/13 (c4d
  honestly red, see above), phase-8 10/10, phase-9 4/4, phase-10 12/12, auth 9/9 — **209/210**.
- Live suites: phase-3 13/13, phase-4 9/9, phase-9 mobile-access 1/1, phase-9 session-continuity 1/1,
  phase-10 2/2 — **26/26**.
- `apps/api_server` `post_m1_phase_8_live_artifacts.test.ts`: 4/4.
- `apps/electron` `post-m1-phase-8-artifact-policy.test.mjs`: 2/2.
- `npm run typecheck` clean in `apps/web`.
- Full M1 `verify-all.mjs` gate and provenance/SHA256SUMS reconciliation have NOT been re-run since
  tonight's phase work landed — do that before claiming the whole gate green.

## Next step

1. Re-run `node tools/validation/verify-all.mjs` and reconcile `apps/web/SHA256SUMS`/`PROVENANCE.md`.
2. Regenerate the parity matrix against current `origin/main` Flutter and diff.
3. AJ: manual smoke test of PR #1399 in a real browser/packaged build, focused on Phase 5-10 UI
   (permission/question cards, MCP/skill/command catalogs, live files/diffs/worktrees, live artifacts
   sharing + HTML import, mobile pairing, research/cookbook/playbooks/gallery/report-card).
4. Phase 11 (signing) only on AJ's explicit go-ahead for an actual release.
