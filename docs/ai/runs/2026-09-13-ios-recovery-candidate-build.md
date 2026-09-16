---
date: 2026-09-13
repo: Rhythm
branch: feature/ios-end-to-end
pr: null
issues: [ios-recovery-candidate-build]
status: pass
tags: [run, Rhythm]
---

# iOS recovery candidate build and duplicate-warning repair

## Files

- Behavior repair: `apps/mobile/components/chat/chat-list.tsx` and `apps/mobile/tests/chat/chat-list.test.tsx`.
- Focused contract: `docs/ai/contracts/task-ios-duplicate-pair-warning.json`.
- Build output: `apps/mobile/ios/build/` and this run note.
- Existing recovery, Node 24 workflow pin, contracts, and evidence changes were preserved. No commit, install, launch, Simulator state/keychain operation, desktop restart, server, production, credential, or database operation occurred.

## Checks

- Worktree: `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-ios-integration`
- Branch: `feature/ios-end-to-end`; base/HEAD: `9c027b527ba18c147e2f9f875b0f593b70cd95f5`.
- Acceptance red run: `cd apps/mobile && npm test -- --runInBand tests/chat/chat-list.test.tsx` — expected FAIL, 17 passed / 1 failed. The rendered stale offline-cache banner still contained `Pair this iPhone` while the service-unavailable recovery card was present.
- Root cause: `ChatList` rendered its offline-cache banner independently from the normalized `bootstrapState === 'unsupported'` recovery state. The repair uses one shared `connectionServiceUnavailable` predicate to suppress only that stale banner and select the existing recovery card; pairing/auth state and unrelated chat errors are unchanged.
- GitNexus pre-edit impact: `ChatList` LOW, one direct caller (`AgentsScreen`), zero affected processes, one affected module.
- Acceptance green run: same command — PASS, 18/18. The tree contains `Connection service unavailable`, its detail, and `Retry connection`; it contains neither `Pair this iPhone` nor `No chats yet`, and retry fires only on press.
- Account connection contract: `node --test tests/contract/ios-account-connect.test.mjs` — PASS, 8/8.
- Full mobile Jest: `npm test -- --runInBand` — PASS, 30 suites / 113 tests.
- `npm run test:ci:static` — PASS; `npm run typecheck` — PASS; `npm run lint` — PASS with the same 3 warnings and 0 errors.
- `git diff --check` — PASS.
- GitNexus `detect_changes(scope=all)`: LOW, 10 indexed changed symbols across the preserved worktree, 0 affected symbols, and 0 affected processes.
- Xcode prerequisite: Xcode 26.5 (`17F42`), iOS 26.5 SDK/device `280561D9-A545-4801-BD7D-94A1D1EDC62D`. The device was already booted; only read-only device listing was used, with no install/launch/quit/state/keychain command.
- Dependency prerequisite: `apps/mobile/node_modules` is a real directory resolving inside this worktree, not a symlink; `npm ls --depth=0` passed. Existing workspace and Pod lock were used without prebuild or dependency installation.
- Build command (from `apps/mobile`):

  ```bash
  env -u EXPO_PUBLIC_E2E_MODE -u EXPO_PUBLIC_E2E_SERVER_URL \
    -u EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID \
    -u EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI \
    -u GOOGLE_IOS_CLIENT_ID -u GOOGLE_IOS_REDIRECT_URI \
    LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
    EXPO_APP_VARIANT=production NODE_ENV=production \
    EXPO_PUBLIC_RHYTHM_CLOUD_URL=https://api.vcrcapps.com \
    xcodebuild -workspace ios/RhythmAgents.xcworkspace \
      -scheme RhythmAgents -configuration Release -sdk iphonesimulator \
      -destination 'platform=iOS Simulator,id=280561D9-A545-4801-BD7D-94A1D1EDC62D' \
      -derivedDataPath ios/build clean build
  ```

  Result: PASS, `** BUILD SUCCEEDED **`. Signing remained enabled; Xcode used ad-hoc `Sign to Run Locally`. Only existing script/deployment-target warnings were emitted.
- Artifact: `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-ios-integration/apps/mobile/ios/build/Build/Products/Release-iphonesimulator/RhythmAgents.app` (58,488 KiB).
- `codesign --verify --deep --strict --verbose=2 <artifact>`: PASS. Identifier `org.visaliacrc.rhythm.agents`; universal `x86_64 arm64`; full SHA-256 CDHash `001a192b1724b92e387a0f57b04b54f30dafe05ac3d7e3cf151d99e81073bbcf`.
- Hermes `main.jsbundle` SHA-256: `8ba5de77816121ee668d325a780888541d4bdcb9ac720b0a395997ff4a52867d`.
- Executable `RhythmAgents` SHA-256: `baaf79ccf656e1975af86d7637741e0e80cdfb8228ed0a1e251eb11673339e9f`.
- Built `Info.plist` registers fixed `rhythmagents` and no `com.googleusercontent.apps.*` scheme.
- Production scan command: same six variables unset with `EXPO_PUBLIC_RHYTHM_CLOUD_URL=https://api.vcrcapps.com npm run verify:production-bundle` — PASS: `Production bundle and generated iOS/Android transport configuration verified.` The built Hermes bundle contains the hosted origin and no native Google client, E2E credential/user/device-token marker.
- Source snapshot SHA-256 before and after build/scan (identical):
  - `apps/mobile/components/chat/chat-list.tsx`: `d24f7a18885625f28a8ac6eeb115b092f49941a86b44dd0a2268591eb2f45e04`
  - `apps/mobile/lib/pairing/paired-host-store.ts`: `dbbacc3c428c7bc6d2577257078ce8c148cfd136cc6d0c68f2a01a42ba4c16ad`
  - `apps/mobile/providers/opencode-provider.tsx`: `8f6ac90970464a9bd1e3a35edffa5c80d916a8b502459608facb2fbcfa3f28cd`
  - `apps/mobile/tests/chat/chat-list.test.tsx`: `662e8e20f9d6a46aaf004a66e11757c79c0b77210ab3eeb5a574f80faf0a8920`
  - `apps/mobile/tests/contract/ios-account-connect.test.mjs`: `28834c029e997eab84ba8440cec35315c13fe18a497b0ba5ff10ef92069422df`
  - Preserved `.github/workflows/desktop_release.yml`: `f62ead6ee0a53e46f2622a8b43804e3ab192cd032a64532563da2531108a645b`
- The source hashes were identical before and after build/scan. Generated `apps/mobile/ios/build/` remains ignored.

## Notes

- No commit, delegation, server/sandbox, production, credential/live-DB read, `/Applications` change, desktop restart, or Simulator lifecycle/application command occurred.
- Dev Dashboard run publication passed: revision `3578 -> 3579`.
- Manager installed this exact repaired artifact over the existing iOS 26.5 app. Installed `main.jsbundle` parity passed for SHA-256 `8ba5de77816121ee668d325a780888541d4bdcb9ac720b0a395997ff4a52867d`; the candidate executable SHA-256 is `baaf79ccf656e1975af86d7637741e0e80cdfb8228ed0a1e251eb11673339e9f`.
- The Simulator data-container path changed on install, but the app opened authenticated to Chats without another login, demonstrating that the Google session persisted in SecureStore. Existing chats were untouched.
- Hosted API candidate `9c027b52` is deployed. Manager-observed real hosted Google OAuth completed and returned the app to Chats.
- Manager screenshot `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/attachments/rhythm-recovery-no-pair-banner.png` shows `Connection service unavailable`, its explanatory detail, and `Retry connection`, with zero `Pair this iPhone` and zero `No chats yet`. Only this recovery criterion is accepted.
- The old relay is healthy and untouched. Matching desktop installation, relay candidate/reconnect, environment discovery, chat read, designated send, accessibility, and performance remain `not_tested`; no desktop lifecycle operation is authorized here.
- Desktop release workflow `vbeta18.44` failed because Node 24.20.0 aborts NAN-style native addons through the affected cleanup-hook backport (`nodejs/node#65446`). The current Node 24.18.1 pin is verified but awaits commit and a newly authorized beta release; no release occurred.

## Handoff

- `PASS`: manager evidence accepts only the exact-artifact service-unavailable recovery criterion. All separately listed desktop/relay/environment/chat/accessibility/performance gates remain `not_tested`.
