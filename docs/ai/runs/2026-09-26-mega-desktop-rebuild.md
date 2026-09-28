---
date: 2026-09-26
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: staged-candidate-awaiting-swap
tags: [run, rhythm]
---

# Mega desktop candidate rebuilt at a27c0544

Packaging/build only. No product source changed. The signed bundle is staged at
`apps/electron/dist/Rhythm.app` and has not been swapped into `~/Applications`. The running
candidate (API 4001 / engine 4096) was not touched.

## Files
- Source: local HEAD `a27c0544`, which is PR head `7c8115a7` plus one unpushed commit (#1576 S2/S4 provenance)
- Package log: `/tmp/rhythm-20260926-package.log`
- Sign log: `/tmp/rhythm-20260926-sign.log`
- Hermes artifact: `/private/tmp/hermes-s8-build/apps/desktop/build/rhythm-embedded` (pin `31b8917a6d`, clean)
- Colony artifact: `/private/tmp/bc-pin-qual-c5163e4/build/rhythm-embedded` (pin `c5163e4d`, dirty=false)

## Checks
- `npm ci` at the worktree root: root `node_modules` had better-sqlite3 12.8.0, but the lockfile now requires ^13.0.3. It resolves to 13.0.3 after the install.
- `npm run package:mac`, run with both artifact dirs and the public `GOOGLE_DESKTOP_CLIENT_ID`: exit 0.
- Developer ID signing used a sign-only replay of `sign-and-notarize-mac.mjs`, deleted after use. It kept identity hash `CF6C1EF1…9DB7` and skipped three things:
  - Apple ID notarization.
  - The zip.
  - The Hermes `manifest.sig`. The factory source ignores that file (#1570-d), and `HERMES_DESKTOP_MANIFEST_SIGNING_KEY` is a CI-only secret.
- Signing covered 47 nested targets. `codesign --verify --deep --strict` reports "satisfies its Designated Requirement".
- `spctl`: `Unnotarized Developer ID`. This is expected.

## Evidence
- All 37 packaged `app/src` files byte-match the worktree `src/`. The generated `build-config.mjs` is excluded from the comparison.
- The packaged api_server has better-sqlite3 13.0.3 and `dist/services/model_provenance_service.js` from a27c0544. The renderer `index-DArvnFD4.js` contains "Served by".
- The packaged Node version is v22.23.0, which matches the Colony manifest.

## Notes
- `npm run test:package` was not run. Its smokes launch the packaged app, which could collide with the live 4001/4096. CI desktop-checks passed on 7c8115a7.
- An orphaned 23h-old test shim (PID 97117, from rhythm-1186-unit) references this worktree's api_server dist. It has no listeners and was left alone.
- No push, tag, or workflow dispatch was done. This log is untracked.

## Rebuild 2 (same day) at ad869014
- Adds f1e5734c (#1580 Models layout), aef9e159 (tool header/badge case), ad869014 (original Bot Crossing UI, Colony pin 52893a5 from BC e056027+52893a5).
- Colony artifact: `/private/tmp/bot-crossing-colony-artifact/build/rhythm-embedded` (sourceCommit 52893a5, validated at the new pin).
- Package exit 0; sign-only replay exit 0; "satisfies its Designated Requirement"; `Unnotarized Developer ID`. Logs `/tmp/rhythm-20260926b-{package,sign}.log`.
- Bundle carries `app/src/colony-skin.css` (byte-match), the switch-track selector fix, and the scene-only Colony layout.
- Mobile "incompatible agent protocols": the Mac reports fingerprint 7e730bf5 (mega since 70bcf2c9, Sep 19); the installed phone app is built from main (f960fbd0). This mismatch predates today's rebuild. Sep 19 worked only because the phone loaded mega JS from Metro.

## Phone build (mega source, local)
- `xcodebuild -workspace RhythmAgentsDev.xcworkspace -scheme RhythmAgentsDev -configuration Release -destination generic/platform=iOS` with `EXPO_APP_VARIANT=development NODE_ENV=production EXPO_PUBLIC_RHYTHM_CLOUD_URL=https://api.vcrcapps.com`: **BUILD SUCCEEDED**. The Sep 19 clang-probe stall did not recur. Log `/tmp/rhythm-mobile-release-build.log`.
- Artifact `/private/tmp/rhythm-mobile-dd/Build/Products/Release-iphoneos/RhythmAgentsDev.app`: `org.visaliacrc.rhythm.agents.dev` 1.0.8, signed Apple Development / 56Q69NYP9H, embedded `main.jsbundle` contains fingerprint `7e730bf5`.
- Install: `xcrun devicectl device install app` on the iPhone 13 mini (wired, iOS 26.6) over the existing Rhythm Agents Dev: exit 0. Relaunched, running after 12s (bundleVersion 2026091601). The watcher script never ran an install because macOS has no `timeout(1)`; it was killed. The TestFlight app is untouched. On-device pairing/compat is not yet observed.

## Rebuild 3 at 327f7c11 (Hermes Rhythm skin)
- Hermes pinned to d747cbd9 (codex/hermes-theme: b26d647a #1543/#1570-b + teal palette correction). Artifact `/private/tmp/hermes-theme/apps/desktop/build/rhythm-embedded`, dirty=false, ships `themes/rhythm-theme.json`. Rhythm passes `defaultSkin: 'rhythm'`; the dead indigo `hermes-theme.{css,mjs}` was removed.
- Electron suite 428 pass / 3 skip with the inherited `RHYTHM_RELAY_URLS` etc. unset. In this session's env, `agent-server-ownership` relay restoration fails because the test reads the live app's relay env (test isolation gap, not a regression).
- Package exit 0; sign-only replay exit 0; "satisfies its Designated Requirement"; `Unnotarized Developer ID`. Logs `/tmp/rhythm-20260926c-{package,sign}.log`.
- Visual evidence covers only Hermes's startup card (teal/neutral in dark and light). The main UI is unverified until the installed app is opened. Hermes doesn't follow Rhythm light/dark; it keeps its own per-profile or system mode.
