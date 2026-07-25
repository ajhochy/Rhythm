
# Project State

## Current focus

**Creative platform integration — Phase 1 landed, Phase 2 blocked.** Working
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
- **Phase 2 (blocked, not started/incomplete):**
  1. Approval-gated Setup Agent external-runtime installer — real
     install + verify + rollback for Blender, ComfyUI (+ selectable model
     packs), OpenMontage, Obsidian/plugin, document/media toolchains. This
     is the largest remaining piece and is security-sensitive.
  2. Gallery artifact recording / local file rendering.
  3. Self-improvement package audit.
  4. Deep Research direct `AgentRunner` execution with a live report.
- Planning recommended splitting into 5 stacked draft PRs; AJ explicitly
  overrode this — all capabilities must ship together, external-runtime
  install stack cannot be dropped or deferred silently.

## Risks / known issues

- **Implementation blocker:** several coding-agent task sessions returned
  empty (no changes) for Phase 2, including a narrowed registry-only task.
  Root cause not diagnosed — need a working coding-agent session or manual
  implementation.
- The installer must not be improvised with arbitrary shell execution,
  unpinned downloads, or fake/manual-only recipes — needs pinned, verifiable
  install/verify/rollback recipes per external tool.
- Sandbox Phase 1 verification copied an existing user-owned `creative-media`
  row rather than seeding fresh from empty DB — this correctly preserved
  that row, but do **not** claim "live registry == seed defaults" from this;
  that equivalence hasn't actually been verified from a clean DB.

## Test status

Phase 1 only, gate PASS on current branch HEAD:
- api_server: `npm run build` clean; 3 seed tests, 2 packaging tests, 7
  config-seed tests, 41 curated-adapter tests all passed.
- Flutter: Gallery widget tests 7/7; `flutter analyze --no-fatal-infos` exit
  0 (pre-existing infos only, run by orchestrator).
- Sandbox `:4098`: health + creative-media profile endpoint both PASS.
- No personal paths/secrets in diff; `git status` clean.
- Full detail: `docs/ai/runs/2026-07-24-creative-platform-checkpoint.md`.

## Next step

1. Resume Phase 2 with a working coding-agent session, or manually implement
   pinned installer recipes (install + verify + rollback) for Blender,
   ComfyUI + model packs, OpenMontage, Obsidian/plugin, document/media
   toolchains, gated behind Setup Agent approval.
2. Then continue remaining stacks: Gallery artifact recording/local file
   rendering, self-improvement package audit, Deep Research live
   `AgentRunner` execution.
3. Only after all stacks land: push branch, open draft PR, hand off for
   manual smoke per `docs/testing/manual-smoke.md`.
</content>
