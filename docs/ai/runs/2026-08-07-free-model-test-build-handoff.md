---
date: 2026-08-07
repo: Rhythm
branch: test/free-model-delegation-build
pr: null
issues: []
status: prerelease-published-awaiting-clean-mac-smoke
tags: [run, Rhythm, integration-build, release]
index: "[[Rhythm]]"
---

# Free-model test-build handoff

## Files changed

- Documentation evidence only: this run note and `docs/ai/project-state.md`.
- Integration source: exact draft PR #1333 head `29146db9` and draft PR #1335
  head `c2882c2d`; integration merge `b689c926`, evidence head `d2fc915d`.

## Checks run

- Fresh empty DB and empty HOME, with no `auth.json` or credential providers:
  **PASS**. A real stale-ID-recovered Zen turn returned exact `zen-bootstrap-ok`.
- API: **48 focused tests passed**; TypeScript and build passed. MCP: **2/2
  TypeScript/build checks passed**.
- Combined live async delegation override to
  `opencode/deepseek-v4-flash-free`: **PASS**. Request returned 202, child reached
  idle, output was exact `ZEN_DELEGATION_OVERRIDE_OK`, and the selected model was
  persisted. Unknown model returned 400 and created no child.
- GitNexus: **LOW**, no affected processes. Sandbox stopped and ports clear.
- Desktop Release [run 31233721224](https://github.com/ajhochy/Rhythm/actions/runs/31233721224):
  **PASS** in 16m9s from `d2fc915d4449374bdd6de4a83e70798fdb1b879b`,
  including desktop verification, API/MCP/fork payload smoke, universal arm64+x64
  build, signing, notarization, artifact upload, and prerelease publication.

## Notes

- Resolution of the earlier contaminated-harness block: verification was rerun
  with genuinely empty DB/HOME preconditions and passed. The retrospective note
  remains the historical record of the initial blocked attempt.
- Published prerelease: [`v0.18.56`](https://github.com/ajhochy/Rhythm/releases/tag/v0.18.56).
  The [DMG](https://github.com/ajhochy/Rhythm/releases/download/v0.18.56/Rhythm-macOS.dmg)
  is 241,943,378 bytes with SHA-256
  `0223e1983bdd48ecccdcfd5ff48e289ccc747e112d2d5578b01fd85570d5da38`;
  a ZIP is also available.
- Source PRs #1333 and #1335 remain draft and unmerged. No manual clean-computer
  install smoke has run.
- Next: AJ installs the DMG on a clean Apple Silicon Mac and tests setup/free-model
  behavior plus delegated override.
