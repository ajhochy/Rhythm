
# Project State

## Current focus

**Creative platform integration — Phases 1–3 complete.** Working
in worktree `~/Documents/rhythm-worktrees/creative-platform`. No PR yet — AJ
requires the full capability set (including real external-runtime
installation) before this goes up for review; do not open a PR from the
current state.

## Active branch / PR

- `feature/creative-platform-integration` off `origin/main` — not pushed, no
  PR opened yet.
- Commits so far: `9b02641da` (Gallery launches `agentId` creative-media),
  `4521219c8` (idempotent creative-media local profile seed with
  generalized prompt/model/image-gen/MCP+skill allowlists), `a7d5cb84d`
  (bundles all 9 creative skills offline + curated adapters for
  Canva/ComfyUI/Blender/OpenMontage/Obsidian).

## In progress

- **Phase 1 (done, verified):** Gallery launcher wiring, creative-media
  local profile seed, and bundled/curated creative skills + adapters.
- **Phase 2 integration (complete):** approval-gated local API + Rhythm MCP
  surfaces, Setup prompt wiring, packaged OpenMontage stdio bridge, and
  sandbox proof are committed on this branch.
- **Remaining epic work:**
  1. Approval-gated Setup Agent external-runtime installer — real
     install + verify + rollback for Blender, ComfyUI (+ selectable model
     packs), OpenMontage, Obsidian/plugin, document/media toolchains. This
     is the largest remaining piece and is security-sensitive.
   2. Self-improvement package audit.
   3. Deep Research direct `AgentRunner` execution with a live report.
- Planning recommended splitting into 5 stacked draft PRs; AJ explicitly
  overrode this — all capabilities must ship together, external-runtime
  install stack cannot be dropped or deferred silently.

## Risks / known issues

- The installer must not be improvised with arbitrary shell execution,
  unpinned downloads, or fake/manual-only recipes — needs pinned, verifiable
  install/verify/rollback recipes per external tool.
- Sandbox Phase 1 verification copied an existing user-owned `creative-media`
  row rather than seeding fresh from empty DB — this correctly preserved
  that row, but do **not** claim "live registry == seed defaults" from this;
  that equivalence hasn't actually been verified from a clean DB.

## Test status

- Phase 3: API artifact tests 9/9, API and MCP builds clean, MCP focused test
  passed, and a sandbox E2E created/listed/served a synthetic local PNG.
- Flutter SDK is unavailable in this environment, so Gallery widget test and
  analyzer are pending a Flutter-equipped machine.
- Full detail: `docs/ai/runs/2026-07-24-creative-platform-phase3-gallery-artifacts.md`.

## Next step

1. Continue self-improvement package audit and Deep Research live execution.
2. Re-run Flutter formatting, widget tests, and analyzer on a Flutter-equipped machine.
3. Only after all stacks land: push branch, open draft PR, hand off for
   manual smoke per `docs/testing/manual-smoke.md`.
</content>
