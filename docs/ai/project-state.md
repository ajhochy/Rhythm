# Project State

## Current Status (2026-05-14, mid-session pause)

🟡 **PR #574 has 29 unpushed commits stacked locally on `opencode-engine-issue-564`.** The auth rework spec (Issues A–G) + smoke-found fixes E/F/G + a follow-up wave of stream-bridge + WS-gateway fixes all landed in this branch but the branch is NOT pushed. Last manual smoke surfaced one remaining gap that has a fix committed but unverified — see Outstanding Issues.

Automated checks (last run):
- **410/410 tests** (vitest, api_server)
- **tsc --noEmit** — clean
- **flutter analyze --no-fatal-infos** — clean (161 pre-existing info-level warnings)
- **dart format --set-exit-if-changed** — clean

## Outstanding Issues (must verify before merge)

| # | Issue | Status | Notes |
|---|---|---|---|
| 1 | **Follow-up WS prompts dropped** — second/third user messages in a Claude session never reached the LLM. Initial create-session prompt worked. | Fix committed (`40d4fee`), **not yet smoke-verified**. | `ws_gateway.ts session.input` handler was calling `opencodeClient.prompt(opencodeId, data, undefined, cwd)` with `undefined` model → SDK had no provider to dispatch to → prompt silently dropped. Fix: look up session's agentKind from DB, resolve model via the shared `agent_model_resolver`, pass to `promptAsync`. |
| 2 | **Gemini direct route requires Google OAuth, no other path** | UI tile shipped (`f501791`), user has not signed in. | `opencode-gemini-auth` plugin handles the listener on :8085; user clicks "Sign in with Google AI account" → polls /opencode/auth/ until `google` appears. Without it, gemini-cli falls back to `openrouter` which is rate-limited on this account. |
| 3 | **OpenRouter key rate-limited** on the live test account | Not a code issue. | Surfaces as `Error: Key limit exceeded (total limit). Manage it using https://openrouter.ai/settings/keys` via the new error-message extractor. User should top up at https://openrouter.ai/settings/keys or remove openrouter as fallback. |
| 4 | **macOS Keychain prompt on every app launch** | Cached per session, but the OS still prompts the first call after each app restart. User asked for this earlier. | Working as designed — Keychain access requires confirmation each new process. Cache lives inside `CredentialsBridgeService` and only re-prompts on `auth.set` failure within the same process. |
| 5 | **User-input messages not persisted to DB** | Known gap; assistant-only persistence currently. | `agent_session_messages` only contains `role: 'output'` (assistant) and `role: 'system'` (errors). User prompts are sent via WS and never written to the table. If a user reopens an old session they see assistant turns but no preceding user inputs. |
| 6 | **Local SDK type defs hand-maintained** | Risk: drift from `@opencode-ai/sdk` releases. | `apps/api_server/src/@types/opencode-ai-sdk.d.ts` is a hand-written subset. The cast pattern `as unknown as { data?: T; error?: E }` covers the actual runtime shape. After SDK upgrades, re-run `apps/api_server/scripts/auth-strategy-probe.ts` (gitignored) to catch breakage. |
| 7 | **`tasks_controller.test.ts` vitest flake** | Pre-existing, not blocking. | One test ("returns only open tasks (default)") intermittently fails when the full suite runs; passes in isolation. Cross-test pollution. Survives the rework unchanged. |
| 8 | **GitHub Copilot OAuth is custom-implemented** | Working, but tied to an upstream client_id. | We reimplemented the device-flow in `api_server/src/services/github_copilot_device_auth.ts` because the SDK's plugin polling can't be driven over HTTP RPC. Hard-codes GitHub `client_id=Ov23li8tweQw6odWQebz`. If GitHub revokes/rotates that ID, we have to update. |

## Recent Commits (29 stacked on opencode-engine-issue-564 since 70b87d7)

### Auth rework — spec phase
| SHA | Topic |
|---|---|
| `af7100e` | docs(spec): opencode auth rework design |

### Issue A — SDK `.data` unwrap (5 commits)
| SHA | Topic |
|---|---|
| `7375953` | unwrap res.data in listProviders |
| `9d3fa2c` | unwrap res.data in listModels |
| `ee7b283` | unwrap res.data in setAuth |
| `c99b821` | unwrap res.data in session methods |
| `7e9dfa4` | unwrap res.data in OAuth methods |

### Issue B — Auth source-of-truth (4 commits)
| SHA | Topic |
|---|---|
| `d29f4b5` | add OpencodeAuthStore (reads ~/.local/share/opencode/auth.json) |
| `e3a590f` | expose listAuthedProviders via auth store |
| `5ecc83a` | capabilities now reads from auth store, not catalog |
| `7199c1a` | GET /opencode/auth/ returns authed providers from auth store |

### Issue C — Anthropic Claude Code creds bridge (4 commits)
| SHA | Topic |
|---|---|
| `4f26be9` | read Claude Code creds from Keychain or file |
| `54cc1dd` | bridgeAnthropic + refresh via claude.ai (correction from `console.anthropic.com`) |
| `b740ea6` | bridge route + sources discovery |
| `9b09f58` | 30-min background refresh loop |

### Issue D — Flutter UI rework (1 commit, bundled D1/D2/D3)
| SHA | Topic |
|---|---|
| `4b2f6a4` | Flutter auth UI rework (subscription tile, polling, capability refresh) |

### Smoke-driven fixes E/F/G + iterations
| SHA | Topic |
|---|---|
| `b9fd5de` | OpenAI OAuth uses methodIndex=1 paste-back |
| `10df29d` | reimplement GitHub Copilot device flow in api_server |
| `1bc44f8` | route agent sessions to preferred provider/model |
| `08c4ada` | route via openrouter + show connected indicators |
| `bde0b91` | smart route fallback + persist session errors |
| `b2eefaa` | prefer github-copilot over openrouter for claude-code |
| `592624b` | persist session status + assistant messages |
| `cd80584` | look up sessionID from info/part for message events |
| `2184fef` | subscribe per-cwd + persist assistant turns |
| `2d51e9c` | readable error messages + don't clobber closed status |
| `928a28b` | route to user's direct provider account, not aggregator |
| `7499416` | auto-install community auth plugins on startup (claude-auth, codex-auth, gemini-auth) |
| `f501791` | Google Gemini OAuth tile + polling completion |
| `40d4fee` | **[unverified]** WS gateway passes model to follow-up prompts |

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

## Resolved Gaps (2026-05-13, branch `opencode-engine-issue-564`, pending merge)

| # | Resolution |
|---|---|
| #580 | `AgentSessionsController.resume()` now creates a new SDK session via `opencodeClient.createSession(name, cwd)`, registers `opencodeSessionMap`, starts the SSE stream bridge, and sets status to `starting`. Resumed sessions do NOT reattach prior SDK conversation history — per #580 scope. |
| #581 | `agent_configs_repository` no longer persists or echoes the five legacy CLI fields (`command`, `canResume`, `resumeCommand`, `sessionIdPattern`, `outputMarker`). DB columns retained for rollback safety. |

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

## Smoke-Found Fixes (2026-05-13, stacked onto `opencode-engine-issue-564`)

| # | Resolution | Commit |
|---|---|---|
| #585 | `apps/api_server/scripts/postinstall.js` force-rebuilds `better-sqlite3` from source against install-time Node and writes `apps/api_server/.node-runtime.json` sentinel. Flutter `_findNode()` reads the sentinel first so the api_server is spawned with the same Node the binary was built against; fallback candidate order now puts `/opt/homebrew/bin/node` ahead of `/usr/local/bin/node`. `engines: ">=20 <25"` pinned. `SKIP_BETTER_SQLITE3_REBUILD=1` escape hatch for CI. | `44fc175` |
| #583 | Settings AI Accounts now collects the OAuth code via a paste-back dialog (matches the SDK's out-of-band flow). After opening the browser we show the SDK's `instructions` field plus a code input, then `GET /opencode/auth/<provider>/callback?code=<pasted>` and refresh the connected-providers list. | `b374279` |
| #584 | `agents_capabilities_routes.ts` introduces `AGGREGATOR_PROVIDERS = ['openrouter', 'together', 'groq']` and extends `agentToProvider` so each CLI agent treats any aggregator as a satisfying provider. Connecting only OpenRouter now flips `claude-code` / `codex` / `gemini-cli` to true. | `b7859ce` |
| #582 | `_NoCLIDetected` → `_NoAgentsAvailable`. Copy rewritten to "Connect a provider in Settings → AI Accounts" with an inline `FilledButton.icon` that pushes `SettingsView` directly. | `5b3c8c4` |

## Known Gaps (tracked, not blocking merge)

| Gap | Detail |
|---|---|
| `pty_runner.ts` dead code | Still present in the repo. No production imports. Tracked in existing [#571](https://github.com/ajhochy/Rhythm/issues/571) (deletion of legacy PTY files). |
| Custom (non-preset) agent configs always show "Unavailable" (#575) | `AgentServerController.isAgentAvailable` keys the capabilities map by preset ID (`claude-code`, `codex`, `gemini-cli`, `opencode`). Custom configs have no entry. Acceptable until users can author custom Opencode providers. |
| Controller-side validation of legacy CLI fields on POST/PATCH | Repository no longer persists or echoes legacy CLI fields (#581 resolved), but `agent_configs_controller` still requires `command` and validates `resumeCommand`/`canResume` on input. Follow-up needed if/when the Flutter client stops sending them. |
| GitHub Copilot OAuth may use device flow (#579) | Current flow assumes redirect URL. The paste-code dialog from #583 will display the SDK's `instructions` field, but a device-flow payload may still need bespoke UX. Self-diagnosing — defer redesign until first user hits it. |
| `tasks_controller` vitest flake | One `GET /tasks` test ("returns only open tasks (default)") intermittently fails when the full vitest suite runs, but passes in isolation and on re-run (367/367 green). Cross-test pollution; not blocking merge. |
| Aggregator API-key registration (#584 follow-up) | Per #584 notes, `opencodeClient.listProviders()` may not surface API-key-only providers in every case. If smoke shows the API-key path doesn't register an aggregator with `listProviders()`, file as a follow-up against `opencode_client_service`. |

## End-to-End Flow
```
Flutter → POST /agent-sessions → controller creates SDK session + stores mapping + starts bridge
Flutter → WS session.input → ws_gateway → opencodeClient.prompt(sdkId, text)
Opencode → SSE events → stream bridge → WS broadcast → Flutter output
Flutter → DELETE /agent-sessions/:id → controller stops bridge + clears map entry + marks closed
```

## Branch / PR
`opencode-engine-issue-564` — Draft PR #574 — **local HEAD `40d4fee`, 29 commits ahead of last push at `70b87d7`**. NOT YET PUSHED. Auth rework (Issues A–G), follow-up smoke fixes for stream bridge / WS gateway / Flutter UI, plus plugin auto-installer all stacked here. See "Outstanding Issues" at top of this file for what still needs verification.

## What to do next (resume notes)

1. **Verify the WS gateway fix** (`40d4fee`). Open a Claude session in the running Rhythm app, send a follow-up prompt after the initial response, confirm the second/third user messages get an LLM reply. If they do, push the branch.
2. **Sign in with Google AI** via the new Settings tile so `gemini-cli` routes to the direct google provider. The opencode-gemini-auth plugin will catch the callback on :8085.
3. **Resolve OpenRouter rate-limit** on the test account so the openrouter fallback works for free-model use cases.
4. **Push the branch** (`git push origin opencode-engine-issue-564`) — keeps the draft PR up to date so the user can manually flip it to ready once smoke is fully clean.
5. **Document plugin requirements in CLAUDE.md** — the auto-installer adds `opencode-claude-auth`, `opencode-openai-codex-auth`, `opencode-gemini-auth`. Their presence is now a hard requirement for direct routing; this should be in the project's developer setup notes.

The session was paused mid-smoke. Watcher script at `/tmp/rhythm_watcher.py` is preserved if needed for the next round.
