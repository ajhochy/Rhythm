# Rhythm Agent iOS Design

**Status:** Proposed for written-spec review

**Related contract map:**
`docs/ai/contracts/2026-07-23-rhythm-mobile-opencode-api-map.md`

## Goal

Build an iOS-first, agent-focused Rhythm mobile app by forking
`alvarolorentedev/opencode-mobile`. The app provides agent chats, execution
activity, dedicated agent-tool screens, and connection settings. It talks
directly to Rhythm production for cloud-owned features and to one paired Mac
over Tailscale for local OpenCode and filesystem features.

The prototype proves the product through Tailscale. A later phase may replace
the local Tailscale transport with a production/Cloudflare relay without
rewriting feature screens.

## Product boundary

### Included

- Human-started agent chats, grouped or filtered by Rhythm project.
- Agent execution activity from scheduled jobs, webhooks, research, cookbook
  runs, and background self-improvement.
- Child/subagent sessions, approvals, questions, files, Git changes, diffs,
  skills, commands, MCP, providers/models, and terminal access.
- Dedicated tool screens for Brain, Deep Research, Scheduled Jobs, Webhooks,
  Profiles, Skills, Playbooks, Cookbook, Review Queue, Report Card, Email, and
  Gallery.
- App/account/paired-Mac settings.
- Google sign-in using the user's existing Rhythm account.
- One paired Rhythm Mac per user in the first release.
- EAS cloud builds for development-device and TestFlight distribution.

### Excluded

- Personal/staff task management.
- Rhythm projects as a project-management product; projects appear only as
  the allowed scope for agent chats and local workspace operations.
- Calendar, facilities, general messaging, and other non-agent staff tools.
- Android implementation and Android-specific testing.
- Direct OpenCode engine upgrade or process shutdown from the phone.
- OpenCode TUI remote controls.
- Experimental OpenCode v2/workspace/sync surfaces until Rhythm adopts them.
- Production/Cloudflare relay implementation in the prototype.

The Scheduled Jobs screen remains included. Its jobs are agent automation
definitions, not user task-management records.

## Repository layout

- Desktop/API/engine changes remain in `/Users/aj/Documents/Rhythm`.
- The mobile fork lives in `/Users/aj/Documents/opencode-mobile` and tracks:
  - `origin`: `https://github.com/ajhochy/opencode-mobile.git`
  - `upstream`: `https://github.com/alvarolorentedev/opencode-mobile.git`
- GitNexus indexes both repositories and groups them as `rhythm-mobile` with
  `host=Rhythm` and `client=opencode-mobile`.

## Information architecture

The app has three primary tabs.

### Agents

The Agents tab separates conversations from execution history.

#### Chats

- Show all chats or filter/group them by Rhythm project.
- Show active, completed, and archived chats.
- Show child/subagent conversations under their parent.
- Create, open, rename, archive, restore, fork, and delete chats.
- Present streaming transcript, tool calls, todos, cost/context information,
  approvals, questions, files, changes, and terminal.

#### Activity

- Present a chronological feed of agent executions.
- Include human chats, scheduled-job runs, webhook-triggered runs, research
  runs, cookbook runs, and background self-improvement runs.
- Filter by source, agent profile, Rhythm project, and status.
- Highlight active, waiting-for-approval, failed, and completed work.
- Open the associated transcript or result when one exists.

The Activity view shows executions. Tool screens configure the systems that
create those executions.

### Tools

Each item gets a dedicated mobile screen rather than being accessible only
through agent chat.

| Tool | Core mobile behavior | Data owner |
| --- | --- | --- |
| Brain | Browse, search, create, edit, and delete persistent memories | Rhythm Cloud |
| Deep Research | Start research, inspect progress, and read completed reports | Rhythm Cloud |
| Scheduled Jobs | List, create, edit, enable/disable, run now, and inspect runs | Rhythm Cloud |
| Webhooks | List, create, rotate/disable, delete, and copy inbound URLs | Rhythm Cloud |
| Profiles | Manage identity, prompt, model, permissions, scopes, and delegation | Rhythm Cloud, with local projection status |
| Skills | Browse skill catalog, inspect metadata/history, and manage local availability | Split cloud/local |
| Playbooks | Manage custom slash-command files used by the paired engine | Paired Mac |
| Cookbook | Manage recipes, run them, and open resulting activity | Rhythm Cloud |
| Review Queue | Review optimizer proposals and approve/reject with risk details | Rhythm Cloud |
| Report Card | Read run quality, recurring mistakes, and usage summaries | Rhythm Cloud |
| Email | Browse Gmail signals and agent-relevant message context | Rhythm Cloud |
| Gallery | Browse Canva-backed designs and design status | Rhythm Cloud |

### Settings

Settings controls the app and its connections, not agent definitions.

- Signed-in Rhythm account and sign-out.
- Paired Mac identity, status, replacement, and revocation.
- Tailscale and gateway diagnostics.
- Notifications.
- Appearance and mobile preferences.
- Rhythm API, gateway, and bundled OpenCode version diagnostics.

Profiles, Skills, Scheduled Jobs, Webhooks, MCP, and providers/models remain
feature screens and are not duplicated in Settings. Model/agent selection may
also appear contextually in the chat composer.

## Dual-connection architecture

The mobile app maintains two independent authenticated clients behind stable
feature interfaces.

### Rhythm Cloud client

- Base URL: Rhythm production API.
- Authentication: existing Rhythm Google sign-in and production user session.
- Owns cloud-backed Tools and cloud execution records.
- Remains usable when the paired Mac is offline.

### Paired Mac client

- Base URL: HTTPS endpoint created by Tailscale Serve.
- Authentication: revocable per-device token issued through one-time pairing.
- Talks to a new local mobile gateway in Rhythm's API server.
- The gateway forwards approved HTTP, SSE, and PTY WebSocket operations to the
  already-running bundled OpenCode server.
- The gateway never starts or replaces OpenCode; Rhythm already owns that
  process lifecycle.
- Local operations are restricted to projects registered in Rhythm.

Feature repositories depend on abstract cloud/local transports rather than a
hard-coded Tailscale URL. A future production relay can implement the same
local transport interface.

## Pairing and device identity

1. The user signs into Rhythm iOS with Google.
2. The same user opens **Enable Mobile Access** in Rhythm desktop.
3. Rhythm confirms the existing local OpenCode server is healthy.
4. Rhythm configures or validates Tailscale Serve for the local mobile gateway.
5. Rhythm creates a cryptographically random, single-use pairing code with a
   short expiration and binds it to the desktop Rhythm user.
6. Desktop displays a QR code containing only the tailnet gateway URL and the
   one-time pairing code.
7. iOS submits the code together with its authenticated Rhythm user identity
   and a generated device identifier/name.
8. The gateway rejects user mismatch, reuse, and expiration.
9. The gateway returns a revocable per-device token and compatibility
   metadata.
10. iOS stores the token in Keychain and discards the pairing code.

The first release permits one active paired Mac per user. Data structures use
explicit device and host IDs so future multiple-Mac support does not require
changing token semantics.

## Local mobile gateway

The gateway is a narrow authenticated boundary, not a second implementation
of OpenCode.

Responsibilities:

- Pair, authenticate, list, and revoke mobile devices.
- Return health and compatibility metadata.
- Resolve the allowlisted Rhythm project for each local request.
- Reject arbitrary directory/root parameters and path traversal.
- Proxy supported OpenCode HTTP operations.
- Proxy global/session SSE with reconnection-safe semantics.
- Proxy PTY WebSocket upgrade, token, binary/text frames, and closure.
- Normalize local error responses for the mobile transport.
- Exclude secrets, bearer tokens, pairing codes, and sensitive payloads from
  logs and telemetry.

The gateway does not expose engine self-upgrade, global/instance disposal, TUI
control, or unapproved experimental APIs.

## OpenCode compatibility and feature parity

Rhythm bundles OpenCode `1.14.49`; the upstream mobile fork currently imports
`@opencode-ai/sdk` `1.18.3` and describes itself as latest-only. The mobile app
must therefore consume a generated/pinned client based on Rhythm's bundled
OpenAPI contract rather than floating to npm's latest SDK.

The pairing/health response includes:

- Rhythm desktop/API version.
- Bundled OpenCode version.
- API contract fingerprint.
- Supported gateway feature IDs.
- Minimum compatible mobile version.

The app uses the feature list to hide or disable unsupported functions and
shows an actionable compatibility message instead of allowing unknown API
failures.

The prototype targets broad parity for useful headless/mobile behavior:

- All 60 currently surfaced mobile operations.
- The 10 adapter-only operations identified in the endpoint map.
- Useful missing operations for skills, projects, Git initialization,
  message/part management, session initialization/shell, tool schemas, MCP
  resources, and safe configuration reload/inspection.

It intentionally omits duplicate legacy operations when an established mobile
path already provides the same behavior, plus the excluded engine/TUI/
experimental families listed above.

## Cloud/local ownership and offline behavior

The two connection states are independent.

### Cloud state

- Signed in
- Refreshing token
- Session expired
- Network offline
- API unavailable

### Paired Mac state

- Connected
- Mac sleeping/unreachable
- Tailscale unavailable
- Pairing revoked
- Version incompatible
- Gateway or OpenCode unhealthy

Cloud-backed screens remain functional when the Mac is offline. Mac-dependent
screens show **Paired Mac offline** and preserve any safely cached read-only
state. They do not present a global app failure.

## Streaming and recovery

- On SSE interruption, reconnect with bounded exponential backoff and refresh
  the authoritative session transcript/status before applying new events.
- Deduplicate transcript/event updates by stable server identifiers.
- Keep interrupted runs visible in Activity and update them after reconnection.
- Treat authentication failure differently from network failure: revoked or
  invalid tokens require re-pairing; offline hosts keep the existing pairing.
- Close PTY sessions cleanly when the app backgrounds and allow explicit
  reconnection to a still-running PTY.
- Production failures affect only cloud-backed screens; local failures affect
  only paired-Mac screens.

## Security requirements

- Tailscale is required on Mac and iPhone for the prototype.
- Tailscale Serve provides tailnet-only HTTPS; the local OpenCode port is not
  exposed directly.
- Pairing codes are random, single-use, short-lived, and user-bound.
- Device tokens are high-entropy, revocable, and stored only in iOS Keychain.
- The gateway stores only a one-way token verifier where practical.
- Production OAuth/session tokens and local device tokens use separate stores
  and request clients.
- Gateway authorization happens before project resolution or proxying.
- Only Rhythm-registered projects are accepted.
- Mobile-provided filesystem paths are normalized and checked against the
  resolved project root.
- Destructive operations receive explicit confirmation in the mobile UI.
- Secrets never appear in QR screenshots after successful pairing, logs,
  analytics, crash reports, or Activity records.

## iOS build and test strategy

The development Mac runs macOS 13.2.1. Its newest compatible local Xcode,
14.3.1, cannot build Expo SDK 54, which requires Xcode 16.1 or newer. The app
will not downgrade Expo or require a macOS upgrade.

The official strategy is:

- Use Expo SDK 54 and React Native 0.81 from the fork.
- Connect the mobile repository to the existing EAS project `rhythm-mobile`
  with project ID `bd873c89-2fe2-45db-805c-ab819e582e5c`.
- Use EAS cloud builds with a current supported Xcode image.
- Produce signed development builds for physical-iPhone testing.
- Use TestFlight for broader prototype distribution.
- Use Metro, TypeScript, lint, unit tests, fake-server tests, and web E2E tests
  locally without Xcode.
- Run live Tailscale verification on a physical iPhone with Tailscale installed.

Expo Go is not the acceptance environment because the application uses native
capabilities and requires a production-like development build.

The initial EAS connection and production build commands are:

```bash
/Users/aj/.local/bin/rhythm-mobile-eas init \
  --id bd873c89-2fe2-45db-805c-ab819e582e5c
/Users/aj/.local/bin/rhythm-mobile-eas build --profile production
```

EAS authentication is stored in macOS Keychain under service
`rhythm-mobile-expo-token`. The launcher retrieves `EXPO_TOKEN` only for the
child EAS process, runs from `/Users/aj/Documents/opencode-mobile`, and avoids
placing the token in repository files, shell history, command arguments, or
agent output. Agents must use the launcher rather than reading the credential
source file.

## Verification requirements

### Contract verification

- A generated test compares the pinned mobile contract against Rhythm's
  bundled OpenAPI fingerprint.
- Every supported endpoint is classified as surfaced, internal, alternate, or
  intentionally omitted.
- New bundled endpoints fail the contract report until classified.

### Gateway verification

- Pair once; reject replay, expiry, and mismatched Rhythm user.
- Revoke a device and reject subsequent HTTP, SSE, and WebSocket access.
- Reject unregistered projects, arbitrary roots, and traversal paths.
- Verify gateway behavior through the real Rhythm API server and bundled
  OpenCode process, not mocks.
- Verify HTTP, SSE reconnection, and PTY WebSocket forwarding independently.

### Mobile verification

- Unit-test cloud/local transports and feature repositories.
- Test loading, populated, empty, offline, expired-auth, forbidden, and server
  error states for every dedicated screen.
- Test Chats grouping/filtering and Activity source/status filtering.
- Test Mac-offline isolation from cloud-backed Tools.
- Run existing fake-server and web E2E suites during development.
- Run a signed EAS development build on a physical iPhone against Tailscale.

### Rhythm behavioral gate

Any new backend behavior receives a gated live behavioral test and a run-log
entry under `docs/ai/runs/`, following `AGENTS.md`. Unit tests alone are not
sufficient for completion.

## Delivery decomposition

This design is intentionally split into independently testable subprojects.
Each gets its own implementation plan and coder/reviewer loop.

1. **Foundation:** pinned SDK contract, EAS setup, cloud/local transport
   interfaces, Google authentication shell, and compatibility model.
2. **Pairing gateway:** desktop Enable Mobile Access, Tailscale Serve,
   one-time pairing, device tokens, project allowlist, and proxy transport.
3. **Agents:** Chats, Activity, streaming recovery, child sessions, approvals,
   files, changes, and terminal.
4. **Cloud Tools:** Brain, Research, Scheduled Jobs, Webhooks, Profiles,
   Cookbook, Review Queue, Report Card, Email, and Gallery.
5. **Split/local Tools:** Skills, Playbooks, MCP, providers/models, and local
   diagnostics.
6. **Parity completion:** remaining approved headless endpoints and generated
   contract coverage gate.
7. **Prototype release:** physical-device security/recovery testing and
   TestFlight distribution.

The future production/Cloudflare relay is a separate design. It must implement
the established paired-host transport contract rather than changing screen or
feature repository interfaces.

## Success criteria

- A signed-in user can pair one Rhythm Mac through Tailscale without manually
  configuring the already-running OpenCode server.
- The app presents Agents → Chats and Activity, dedicated Tools, and Settings
  with the approved boundaries.
- Only Rhythm projects are available for local agent work.
- Cloud Tools continue to function while the paired Mac is offline.
- Useful headless OpenCode features meet the approved broad-parity contract.
- Pairing, revocation, HTTP, SSE, and PTY behavior pass live tests against the
  real bundled engine.
- A signed EAS development build runs on a physical iPhone over Tailscale.
- No macOS upgrade or local Xcode installation is required.
