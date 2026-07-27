# Project State

## Current focus

Creative installer repair is implemented and live-smoked across Blender,
OpenMontage, ComfyUI, FFmpeg, and Obsidian.

## Active branch / PR

- Branch: `codex/fix-creative-installer`.
- Draft PR: [#1202](https://github.com/ajhochy/Rhythm/pull/1202).
- Related issue: #1201.

## In progress

- Draft PR #1202 is open for human review; Server CI passed.
- Blender now uses a checksum-verified OCF mirror and includes the exact pinned
  MCP add-on source.
- OpenMontage resolves packaged resources from the built API layout and launches
  through its managed Python interpreter.
- Gated live coverage now exercises all three heavy integrations through the
  real sandbox API.

## Risks / known issues

- The Blender and ComfyUI live installer coverage is Apple Silicon/macOS
  specific.
- Blender add-on persistence remains an explicit user action; the installer
  does not silently modify Blender preferences.
- The optional ComfyUI model pack and image generation were not part of this
  smoke.
- Production remains unchanged until a human reviews and merges the draft PR.

## Test status

- API build: PASS.
- API suite: PASS, 372 files passed and 33 skipped; 3,245 tests passed and 56
  skipped.
- Live isolated sandbox: PASS, FFmpeg install/execution and Obsidian MCP
  initialization (2/2).
- Heavy isolated smoke: PASS, 3/3. Blender installed, rendered a PNG, and
  answered a real MCP `get_scene_info` call; OpenMontage installed and answered
  `openmontage_status`; ComfyUI installed, started locally, verified healthy,
  and answered `ping_comfyui`.
- Focused Blender MCP bridge rerun: PASS, 1 passed and 2 skipped in 71.74
  seconds.
- GitNexus branch and staged comparisons: LOW risk, zero affected indexed
  execution processes.
- Full evidence:
  `docs/ai/runs/2026-07-26-creative-installer-repair.md` and
  `docs/ai/runs/2026-07-26-creative-heavy-smoke.md`.

## Next step

Human manual review and product smoke of draft PR #1202. Do not merge
automatically.
