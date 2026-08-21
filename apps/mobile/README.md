# OpenCode Mobile

[![Get it on Google Play](https://img.shields.io/badge/Get_it_on-Google_Play-4285F4?style=for-the-badge&logo=googleplay&logoColor=white)](https://play.google.com/apps/testing/app.getopencode)
[![Download APK](https://img.shields.io/badge/Download-APK-18A748?style=for-the-badge&logo=android&logoColor=white)](https://github.com/alvarolorentedev/opencode-mobile/releases/latest/download/opencode-mobile.apk)


**Your OpenCode server, in your pocket.**

OpenCode Mobile brings the full power of your self-hosted OpenCode AI assistant to your Android device. Chat with your models, manage conversations, and stay productive anywhere.

## Why OpenCode Mobile?

- **Stay Connected**: Access your OpenCode server from anywhere on your mobile device
- **Seamless Conversations**: Pick up where you left off with synchronized chat history
- **Full Control**: Connect to your own OpenCode server — your data, your rules
- **Privacy-First**: Keep your conversations private on your self-hosted infrastructure
- **Fast & Native**: Built with React Native for smooth, responsive performance

## Quick Start

### For Users

1. **Download the app**:
   - [Google Play (Beta)](https://play.google.com/apps/testing/app.getopencode)
   - [Direct APK Download](https://github.com/alvarolorentedev/opencode-mobile/releases/latest/download/opencode-mobile.apk)

2. **Connect to your server**: Open the app and enter your OpenCode server URL (default: `http://ip:4096`)

3. **Start chatting**: Begin conversations with your AI models instantly

### For Developers

Want to build from source or contribute? See the [Development](#development) section below.

## Features

- Real-time chat with your OpenCode models
- Conversation history and management
- Multi-model support
- Custom server configuration
- Streamed responses for natural conversations
- Clean, intuitive mobile interface

## Screenshots

Check out screenshots and more details on the [official website](https://getopencode.app/).

---

## Development

OpenCode Mobile is built with Expo and React Native.

### Requirements

- Node.js 20+
- npm
- Android Studio / Xcode for native builds

### Getting Started

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/alvarolorentedev/opencode-mobile.git
   cd opencode-mobile
   npm install
   ```

2. Start the development server:
   ```bash
   EXPO_APP_VARIANT=development npm run start
   ```

3. For a development client build:
   ```bash
   EXPO_APP_VARIANT=development npm run start:dev-client
   ```

### Common Commands

```bash
npm run lint           # Run linter
npm run typecheck      # Type checking
npm run test:e2e:web   # End-to-end tests
npm run android        # Build Android app
npm run ios            # Build iOS app
```

### Android Builds

Build a production Android release:
```bash
npm run build:android
```

Build a development client:
```bash
npm run build:development:android
```

**Release Automation**:
- Push to `main` to trigger Android release build and artifact upload
- Push a version tag (e.g., `v1.2.3`) to trigger production Play Store upload
- Use `workflow_dispatch` for manual internal-track uploads

### Testing

- Flow validation runs against the fake OpenCode server in `tests/fake-opencode/server.mjs`
- End-to-end suite uses Playwright (`tests/e2e/flows.spec.mjs`)
- Full testing strategy documented in `TESTING.md`

### Configuration

Connection settings are configured inside the app. By default, the app expects an OpenCode server at `http://127.0.0.1:4096`.

Local configuration files (`.env`, `config.json`) are gitignored for security.

Production config resolution is fail-closed. Release builds require:

- `EXPO_APP_VARIANT=production`
- the exact `EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID`
- its matching `EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI`
- `EXPO_PUBLIC_RHYTHM_CLOUD_URL=https://api.vcrcapps.com`

E2E mode and local HTTP gateway overrides are accepted only by the explicit
development variant and are excluded from the production Metro bundle.

`npm run eas:production:ios` runs the production preflight, builds with the
pinned EAS CLI in non-interactive/frozen-credential mode, and auto-submits that
exact build through the repository-owned `submit.production` profile.
`npm run eas:submit:ios` is the deterministic recovery command for submitting
the latest completed iOS build after the same preflight.
Export compliance is declared in Expo config, so App Store Connect must not require the retired manual encryption-compliance answer.

### Foundation verification gate

Run the full foundation gate with a single command:

```bash
npm run verify:foundation
```

This runs, in order:

1. `npm run contract:check` — verifies `contracts/rhythm-opencode-contract.json` matches the bundled OpenAPI fingerprint
2. `npm run test:contract` — validates repository-root discovery and the generated SDK contract
3. `npm run test:app-config` — validates Expo/EAS identifiers and this exact foundation gate
4. `npm run lint` — ESLint passes with zero violations
5. `npm run typecheck` — TypeScript `--noEmit` exits 0
6. `npm run test:transport-clients` — transport-client contracts pass
7. `npm run test:rhythm-account` — account lifecycle, rollback, cancellation, and overlap-race contracts pass
8. `npm run test:google-mobile-oauth` — OAuth lifecycle and stale-completion contracts pass
9. `npm run test:connection-persistence` — connection persistence unit tests pass
10. `npm run test:notification-persistence` — notification persistence unit tests pass
11. `npm run test:fake-server:self` — fake OpenCode server self-test passes
12. `npm run test:acceptance:1167` — issue #1167 source and credential-safety acceptance gate passes
13. `npm run test:e2e:web` — all 15 Playwright end-to-end flows pass

#### Verified run — 2026-07-24

```
npm run verify:foundation
```

Result: **all 13 stages passed**, 15/15 Playwright tests green, 22/22 account contracts green, zero lint/typecheck violations, contract fingerprint matched engine `1.14.49` (133 operations), and app-config/OAuth/transport/connection/notification/fake-server/#1167 acceptance checks passed.

---

### Rhythm Agents / EAS

```bash
npm exec --yes --package=eas-cli@21.2.0 -- eas whoami
npm run eas:development:ios
npm run eas:development:ios-simulator
npm run eas:production:ios
```

Use an authenticated EAS session or inject `EXPO_TOKEN` through the release
environment. Never commit or print the token.

#### iOS development-build verification

- Date: 2026-07-24
- Profile: `development` (`internal` distribution, development client); app config resolves to `Rhythm Agents Dev` with bundle identifier `org.visaliacrc.rhythm.agents.dev`.
- EAS identity and project checks succeeded for `@ajhochys-team/rhythm-mobile`. The worktree build reached remote iOS credential selection, but EAS found no credential suitable for internal distribution in non-interactive mode; no build ID or artifact URL was created.
- Physical-device smoke verification remains pending a successful signed build and an iPhone run.

#### iOS simulator-build verification

- Date: 2026-07-24
- Profile: `development-simulator` (extends `development`; simulator-only development client).
- EAS build `06192d33-6cc0-4ce4-8d8d-9e2d66416fe8` finished successfully: [Expo dashboard build details (requires account login)](https://expo.dev/accounts/ajhochys-team/projects/rhythm-mobile/builds/06192d33-6cc0-4ce4-8d8d-9e2d66416fe8). Remote native iOS compilation succeeded without Apple signing.
- This artifact is simulator-only. Apple Distribution signing, physical-device installation, and physical-device behavior remain unverified.
