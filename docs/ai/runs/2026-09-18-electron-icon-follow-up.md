---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-electron-main-1520-1496
pr: null
issues: [1496, 1520]
status: partial
tags: [run, rhythm]
---

# Electron icon follow-up

## Files

- `apps/electron/scripts/package-mac.mjs` — pass `iconutil` output options before the input iconset.
- `apps/electron/test/electron-icon.test.mjs` — assert the ten standard pixel dimensions and original source-byte hashes; compare extracted artwork through deterministic decoded BMP pixels; skip native cases when an independent known-good `iconutil` probe cannot assemble.
- `REPORT.md` — requested worker handoff.

## Checks

- `cd apps/electron && npm run typecheck` — pass.
- `cd apps/electron && node --experimental-vm-modules --test test/electron-icon.test.mjs` — pass: 9 passed, 0 failed, 2 skipped because the managed sandbox could not assemble Electron's own extracted iconset.
- `cd apps/electron && npm run typecheck && node --experimental-vm-modules --test test/electron-icon.test.mjs test/electron-shell.test.mjs test/security-smoke-receipt.test.mjs` — partial: typecheck passed; 21 tests passed, 2 icon-native tests skipped, 5 existing Electron launch tests failed with `SIGABRT` before app code.
- Crash evidence: latest Electron diagnostic shows `___RegisterApplication_block_invoke` / `_RegisterApplication` / `NSApplication` on the faulting main thread, matching the repo's documented managed-sandbox GUI-launch constraint.
- `git diff --check` — pass.
- Dev Dashboard run publication — attempted with `status=pending`; failed because the managed sandbox could not resolve `api.vcrcapps.com`.
- `package:mac` — not run, per request.

## Notes

- Original `app_icon_1024.png` SHA-256 is `9435659f0406341a537ffdde58165a60137df491c32d4451f013fcce9a34f402`.
- Apple ImageIO re-encoding of those same pixels produces PNG SHA-256 `588f2d5585de20a15662fe04548a1ab836dfa1431768a20a23bab751f318654b`; the prior assertion therefore compared container encodings rather than artwork.
- No commit, push, package build, server launch, or live-service mutation was performed.
