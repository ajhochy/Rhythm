# Project State

## Current focus

Resolve the physical-iPhone smoke failures found after successful Google sign-in,
pairing, session creation, streaming, force-quit recovery, and automatic
Tailscale reconnection on PR #1165.

## Active branch / PR

- Local branch: `codex/mobile-1172-agents-activity`
- Remote PR branch: `feat/rhythm-agent-ios-roadmap`
- Draft PR: #1165, `WIP: consolidate unfinished Rhythm Agents iOS prototype`
- Exact local/pushed candidate: `e79605ac3`

## In progress

- #1237: make paired-Mac state authoritative across Settings and Agents.
- #1238: make the chat composer keyboard-safe and preserve/reveal the complete
  transcript.
- #1239: expose desktop Mobile Access pairing and revocation as a persistent
  Settings destination.
- Resume the remaining #1199 physical-device matrix only after those failures
  are repaired.

## Risks / known issues

- The signed iOS build can pair, create a session, and chat, but the current
  physical-device matrix is a mixed result and is not a release pass.
- Settings can remain stale as Connected after the Mac becomes unreachable,
  while other paired-Mac screens spin or eventually report offline.
- Long prompt composition and transcript reading are obstructed by the keyboard;
  complete assistant output may be view-clipped or transport-truncated and must
  be distinguished by a regression test.
- Desktop QR/revocation implementation exists but its only Settings entry is
  conditional on Agent Server Ready and was not discoverable in the tested
  workflow. Earlier pairing used a direct app link.
- Session synchronization, navigation taxonomy, model attribution, blank Tool
  tabs, oversized headers, and profile capability scoping remain tracked in
  #1231–#1236.
- Credentials, signing assets, pairing/device tokens, private hostnames, user
  content, and iPhone identifiers must not be committed or attached to issues.

## Test status

- Exact-head GitHub checks for `e79605ac3`: PASS.
- Google OAuth, pairing, session creation, and agent response: PASS on a
  physical iPhone.
- Force-quit/relaunch recovery: PASS.
- Background/foreground session survival: PASS.
- Tailscale off/on automatic reconnect: PASS, with stale/infinite-loading UI
  failure tracked by #1237.
- Multiline authoring, keyboard dismissal, and complete transcript visibility:
  FAIL, tracked by #1238.
- Visible desktop QR/revocation workflow: BLOCKED, tracked by #1239.
- Full #1199 physical-device and #1200 TestFlight matrices: NOT COMPLETE.

## Next step

Repair #1237–#1239, then repeat the bounded physical smoke for disconnect/
reconnect, long prompt/response with background recovery, visible QR pairing,
revocation, and replacement pairing before continuing the remaining #1199 and
#1200 release gates.

## Recent coding-agent runs

### 2026-07-28 — issue-1233-mobile-model-picker
- Files modified: mobile capability/provider types and selectors, chat composer/view,
  grouped native select UI, issue contract, fake-server E2E flow, package test script,
  and run log.
- Checks run: issue contract PASS (4/4); `git diff --check` PASS; typecheck,
  lint, existing provider utility test, and Playwright BLOCKED by unavailable
  dependencies after sandbox-restricted installs.
- Decisions made: use provider-list connection state as the authority; preserve
  each provider's last selection as recent ranking; use the provider label as
  account context because the OpenCode provider response exposes connected IDs
  but no separate account record.
- Deviations from spec: GitHub issue body/comments could not be fetched due
  blocked network; no commit/push/PR per orchestrator instruction.
- Concerns: orchestrator must verify exact issue wording, install dependencies,
  run static/E2E checks, and smoke the custom grouped sheet on iOS.
