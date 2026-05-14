# Project State

## Current Status (2026-05-14 v2 — M1-1 verified)

🟢 **PR #574 merged.** `main` is at `84eef44`; the Opencode auth/chat rework is now upstream.

🟢 **M1-1 (#586) implementation verified.** Backend `projects` table + CRUD + VCS probe landed on `m1-projects`. PR-level checks green (flutter analyze, dart format, tsc --noEmit, vitest 430/430 incl. 13 new). Smoke probes against `localhost:4099`: `/health` ok, `POST /projects` with the Rhythm repo cwd returns `vcsRoot=/Users/.../Rhythm, vcsBranch=m1-projects, vcsDirty=true`; relative-path → 400; `refresh-vcs` → 200; `DELETE` → 204.

**Branch state.** `m1-projects`, branched from `84eef44` (clean main). Local commits:
- `7ccadbf` — docs(ai): generated M1 issue bodies #586–#591
- (uncommitted) M1-1 source: migrations, model, vcs_probe service, repo, controller, route, tests, app.ts wire-up

Pending action by user: commit M1-1 + push branch + open PR for #586 (or stack #587–#591 first per the milestone-per-PR decision in `docs/ai/current-plan.md`).

**Active plan.** `docs/ai/current-plan.md` holds the 5-milestone parity roadmap with all 6 open questions resolved (2026-05-14). One-branch-per-milestone confirmed. Milestone #86 (`M1 — Sessions ↔ Projects`) tracks issues [#586](https://github.com/ajhochy/Rhythm/issues/586)–[#591](https://github.com/ajhochy/Rhythm/issues/591).

## Prior Status (2026-05-14, session-end snapshot — PRE-merge)

🟢 **Agents chat was fully working end-to-end** at PR #574 merge: user bubble right-aligned, assistant streams in place, Enter sends, auto-resume rebinds orphan sessions.

**Routing verification (live, `/opencode/auth/`):** authed providers = `["openrouter","anthropic","openai","github-copilot"]`. Local cred sources = `{"claudeCode":true,"codex":true}`. So:
- `claude-code` → `anthropic / claude-sonnet-4-6` (direct, via `opencode-claude-auth` Keychain bridge)
- `codex` → `openai / gpt-5.3-codex` (direct, via `opencode-openai-codex-auth`)
- `gemini-cli` → `openrouter / google/gemini-3.1-pro-preview-customtools` (Google not signed in)
- `opencode` (bare) → `openrouter / anthropic/claude-sonnet-4.6` (fallback)

Automated checks (last run, post 9b26aa1):
- **417/417 tests** (vitest, api_server) — `agents_ws_e2e.test.ts` has 4 cases (chat→server, server→chat, full round-trip, auto-resume regression)
- **tsc --noEmit** — clean
- **flutter analyze --no-fatal-infos** — clean (info-level findings only)
- **dart format --set-exit-if-changed** — clean
- **flutter test** — 180/180
- `ai-workflow checks --level pr` → exit 0

## Outstanding Issues (must verify before merge)

| # | Issue | Status | Notes |
|---|---|---|---|
| 1 | **Follow-up WS prompts dropped / no chat messages rendered** | **CLOSED** — user smoke-verified the parts-based chat thread renders user + streaming assistant bubbles correctly across all four agent kinds. Full chain in "Opencode Desktop UI port + auto-resume" section below. | — |
| 2 | **Gemini direct route requires Google OAuth, no other path** | UI tile shipped (`f501791`), user has not signed in. | `opencode-gemini-auth` plugin handles the listener on :8085; user clicks "Sign in with Google AI account" → polls /opencode/auth/ until `google` appears. Without it, gemini-cli falls back to `openrouter` which is rate-limited on this account. |
| 3 | **OpenRouter key rate-limited** on the live test account | Not a code issue. | Surfaces as `Error: Key limit exceeded (total limit). Manage it using https://openrouter.ai/settings/keys` via the new error-message extractor. User should top up at https://openrouter.ai/settings/keys or remove openrouter as fallback. |
| 4 | **macOS Keychain prompt on every app launch** | Cached per session, but the OS still prompts the first call after each app restart. User asked for this earlier. | Working as designed — Keychain access requires confirmation each new process. Cache lives inside `CredentialsBridgeService` and only re-prompts on `auth.set` failure within the same process. |
| 5 | **User-input messages not persisted to DB** | Known gap; assistant-only persistence currently. | `agent_session_messages` only contains `role: 'output'` (assistant) and `role: 'system'` (errors). User prompts are sent via WS and never written to the table. If a user reopens an old session they see assistant turns but no preceding user inputs. |
| 6 | **Local SDK type defs hand-maintained** | Risk: drift from `@opencode-ai/sdk` releases. | `apps/api_server/src/@types/opencode-ai-sdk.d.ts` is a hand-written subset. The cast pattern `as unknown as { data?: T; error?: E }` covers the actual runtime shape. After SDK upgrades, re-run `apps/api_server/scripts/auth-strategy-probe.ts` (gitignored) to catch breakage. |
| 7 | **`tasks_controller.test.ts` vitest flake** | Pre-existing, not blocking. | One test ("returns only open tasks (default)") intermittently fails when the full suite runs; passes in isolation. Cross-test pollution. Survives the rework unchanged. |
| 8 | **GitHub Copilot OAuth is custom-implemented** | Working, but tied to an upstream client_id. | We reimplemented the device-flow in `api_server/src/services/github_copilot_device_auth.ts` because the SDK's plugin polling can't be driven over HTTP RPC. Hard-codes GitHub `client_id=Ov23li8tweQw6odWQebz`. If GitHub revokes/rotates that ID, we have to update. |

## Opencode Desktop UI port + auto-resume (2026-05-14, commits d8b929d, 5591d51, a067083, 1fc8768, ef5ea12)

End state: confirmed working in the running app — claude-code, codex, opencode sessions all stream user + assistant bubbles correctly via OpenRouter.

The path to "working" required **five** distinct fixes, in this order. Future agents should treat this section as the canonical record of what these commits actually solve.

1. **Parts-based chat model (d8b929d).** Mirror Opencode Desktop's renderer (`/tmp/opencode-ref/packages/app/src/context/global-sync/event-reducer.ts`): one ChatMessage per session, one ChatPart per message, deltas mutate `part.text` in place. Replaces the old `_LiveOutputBuffer` + `_transcript` split. New WS event types forwarded by the bridge: `message.updated`, `message.part.updated`, `message.part.delta`, `message.removed` — each carries the SDK's `messageID`/`partID` intact so the Flutter reducer can address parts correctly.

2. **End-to-end WS suite (5591d51).** `agents_ws_e2e.test.ts` spins up a real http.Server + ws_gateway + stream bridge with a vi-hoisted SDK event queue. **Caveat:** the original three tests fed event shapes I assumed; one of them (`message.part.delta`) DID match the real SDK, the others use the SDK's actual SSE event union. Always verify mock fixtures against `/tmp/opencode-ref` before trusting the suite.

3. **`opencode` agent OpenRouter fallback + auto-resume (a067083).** Two distinct fixes in `ws_gateway.ts` + `agent_model_resolver.ts`:
   - `agent_model_resolver` now lists `openrouter / anthropic/claude-sonnet-4.6` for the bare `opencode` agent kind. Without this, OpenRouter-only setups got `Routing opencode session ... via <unmapped>` and prompts were silently dropped.
   - `ws_gateway.session.input` now auto-resumes orphan sessions: if `opencodeSessionMap.get(id)` is undefined (post-restart), pull cwd + name from the DB row, create a fresh SDK session, register the mapping, start the stream bridge, then forward the prompt. The user never sees the seam. Regression test in `agents_ws_e2e.test.ts`.

4. **WS connect only after server-ready (1fc8768).** `AgentsController.initialize()` runs at app launch, before the spawned api_server is up — `_agentServerController.isReady` is false, the controller gated out of `_repository.connect()` and never retried. Now it subscribes to `AgentServerController` (a ChangeNotifier) and calls `_tryConnectWs()` on every transition. This was the actual reason no WS frames reached Flutter for the longest time.

5. **Enter-to-send in chat composer + messages reply box (1fc8768 + ef5ea12).** `Focus` + `KeyEvent` handler around each TextField; `Enter` sends, `Shift+Enter` newlines.

## Chat round-trip fix (2026-05-14, commits 3e4df87 + f547a2c)

Diagnosed seam (recorded so future agents don't rediscover it):

- Backend `opencode_stream_bridge.ts` broadcasts deltas as `{type:'output', id, data}` which Flutter routes to `_liveOutputBuffer` (preview only). On `session.idle` it persisted the assistant turn to DB and broadcast `session.status` — **never `transcript.append`** — so the streamed text never finalized into the visible chat transcript.
- Flutter `agents_controller._onWsMessage` had no case for `TranscriptAppendMessage`, `output.flush`, or `error`, so any such frame would have been silently dropped anyway.

Fix applied (3e4df87):
- Bridge emits `{type:'transcript.append', id, role:'output', text}` on `session.idle` after persisting (only when `pendingText` is non-empty and the session has not errored this turn).
- On `session.error` with partial `pendingText`, the bridge flushes a `transcript.append` BEFORE the `error` frame and clears `pendingText` so a follow-up `session.idle` does not re-emit.
- `streamSession` logs an entry line so SSE subscription start is visible.
- Flutter controller handles `TranscriptAppendMessage` (append to `_transcript`, clear `_liveOutputBuffer[id]`) and `WsErrorMessage` (append role:`'system'` entry, clear live buffer). Both scoped to `_selectedSessionId` so background-session frames don't pollute the visible transcript — background transcripts reload on session select.
- `WsErrorMessage` model now carries `id`.

Cleanup (f547a2c): removed pre-existing dead `_hasCodex` field in `ai_account_section.dart` that was blocking `flutter analyze --no-fatal-infos`.

Tests added: `apps/api_server/src/__tests__/opencode_stream_bridge.test.ts` — 3 cases (delta+idle → transcript.append with accumulated text; error after partial delta → transcript.append precedes error; idle with empty buffer → no transcript.append).

Remaining: manual UI smoke. The "split UI" (live preview block + finalized transcript) stays in place until issues #593/#594 collapse it into a parts-based chat thread.

## Recent Commits (31 stacked on opencode-engine-issue-564 since 70b87d7)

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
| `40d4fee` | **[verified by code review]** WS gateway passes model to follow-up prompts |
| `3e4df87` | **[chat round-trip]** Bridge emits transcript.append on idle/error; Flutter handles TranscriptAppendMessage + WsErrorMessage |
| `f547a2c` | chore: remove pre-existing unused `_hasCodex` field that was blocking flutter analyze |

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
`m1-projects` — branched off clean `main` at `84eef44` (post PR #574 merge). Local-only commit `7ccadbf` adds the M1 issue bodies under `docs/ai/generated-issues/`. M1-1 implementation is on disk, not yet committed.

Historic: `opencode-engine-issue-564` → PR #574 — **MERGED** 2026-05-14.

## Active plan
`docs/ai/current-plan.md` is no longer a placeholder. It contains the full 8-issue UI port plan (Opencode Desktop reference at `github.com/anomalyco/opencode/tree/dev/packages/desktop`). Status of the plan's issues:

- **#590 / #591** (chat round-trip fix) — **DONE** (3e4df87). Manual UI smoke pending.
- **#592** (error path partial flush) — **DONE in 3e4df87** (folded into same commit).
- **#593–#597** (parts-based chat thread, sessions sidebar polish, details panel, model echo in DTO) — not started.

## Issue backlog state (2026-05-14)

All Opencode-implementation issues (#564–#585) are closed. Final disposition:

- **#564–#570, #572, #573, #575–#578, #582, #584, #585** — closed with commit references. Implementation matched the original issue.
- **#571** — closed by ae597b2; `pty_runner.ts` deleted.
- **#581** — closed by ae597b2; controller-side validation of legacy CLI fields removed; route tests updated to assert accept-and-ignore.
- **#579 (GitHub Copilot OAuth)** — closed; different approach taken (device flow in api_server instead of redirect-based OAuth through the SDK plugin).
- **#583 (OAuth callback lands on opencode.ai)** — closed; different approach taken (paste-back dialog in Settings instead of redirect-back to localhost).
- **#580 (resume() implementation)** — closed; scope note: resumed sessions get a fresh SDK session bound to the same local id, do not reattach prior SDK conversation history. DB-persisted assistant messages still render via the legacy transcript REST path.

Open issues remaining (none Opencode-related): #48 (PCO automation rules UX), #71 (mobile MVP scope), #418 (mobile smoke fail), #476 (AgentTriggerWatcher dev-gating).

## M1 — Sessions ↔ Projects (milestone #86)

| # | Issue | Status |
|---|---|---|
| #586 | M1-1 Backend: projects table + CRUD with VCS detection | **Implemented + verified** on `m1-projects`, uncommitted |
| #587 | M1-2 Backend: agent_sessions.project_id FK + per-project listing | Not started |
| #588 | M1-3 Backend: auto-assign project on session create | Not started |
| #589 | M1-4 Flutter: Project model + repository + controller | Not started |
| #590 | M1-5 Flutter: sidebar rail + project panel with VCS chip | Not started |
| #591 | M1-6 Flutter: edit-project dialog | Not started |

### M1-1 (#586) summary

Files added/changed on `m1-projects`:
- `apps/api_server/src/database/migrations.ts` — `CREATE TABLE IF NOT EXISTS projects` + `idx_projects_archived` (additive, idempotent)
- `apps/api_server/src/models/project.ts` (NEW) — `Project`, `CreateProjectDto`, `UpdateProjectDto`
- `apps/api_server/src/services/vcs_probe.ts` (NEW) — `probeVcs(cwd)` via `/bin/zsh -lc` (rev-parse → symbolic-ref → status --porcelain); best-effort, never throws
- `apps/api_server/src/repositories/projects_repository.ts` (NEW)
- `apps/api_server/src/controllers/projects_controller.ts` (NEW) — expandHome, absolute-path rejection (400), trailing-slash normalization, VCS re-probe on cwd change
- `apps/api_server/src/routes/projects_routes.ts` (NEW) — mirrors `agent_sessions_routes` AGENT_LOCAL bypass
- `apps/api_server/src/app.ts` — register `projectsRouter` at `/projects`
- `apps/api_server/src/__tests__/vcs_probe.test.ts` (NEW) — 5 tests (git, non-git, dirty toggle, detached HEAD, mocked spawn failure)
- `apps/api_server/src/__tests__/projects_routes.test.ts` (NEW) — 8 tests (CRUD + archive filter + cwd re-probe + refresh-vcs)

Endpoints: `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `POST /projects/:id/refresh-vcs`.

## What to do next (resume notes)

1. **Commit M1-1** on `m1-projects` (single commit covering migrations, model, service, repo, controller, route, app.ts, tests).
2. **Push `m1-projects` + open draft PR for #586** — or, per the milestone-per-PR decision in `current-plan.md`, stack #587/#588 onto the same branch before opening one PR for the whole backend half of M1.
3. **Dispatch coding-agent for #587** (M1-2: `agent_sessions.project_id` FK + per-project listing).
4. Outstanding non-M1 items still apply: Google AI sign-in for direct gemini routing; OpenRouter rate-limit on test account; plugin requirements doc in CLAUDE.md.
