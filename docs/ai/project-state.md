# Project State

## Current focus

Repair the creative dependency installers so the desktop app produces verified,
launchable local runtimes without relying on the user's shell environment.

## Active branch / PR

- Branch: `codex/fix-creative-installer`.
- Draft PR: pending.
- Related issue: #1201.

## In progress

- Implementation and automated verification are complete.
- Commit, push, and draft PR creation remain.

## Risks / known issues

- The reviewed Blender 5.2 application pin currently supports Apple silicon
  only.
- Blender, ComfyUI, and OpenMontage still need their documented user/runtime
  startup steps and manual smoke testing before merge.
- Production remains unchanged until a human reviews and merges the draft PR.

## Test status

- API build: PASS.
- API suite: PASS, 3,243 passed and 53 skipped.
- Live isolated sandbox: PASS, FFmpeg install/execution and Obsidian MCP
  initialization (2/2).
- GitNexus branch comparison against `origin/main`: LOW risk, no affected
  indexed execution processes.
- Full evidence:
  `docs/ai/runs/2026-07-26-creative-installer-repair.md`.

## Next step

Open a draft PR, let CI run, then perform manual smoke testing for the heavy GUI
integrations. Do not merge without human review.
