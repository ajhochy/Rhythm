# Rhythm — Project State

## Current focus

The native Cloud Gateway/mobile release candidate is isolated and verified locally. It restores
relay-backed mobile catalog, chat, Gallery, workspace, model/profile/tool, and offline recovery
behavior without exposing Tailscale language in the desktop access dialog.

## Active branch / PR

- Branch: `codex/cloud-gateway-mobile-release` (based on `mobile/synology-relay` at `36c27ef5`).
- PR: not yet opened; local GitHub CLI authentication is invalid and must be restored before push,
  PR, CI, merge, or release operations.
- The index contains the intended release candidate. Unstaged Terminal/PTy, transcript display,
  activity-service, proof-image, and unrelated postmortem work remains preserved in the working tree.

## In progress

- Commit the isolated index, push, open a draft PR, monitor required checks, and merge after green CI.
- Release affected surfaces after merge: hosted API/relay image, signed macOS desktop artifacts, and
  iOS production build/submission.
- Verify hosted health/source SHA and perform focused post-release desktop/mobile Cloud Gateway smoke.

## Risks / known issues

- GitNexus reports HIGH aggregate staged risk (64 files, 121 symbols, seven affected flows); focused
  `OpencodeProvider` recovery repair risk is LOW (one caller, no indexed flow).
- Local macOS release build produced a 70 MB universal `Rhythm.app`, but this machine does not trust
  the signing certificate chain. Distribution signing/notarization must pass in the release workflow.
- Mobile production-bundle verification requires the three production Expo OAuth/Cloud URL variables;
  they were not present locally. Nine Expo dependency recommendations are pre-existing on `main` and
  are not repository release gates.
- Terminal is intentionally deferred. The discussed Gallery cloud-upload redesign is not implemented.

## Test status

- PASS: repository issue checks (Flutter analyze/format, API and MCP TypeScript); full Flutter tests;
  macOS release compilation; mobile lint (zero errors, three warnings), typecheck, 25 suites/85 tests,
  static/security contracts, Expo config prebuild/introspection, and web E2E 71/71.
- PASS: API build; full serial Vitest 539 files/4,423 tests (104 files/162 tests skipped); focused
  gateway/relay 14 files/79 tests; restart diagnostic 1/1.
- PASS: isolated live sandbox health for API, engine bridge, and gateway; authenticated relay GET E2E
  1/1 through real `RelayUplinkClient` into candidate HTTP. Sandbox teardown and port cleanup passed.
- PASS: recorded physical-device c19, c22, c24-c27 plus online sessions, chats, Gallery, Models,
  Profiles, Scheduled Jobs, Settings, Agents, relay interruption recovery, and persisted messages.
- Triage resolved two mobile web failures: one hidden-element test locator and duplicate concurrent
  relay health probes. Full mobile verification passed after the repair.

## Next step

Restore GitHub CLI authentication with `gh auth login -h github.com`, then commit the isolated index,
push, open the PR, and continue through CI, merge, and the documented release workflows.
