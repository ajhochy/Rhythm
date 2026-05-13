# Smoke Test

Scope: Issue #499 — Manage Agents end-to-end smoke test, run against the currently open `/Applications/Rhythm.app` instance (`org.visaliacrc.rhythm`, pid 18831) on 2026-05-12.
Date: 2026-05-12

## Findings

- Requirement: the running app should support the Manage agents workflow end to end: preset cards, enable/disable behavior in the trigger bubble, custom agent creation, Claude resume, server failure surfacing, deleted preset restore, Gemini trigger availability, and OpenCode trigger/resume.
- The current instance initially showed `Agent server unavailable` because nothing was listening on `localhost:4001`. I started the repo API server on `localhost:4001` using the app DB path so the already-open app could continue.
- The first source-server start failed with a `better-sqlite3` Node ABI mismatch when the shell selected the wrong Node version. Starting with `PATH=/opt/homebrew/bin:$PATH` fixed that, and `/health` returned `{"status":"ok","service":"rhythm-api-server"}`.
- `Manage agents` opened and showed all four preset cards: Claude Code, Codex, Gemini CLI, and OpenCode. Claude Code, Codex, and Gemini CLI showed `Configured`; OpenCode showed `Needs setup` even though `opencode` is installed in a login shell, because the local server capability check returned `"opencode": false`.
- Toggling Codex off persisted to `GET /agent-configs/codex` as `"enabled": false`; I restored it to enabled before finishing.
- The Add agent menu exposed `+ Custom`, but the menu item did not activate through Computer Use. I created the requested temporary `Test` config through `POST /agent-configs` to verify the local API path, then deleted it before finishing.
- The current live Agents page showed no active or resumable sessions, and the New button did not open a session dialog during this run, so Claude resume, Start inline error, Gemini trigger button, and OpenCode trigger/resume could not be completed from the current UI state.
- Killing the local server with `kill $(lsof -ti:4001)` succeeded and left no listener on port 4001. The already-open Agents screen did not immediately refresh to an inline error after the kill.

## Checks

| Area | Check | How to run | Result | Reasoning |
| --- | --- | --- | --- | --- |
| Setup | Use the currently running Rhythm instance | Computer Use `get_app_state` for `Rhythm` | Success | Confirmed `/Applications/Rhythm.app` pid 18831 and did not relaunch the app. |
| Backend | Local agent server can be made reachable for the current instance | `PATH=/opt/homebrew/bin:$PATH PORT=4001 DB_PATH="$HOME/Library/Application Support/Rhythm/rhythm.db" AGENT_LOCAL=true npm run dev`; `curl http://localhost:4001/health` | Success | Server became healthy on `localhost:4001`; initial run without Homebrew Node failed with a native module ABI mismatch. |
| Frontend | Agents tab can reach Manage agents | Agents tab -> `Manage agents` | Success | Manage CLI Agents screen opened after the server was healthy. |
| Frontend | All four preset cards appear with install badges | Observe Manage CLI Agents | Partial | Claude Code, Codex, Gemini CLI, and OpenCode appeared. OpenCode showed `Needs setup` despite `opencode` being installed in a login shell. |
| Backend | Capability API matches visible badges | `curl http://localhost:4001/agents/capabilities` | Fail | Returned `{"claude-code":true,"codex":true,"gemini-cli":true,"opencode":false}` while `/Users/ajhochhalter/.local/bin/opencode` exists. |
| Frontend/API | Toggle an agent off | Click Codex switch; `curl http://localhost:4001/agent-configs/codex` | Partial | Codex persisted as disabled, but no trigger bubble was available in the current UI to verify disappearance there. Codex was restored to enabled. |
| Frontend/API | Add custom agent `Test` with command `echo hi`, AI Agent checked, enabled | Add-agent menu plus `POST /agent-configs` fallback | Partial | Add menu exposed `+ Custom`, but Computer Use could not activate it. API creation succeeded; temporary config was deleted afterward. Trigger bubble verification was blocked. |
| Frontend | Resume existing Claude Code session | Observe Agents page | Blocked | Current page showed `No active agent sessions`; no resumable Claude Code session was visible. |
| Frontend | Kill local server and confirm inline error appears on Start | `kill $(lsof -ti:4001)`, then try Agents `New` | Fail | Port 4001 was killed successfully, but the already-open screen stayed on the empty sessions view and did not surface an inline Start error during observation. |
| Frontend | Re-add a deleted preset | Manage agents | Blocked | Preset rows cannot be deleted through the API (`Preset configs cannot be deleted` by design), and the UI did not expose a deleted-preset state to restore. |
| Frontend | Gemini CLI trigger button appears if installed | `which gemini`; trigger bubble observation | Blocked | `gemini` is installed and capability API returned true, but no trigger bubble was available in the current UI. |
| Frontend | OpenCode trigger button and resume work end to end | `which opencode`; capability API; trigger/resume UI | Fail | `opencode` is installed in a login shell, but local capability API returned false and the UI showed `Needs setup`; trigger/resume could not proceed. |
| Backend | Source backend agent-config/session tests pass | `PATH=/opt/homebrew/bin:$PATH npm test -- --run src/__tests__/agent_configs.test.ts src/__tests__/agent_configs_routes.test.ts src/__tests__/agents_capabilities_routes.test.ts src/__tests__/agent_sessions.test.ts src/__tests__/pty_runner.test.ts` | Success | 5 test files and 69 tests passed. |
| Frontend | Source Agents tests pass | `flutter test test/features/agents` | Success | 84 tests passed. A broader first attempt failed only because `test/features/agent_configs` does not exist. |

## Known Gaps

- I did not run `cd apps/desktop_flutter && flutter run -d macos` because the user requested the currently running instance.
- No trigger bubble was present in the live instance, and this app was not launched with `RHYTHM_LOCAL_SEED_TRIGGER=1`, so trigger-bubble-specific checks could not be verified manually.
- No active or resumable Claude Code session was visible in the current Agents page.
- Port 4001 is intentionally left stopped after the requested kill check.
