---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr:
issues: []
status: staged-candidate-awaiting-swap
tags: [run, rhythm]
---

# Mega desktop candidate rebuilt at 481f5549

Packaging/build only — no product source was modified. The signed candidate is staged
inside the worktree and has **not** been swapped into `~/Applications`; the user's
current app (PID ~95306, API 4001) was left running and untouched throughout.

## Files
- Staged bundle: `apps/electron/dist/Rhythm.app` (641 MB, Developer ID signed, not notarized)
- Package log: `/tmp/rhythm-20260921-package.log`
- Sign log: `/tmp/rhythm-20260921-sign.log`
- Procedure reference: `docs/ai/runs/2026-09-19-hermes-desktop-replacement.md`

## Checks
- Hermes artifact **not rebuilt**. The existing artifact at
  `/Users/ajhochhalter/Documents/hermes-rhythm-plugin/.worktrees/desktop-embedded/apps/desktop/build/rhythm-embedded`
  validated against `resolveHermesDesktopArtifact` at the unchanged pin
  `8ea642dbb6a8b8d65868c3e7a468c471914f037b`: 403 integrity-covered files, clean, Electron major 40.
  Today's five commits are all Rhythm-side, so the pin did not move.
- `GOOGLE_DESKTOP_CLIENT_ID` recovered from the installed bundle's generated
  `build-config.mjs` (public OAuth client; no secret is embedded by design).
- `npm run package:mac` with the artifact dir + client ID: **exit 0**. Output goes to
  `apps/electron/dist/Rhythm.app` only — the script never writes to `~/Applications`,
  and no step in the build chain kills dev ports (grepped for pkill/killall/lsof/fuser).
- Developer ID signing: the repo's `sign:mac` script also notarizes unconditionally and
  requires Apple ID credentials, which are out of scope. Replayed only its signing phase
  (lines 1–137, verbatim logic) from a scratchpad copy: 51 nested Mach-O targets, hardened
  runtime, `--timestamp`, entitlements, Hermes integrity re-seal, outer signature.
- First signing attempt failed: `Developer ID Application: Aaron Hochhalter (56Q69NYP9H)`
  is **ambiguous** — three distinct Developer ID identities share that exact name in the
  login keychain. Resolved by extracting the leaf cert from the currently-working installed
  app and using its SHA-1 `CF6C1EF1525E70E6E3324388A322938977779DB7` (valid to 2031-03-24).
  Future signing runs on this machine must pass the hash, not the name.
- `codesign --verify --deep --strict --verbose=2`: **exit 0**, "satisfies its Designated Requirement".
- `spctl --assess`: rejected, `source=Unnotarized Developer ID` — expected and identical to
  the 2026-09-19 candidate. Not notarized by design.

## Evidence the bundle carries today's code
- All 20 packaged `Contents/Resources/app/src/*.{mjs,cjs}` files byte-match the branch
  working tree (excluding the package-time generated `build-config.mjs`): 0 mismatches.
- Bundled `api_server/dist` — all ten files touched by today's six commits differ from the
  running build: `skill_usage_tracker.js`, `agentSchedulerService.js`, `model_fallback.js`,
  `turn_redispatch.js`, `agent_notifications.js`, `agent_runner.js`,
  `notifications_agent_controller.js`, `migrations.js`, `opencode_skills_routes.js`,
  `harvested_skill_evaluator.js`.
- Idle-scan fix (481f5549) confirmed structurally, not just by diff: the new
  `dist/services/skill_usage_tracker.js` has `async function countSkillToolUses()` with a
  chunked `SCAN_CHUNK_ROWS` scan and `setImmediate` yield; the running build still has the
  blocking synchronous `function countSkillToolUses()`.
- Renderer differs (`index-DhGAT2nX.js` vs running `index-C4CXsh8K.js`). Accounts
  re-authorize strings from 05ca632c ("Provider status could not be read",
  "Provider API key could not be saved", "Paste an OpenCode API key.") are present in the
  new renderer and absent from the running one.

## Notes
- No push, no tag, no workflow dispatch. This run log is left untracked in the worktree.
- Hand-off is manual by design: the user quits the running app, then copies the staged
  bundle over `~/Applications/Rhythm Mega Desktop Candidate.app` and relaunches.
- Not qualified here: notarization, and every runtime/native gate from the 2026-09-19
  qualification. This run establishes build + signature + content provenance only.
