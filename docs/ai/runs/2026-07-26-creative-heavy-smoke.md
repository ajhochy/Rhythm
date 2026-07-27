---
date: 2026-07-26
repo: Rhythm
branch: codex/fix-creative-installer
pr: 1202
issues: [1201]
status: passed
tags: [run, Rhythm, creative-platform, smoke]
---

# Heavy creative-tool sandbox smoke

## Files

- Replaced Blender's challenged origin URL with the OCF Blender release mirror
  while retaining the reviewed SHA-256 trust boundary.
- Pinned and installed the Blender MCP add-on source at commit
  `494fb5bba603fb650f20c507adce994dffbd6dae`.
- Made OpenMontage's packaged-resource lookup independent of the process working
  directory and launched its bridge through the managed Python environment.
- Propagated the packaged creative-resource directory into the dev sandbox.
- Added a gated heavy live test covering Blender, OpenMontage, and ComfyUI.
- Built the vendored fork and API from draft PR #1202.
- Exercised Blender, OpenMontage, and ComfyUI through the real approval and
  `/creative-platform/:id/request-or-start` API path in the isolated dev
  sandbox.

## Checks

- `tools/dev/sandbox.sh up` — PASS. The sandbox used API `:4098`, engine
  `:4097`, a copied SQLite database, and a temporary HOME.
- Initial discovery run — FAIL as expected: Blender's official origin returned
  a Cloudflare HTTP 403 challenge, and OpenMontage exposed a resource-directory
  fallback error plus direct-script `EACCES`.
- `RHYTHM_LIVE_E2E=1 RHYTHM_CREATIVE_HEAVY_E2E=1 npx vitest run
  src/__tests__/creative_platform_heavy.live.test.ts` — PASS, 3/3 tests in
  331.50 seconds against the isolated sandbox.
- Blender install — PASS. The OCF mirror artifact matched the reviewed checksum,
  the managed app and Python environment installed, and Blender rendered a
  headless PNG.
- Blender MCP runtime — PASS. Blender launched with the pinned add-on, the MCP
  initialized, and a real `get_scene_info` call returned the default Cube.
- Focused Blender bridge rerun — PASS, 1 passed and 2 skipped in 71.74 seconds.
- OpenMontage install — PASS without an ad hoc environment override. The pinned
  source and managed Python environment installed, and status reported
  `installed`.
- OpenMontage curated MCP launch — PASS through the managed Python interpreter;
  MCP initialization, tool listing, and `openmontage_status` all succeeded.
- ComfyUI install — PASS. The API returned `awaiting-user` after producing and
  verifying the managed runtime.
- ComfyUI MCP initialize/list — PASS. Server `comfyui-mcp` version `1.0.0`
  initialized and returned 40 tools.
- ComfyUI runtime — PASS. Managed Python started ComfyUI CPU mode on
  `127.0.0.1:8188`; the Rhythm verify endpoint changed from `unhealthy` to
  `installed`.
- ComfyUI MCP `ping_comfyui` — PASS: `reachable: true`, 18 ms latency.
- Sandbox teardown — PASS. No listeners remained on `:4098`, `:4097`, or
  `:8188`.
- Working-tree cleanup — PASS. Build-generated `apps/opencode_fork/bun.lock`
  drift was restored; the pre-existing `CLAUDE.md` edit remains untouched.
- `npm run build` — PASS.
- `npm test` — PASS with 372 files passed, 33 skipped; 3,245 tests passed and
  56 skipped in 36.43 seconds. The first restricted run was discarded after
  loopback socket tests received sandbox `EPERM`; the identical suite passed
  with localhost binding enabled.
- Draft PR #1202 `server-checks` — PASS in 3 minutes 45 seconds.
- GitNexus staged change detection — LOW risk, zero affected indexed execution
  processes.

## Notes

- This run did not install the optional ComfyUI model pack or perform image
  generation; it verified the requested ComfyUI application and MCP runtime.
- The Blender add-on is supplied as an exact reviewed artifact; the installer
  still leaves persistent enablement to the user rather than modifying Blender
  preferences silently.
- The live installer coverage is Apple Silicon/macOS specific, matching the
  current shipping desktop client.
- Draft PR #1202 remains a draft for human review and manual product smoke; this
  run does not authorize merging.
