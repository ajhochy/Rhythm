# macOS Distribution And Test Releases

This document covers the remaining Phase 5 distribution work for Rhythm desktop:
- building downloadable tester artifacts from GitHub
- wiring Apple signing and notarization
- enabling in-app update checks against GitHub releases

## What The Repo Now Supports

- `Desktop Release` GitHub Actions workflow for building macOS releases
- zipped `.app` and `.dmg` artifacts uploaded to the workflow run
- optional GitHub Release publishing for tester downloads
- optional Apple codesign + notarization if the required secrets are configured
- in-app update checks that look for the latest published GitHub release

## Required Apple Setup

Before notarized tester builds will work, configure a real bundle identity and Apple credentials.

### 1. Set a real bundle identifier

Update [AppInfo.xcconfig](/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/macos/Runner/Configs/AppInfo.xcconfig):

- `PRODUCT_BUNDLE_IDENTIFIER`
- optionally `PRODUCT_COPYRIGHT`

This should match the app identifier you register in Apple Developer.

### 2. Create the Developer ID certificate

In Apple Developer:
- create or confirm a `Developer ID Application` certificate
- install it into Keychain Access on your Mac
- export it from Keychain Access as a `.p12`
- choose a password when exporting

### 3. Create an app-specific password

In Apple ID account settings:
- create an app-specific password for notarization

### 4. Add GitHub repository secrets

Add these repository secrets:

- `APPLE_CERTIFICATE_BASE64`
  - base64-encoded contents of the exported `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
  - password used when exporting the `.p12`
- `APPLE_SIGNING_IDENTITY`
  - example: `Developer ID Application: Your Name (TEAMID)`
- `APPLE_ID`
  - Apple ID email used for notarization
- `APPLE_APP_SPECIFIC_PASSWORD`
  - app-specific password from Apple ID settings
- `APPLE_TEAM_ID`
  - Apple Developer team ID

To create the base64 value:

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
```

## Running A Tester Release

1. Open GitHub Actions.
2. Run `Desktop Release`.
3. Enter a version like `0.2.0-beta.1` or `0.2.0`.
4. Set `prerelease=true` for beta builds.
5. Wait for the workflow to:
   - run analyze and tests
   - build the macOS app
   - package `.zip` and `.dmg`
   - sign/notarize if Apple secrets are configured
   - publish a GitHub release

## Tester Download Flow

The release workflow publishes downloadable artifacts to GitHub Releases.
That gives you a stable URL for:
- direct tester downloads
- in-app update checks

## In-App Updates

Rhythm desktop now checks the GitHub Releases feed and surfaces:
- current installed version
- available update version
- download button
- release notes link

This is intentionally simple for the first beta cycle:
- no silent install
- no Sparkle integration yet
- no background auto-apply

It is enough for beta testers to update from inside the app without manually browsing the repo.
