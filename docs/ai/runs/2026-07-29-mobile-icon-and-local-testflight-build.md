---
date: 2026-07-29
repo: Rhythm
branch: mega/run-2026-07-28
pr: 1241
issues: [1198, 1199]
status: partial
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Goal

Ship a TestFlight build of the Rhythm Agents iOS app from local Xcode
(bypassing EAS), and replace the inherited OpenCode app icon with the Rhythm
mark.

## Files changed

- `apps/mobile/assets/images/{icon,adaptive-icon,splash-icon,favicon}.png` —
  replaced the inherited OpenCode mark (white pixel glyph on `#202020`, a
  leftover from the `app.getopencode` scaffold) with the Rhythm mark sourced
  from `apps/desktop_flutter/macos/.../app_icon_1024.png`. `icon.png` is
  flattened onto white (PNG colortype 2, **no alpha**) because App Store
  Connect rejects a marketing icon carrying an alpha channel; all three
  in-repo source candidates had one. `adaptive-icon.png` and
  `splash-icon.png` keep transparency, which their Android/splash pipelines
  require.
- `apps/mobile/app.config.ts` — Android `adaptiveIcon.backgroundColor`
  `#202020` → `#FFFFFF` (the old near-black was sized for the OpenCode
  glyph); added `ios.appleTeamId` so local archives are repeatable.

Commits: `bd18fa5ec` (icon), `3acd057eb` (appleTeamId).

## Checks run

- `npm run test:app-config` — PASS (both commits).
- `npm run verify:production-bundle` — PASS. This is the gate that had been
  blocking; it passes once the production Google OAuth client is supplied.
- `expo prebuild --platform ios` — generated
  `App-Icon-1024x1024@1x.png` as the Rhythm mark, 1024×1024, colortype 2
  (opaque) in both dev and production variants.
- CI on `3acd057eb`: Desktop ✓ MCP Server ✓ Mobile ✓ Server ✓ (4/4 green).
- Archive + export: `** ARCHIVE SUCCEEDED **`, `** EXPORT SUCCEEDED **`.

## Artifacts

- IPA: `/tmp/RhythmExport/RhythmAgents.ipa` — 14.75 MB,
  sha256 `f6a4c3be88945aba…`, built from `bd18fa5ec`.
- Archive: `~/Library/Developer/Xcode/Archives/2026-07-29/RhythmAgents-Production-2026-07-29.xcarchive`.

Verified on the exported IPA (not inferred from config):

- Signed `Apple Distribution: Aaron Hochhalter (56Q69NYP9H)`;
  `get-task-allow=false`, `aps-environment=production`,
  **`beta-reports-active=true`** (the TestFlight entitlement).
- Profile `iOS Team Store Provisioning Profile: org.visaliacrc.rhythm.agents`,
  zero provisioned devices (a real App Store profile), expires 2027-04-05.
- `org.visaliacrc.rhythm.agents`, "Rhythm Agents", 1.0.8 build 1.
- `NSAppTransportSecurity` **absent** from the built `Info.plist` —
  production transport hardening confirmed in the binary.
- The **production** Google client ID is inlined in the 9.8 MB JS bundle and
  the **dev** client is absent; no `127.0.0.1:4096` / E2E leakage.
- App icon extracted from the shipped `.app` and visually confirmed as the
  Rhythm mark; also confirmed on the simulator home screen.

## Blockers (not code defects)

1. **No App Store Connect app record.** The account has only
   `NurseryNotification`, `Statement Camera`, `drumrot`. Creating it via API
   is impossible: `POST /v1/apps` → `403 FORBIDDEN_ERROR — The resource
   'apps' does not allow 'CREATE'. Allowed operations are: GET_COLLECTION,
   GET_INSTANCE, UPDATE`. Web UI only. Both App IDs are already registered
   (`FQ2JM72XM7` production, `K98TW5Y7JG` dev), and the production App ID has
   Push Notifications enabled — proven by `aps-environment: production` in the
   generated profile.
2. **Mobile OAuth server code is unmerged.** `git grep` per ref:
   `GOOGLE_MOBILE_CLIENT_ID` / `googleMobileClientId` appear in 3/4 files on
   `mega/run-2026-07-28` but **0 files** on `main` and **0 files** on the
   deployed commit `80d1552` (built 2026-07-27). `main` and production carry a
   `mobile-exchange` route registration with none of the env-backed exchange
   behind it. Mobile sign-in cannot work in production until #1241 merges and
   a new `:main` image deploys — setting env alone is insufficient.
3. **`buildNumber` is hardcoded `1`.** EAS increments remotely
   (`appVersionSource: remote`, `autoIncrement: true`); a local archive does
   not. The second upload of 1.0.8 will be rejected as a duplicate.

## Production server change (staged, NOT live)

`/Volumes/docker/Rhythm/api_server/.env.production` — appended
`GOOGLE_MOBILE_CLIENT_ID` and `GOOGLE_MOBILE_REDIRECT_URI` (production
client). Both were absent. Backup:
`.env.production.bak.premobileoauth.1785341726` (content-level copy — plain
`cp` fails on that SMB volume trying to copy extended attributes).

Verified: `docker-compose.synology.yml` uses `env_file: - .env.production`;
written unquoted to match all 25 existing vars (quotes are literal in docker
`env_file`); replayed `google_oauth_service.ts`'s own validation — regex PASS,
redirect-derivation PASS; server client ID matches the one the app embeds.

The container was **not** restarted — and per blocker 2 a restart would not
help yet. Watchtower is label-enabled with a 30-min poll but only recreates on
a **new image**, not an env change.

## Notes / gotchas

- **`expo prebuild` does not run if `ios/` exists.** `expo run:ios` reused a
  production-variant `ios/` and silently built the wrong variant (production
  bundle, ATS stripped). Always re-run `prebuild --clean` for the intended
  variant before `run:ios`.
- **CocoaPods needs a UTF-8 locale.** `pod install` dies with
  `Unicode Normalization not appropriate for ASCII-8BIT
  (Encoding::CompatibilityError)` unless `LANG`/`LC_ALL` are
  `en_US.UTF-8`.
- **Expo's generated project has no signing team.** A local
  `xcodebuild archive` fails with "Signing for RhythmAgents requires a
  development team" — EAS injects credentials remotely so only local builds
  notice. Fixed durably via `ios.appleTeamId` (see decision doc).
- **The archive signs `Apple Development`; `-exportArchive` re-signs to
  `Apple Distribution`.** Same thing Organizer's Distribute does — a
  development-signed archive still exports a valid App Store IPA.
- **The `eas` CLI is not installed locally** (`npx eas` cannot resolve it), so
  `eas env:list` is not available for pulling config.
- **`/Volumes/docker/Rhythm/api_server/rhythm.db` is not production data.**
  Production is `DB_CLIENT=postgres` (`DB_HOST=rhythm-postgres`); that SQLite
  file is dated 2026-04-13, pre-migration, and `DB_PATH=/data/rhythm.db` in
  the env is vestigial. It also contained **live credentials** — 6 non-null
  Google `access_token`/`refresh_token` pairs, 3 `password_hash` values, 4
  session tokens. Stripped before any dev use.
- **Simulator cannot smoke Google OAuth.** See decision doc; abandoned
  deliberately, not a defect.

## Next step

Human: create the App Store Connect app record (iOS, bundle
`org.visaliacrc.rhythm.agents`, SKU `org.visaliacrc.rhythm.agents`, name must
be globally unique). Then the existing IPA can upload to TestFlight as-is.
Sign-in inside that build additionally requires #1241 merged and a new
`:main` image deployed to the NAS.
