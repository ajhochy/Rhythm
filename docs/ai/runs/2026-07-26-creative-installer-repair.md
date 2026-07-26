---
date: 2026-07-26
repo: Rhythm
branch: codex/fix-creative-installer
pr: pending
issues: [1201]
status: passed
tags: [run, Rhythm]
---

# Creative installer repair

## Files

- Added a shared installed-layout contract for creative capabilities.
- Replaced placeholder installer commands with fixed, reviewed recipes for
  Blender, ComfyUI, the starter model pack, OpenMontage, Obsidian, document
  tools, and FFmpeg.
- Updated curated MCP commands to launch the managed artifacts that the
  installer actually creates.
- Added unit coverage for pins, approvals, checksum failures, stale sentinels,
  atomic promotion, and relocated virtual-environment scripts.
- Extended the live creative-platform test to install and execute FFmpeg and to
  complete an MCP initialize handshake with the installed Obsidian server.

## Checks

- `cd apps/api_server && npm run build` — PASS.
- `cd apps/api_server && npm test` — PASS: 372 files passed, 32 skipped; 3,243
  tests passed, 53 skipped.
- `tools/dev/sandbox.sh up` and `tools/dev/sandbox.sh status` — PASS: isolated
  API on 4098 and engine on 4097.
- `cd apps/api_server && RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/creative_platform.live.test.ts`
  — PASS: 2/2. The API approval/install/verify path produced a working FFmpeg
  executable and an Obsidian MCP server that returned a valid initialize
  response.
- `node .gitnexus/run.cjs detect-changes --scope compare --base-ref origin/main --repo Rhythm --branch codex/fix-creative-installer`
  — LOW risk, 7 tracked files and 54 indexed symbols, no affected indexed
  processes. The first check against local `main` was discarded because that
  ref was stale and included 313 unrelated upstream files.
- `git diff --check` — PASS.

## Notes

- Root cause: the prior implementation passed downloaded artifacts to generic
  placeholder commands and then wrote success sentinels without proving that
  launchable runtimes existed. GUI-launched processes also could not safely
  depend on the user's shell Python, npm, or PATH.
- The repaired recipes download pinned `uv` and npm distributions with verified
  SHA-256 hashes, use fixed destinations, stream downloads to disk, log command
  output, and only promote a staging directory after required paths exist.
- Live testing exposed absolute staging paths embedded in Python console
  scripts. The installer now relocates those launchers before atomic promotion.
- Blender remains Apple-silicon-only for the reviewed 5.2 DMG pin. Blender,
  ComfyUI, and OpenMontage still require their documented user/runtime startup
  steps; the automated live gate covers representative binary and MCP installs.
