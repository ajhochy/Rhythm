# Project State

## Current Status
✅ Opencode engine implementation complete and code-audited. PR #574 is open on branch `opencode-engine-issue-564`, awaiting manual smoke testing before merge to main.

All automated checks pass:
- **362/362 tests** (vitest)
- **tsc --noEmit** — clean
- **flutter analyze --no-fatal-infos** — clean
- **dart format --set-exit-if-changed** — clean

## Issues Completed

| # | Description | Commit |
|---|---|---|
| #564 | Install @opencode-ai/sdk + OpencodeClientService | `f13b033` |
| #565 | Init SDK on startup + /opencode/health endpoint | `baaa245` |
| #566 | Replace which-based capabilities with SDK providers | `de0f00b` |
| #567 | Replace PTY subprocess with SDK sessions | `6b797a4` |
| #568 | Opencode SSE stream bridge | `6b797a4` |
| #569 | Auth endpoints (OAuth + API key) | `aacaba0` |
| #570 | Flutter auth UI (Settings + ManageAgentsView) | `2109324` |
| #571 | Remove old PTY transcript, status service, reaper | `71697c6` |
| #572 | Remove .clideck-workflow directory | `8a95360` |
| #573 | Flutter data sources for Opencode engine | `8a95360` |

## Post-Issue Integration Fixes

| Fix | Description | Commit |
|---|---|---|
| WS gateway | Replaced `ptyRunner.sendInput()` with `opencodeClient.prompt()`. Removed all ptyRunner refs | `f152e69` |
| Stream bridge | Rewrote to properly subscribe to Opencode SSE events and map to WS format | `f152e69` |
| Session ID mapping | `opencodeSessionMap` routes local session IDs → SDK session IDs for prompt routing | `f152e69` |
| Auth flow | OAuth opens system browser via `url_launcher`. `GET /opencode/auth/` lists connected providers | `f152e69` |
| Tests | Updated agent_sessions.test.ts to mock opencode_engine instead of pty_runner | `e2a35c7` |

## Settings UI Cleanup (2026-05-13, issues #575–#579)

| # | Fix | Commit |
|---|---|---|
| #575 | Remove CLI command field, "Supports session resume" checkbox, and Configured/Needs-setup badge from Manage Agents cards. Drop unused CLI-era fields from `AgentConfig` (DB schema retained). | `f99fa7d` |
| #576 / #578 / #579 | Surface real OAuth/auth error message instead of generic fallback. Guard `jsonDecode` in `_saveApiKey` against non-JSON (HTML) error bodies. `getOAuthUrl` now returns `{error}` rather than swallowing exceptions. Provider IDs `anthropic` and `github-copilot` confirmed correct against SDK models cache. | `ab79260` |
| #577 | Remove "Claude Code CLI" / "Codex CLI" install rows + Refresh button + "Install Claude Code" banner from Settings AGENT SERVER card. Collapsed to a single "Running on localhost:4001" indicator. | `143f1eb` |

## Code Review Fixes (2026-05-13)

| Fix | File | Commit |
|---|---|---|
| Test mock missing `promptAsync` → TypeError → 400 not 201 | `agent_sessions.test.ts` | `55f8bff` |
| `_ready` closure not reset in afterEach → test order poisoning | `agent_sessions.test.ts` | `55f8bff` |
| `subscribed` stuck true when `subscribeToEvents()` returns null | `opencode_stream_bridge.ts` | `55f8bff` |
| `opencodeSessionMap` never cleaned up on session DELETE (memory leak) | `agent_sessions_controller.ts` | `55f8bff` |
| Double `expandHome(cwd.trim())` — redundant re-expansion | `agent_sessions_controller.ts` | `55f8bff` |
| Silent catch blocks with no logging in service methods | `opencode_client_service.ts` | `55f8bff` |
| `_refreshConnectedProviders` called wrong endpoint, never populated state | `ai_account_section.dart` | `55f8bff` |

## Known Gaps (tracked, not blocking merge)

| Gap | Detail |
|---|---|
| `resume()` is a stub | Sets status to `starting` but never creates an SDK session, maps it, or starts the stream bridge. Spawn task filed. |
| `pty_runner.ts` dead code | Still present in the repo. No production imports. Removal deferred to follow-up PR. |
| Custom (non-preset) agent configs always show "Unavailable" (#575) | `AgentServerController.isAgentAvailable` keys the capabilities map by preset ID (`claude-code`, `codex`, `gemini-cli`, `opencode`). Custom configs have no entry. Acceptable until users can author custom Opencode providers. |
| Legacy CLI columns still accepted by API on write (#575) | Model no longer reads/writes them, but `apps/api_server/src/repositories/agent_configs_repository.ts` still persists `command`, `canResume`, `resumeCommand`, `sessionIdPattern`, `outputMarker` if present. DB schema unchanged for backward compat. Server-side cleanup can be a follow-up. |
| GitHub Copilot OAuth may use device flow (#579) | Current flow assumes redirect URL. If SDK returns a device-flow payload instead, the new error surfacing exposes the SDK message but the UI does not yet render device-code instructions. Self-diagnosing — defer redesign until first user hits it. |
| API server rebuild required for #578 fix | `POST /opencode/auth/:provider` route fix is in source; ensure `apps/api_server/dist/` is rebuilt and the bundled-server release picks it up. The Flutter-side `jsonDecode` guard is defensive regardless. |

## End-to-End Flow
```
Flutter → POST /agent-sessions → controller creates SDK session + stores mapping + starts bridge
Flutter → WS session.input → ws_gateway → opencodeClient.prompt(sdkId, text)
Opencode → SSE events → stream bridge → WS broadcast → Flutter output
Flutter → DELETE /agent-sessions/:id → controller stops bridge + clears map entry + marks closed
```

## Branch / PR
`opencode-engine-issue-564` — Draft PR #574 — pushed `55f8bff`
