# Project State

## Current focus

**2026-06-17 (late) — agents UI/auth batch on #729 (DONE, app smoked, awaiting merge):**
All on branch `workflow/run-2026-06-16-mcp-autoinstall`, pushed. Smoked in a live `flutter run` build.
- **Resizable inspector panel** (`3b61a64`): draggable divider, persisted width (`agents.inspector.width`, clamp 280–640).
- **Model-family-aware agent identity** (`30bb3fc` + Context-tab follow-up): OpenRouter sessions no longer show "Claude Code". New `agent_badge_identity.dart` resolver keyed on `modelId` family; used by the session-row badge AND the Context-tab "Agent" row. Anthropic-via-OpenRouter still reads Claude; Llama/etc. read "OpenRouter".
- **Gemini on the user's Google account (native, free Code Assist) — WORKS end-to-end.** The saga:
  - Reverted the misguided "Option C" app-login→opencode token bridge (`852f3fa` reverted by `336099f`): opencode's Gemini uses Google's OWN gemini-cli OAuth client (`681…apps.googleusercontent.com`) via the `opencode-gemini-auth` plugin, NOT the app's client — bridging the app login token was a wrong premise.
  - Sign-in dialog hung because the plugin stores creds in `~/.gemini/oauth_creds.json` (gemini-cli location), not opencode's `auth.json`; fixed `OpencodeAuthStore.listAuthedProviders()` to also report `google` when that file has tokens (`b61da5f`) → dialog completes + gemini-cli capability lights up.
  - `ProviderModelNotFoundError`: opencode registered NO `google` provider because the user is a **Google Workspace account** (`visaliacrc.com`) which REQUIRES `provider.google.options.projectId`. User created GCP project **`rhythm-491406`** + enabled Gemini for Google Cloud / Code Assist → `opencode models google` then lists models.
  - `gemini-cli` ROUTE_FALLBACKS: removed dead `google` direct routes, then re-added them (leading) with VALID Code Assist ids (`gemini-2.5-pro`/`gemini-2.5-flash`/`gemini-3.1-pro-preview`; the old `gemini-3-pro-preview`/`gemini-3-flash` don't exist), OpenRouter as fallback (`feat` commit). Resolver picks google first (authed) → runs on the user's free Code Assist (no OpenRouter credits). Billing: **no billing account linked to `rhythm-491406` → cannot be charged**; free tier is rate-limited only.
  - **Auto-config** (`31c124e`): `ensureGeminiProjectConfig()` writes `provider.google.options.projectId` (const `GEMINI_CODE_ASSIST_PROJECT_ID`, env-overridable `GEMINI_PROJECT_ID`, default `rhythm-491406`) into `~/.config/opencode/opencode.json` on engine startup BEFORE `createOpencode`. Verified: fresh start auto-writes it + google registers. So every Workspace user gets native Gemini after Google sign-in, zero GCP setup.
- **DEV-ONLY note:** running via plain `flutter run` needs `--dart-define=GOOGLE_DESKTOP_CLIENT_ID=999198211175-em7b006pdol702sa5qecv9dhu2km483a.apps.googleusercontent.com` (public desktop client id; recovered from the installed release `.app`) or the app login errors "GOOGLE_DESKTOP_CLIENT_ID is not set". Release/CI already passes it; this is only a hot-test concern.
- **Open product question:** native-Google Gemini needs a GCP project + Code Assist (done once for this org via the hardcoded projectId). For OTHER orgs/non-technical users, OpenRouter or a Gemini API key remains the no-setup path.

---

**2026-06-17 update — #729 smoke + remote-OAuth workaround (DONE, awaiting merge sign-off):**
PR [#729](https://github.com/ajhochy/Rhythm/pull/729) is OPEN/mergeable (not draft). During smoke:
- Catalog pinned to 5 verified servers (dropped google-workspace + planning-center — no real npm package accepts an injected token; both are already brokered by the rhythm MCP F3/F4). Remaining: pdf-tools (works), stripe + mailchimp (API-key via secrets UI), canva + notion (remote OAuth).
- **opencode remote-OAuth is broken** (engine 1.14.40): the SDK/HTTP `POST /mcp/:name/auth` path generates the consent URL + starts the loopback callback server but **never registers the `state`** in the validator → every callback fails `pendingStates=[] Invalid/expired state` (known unfixed bugs anomalyco/opencode#17822, #15546; working path is only the CLI `opencode mcp auth`).
- **Workaround built + verified end-to-end** (canva tools listed by an OpenRouter agent): api_server now does the whole OAuth itself — `mcp_oauth_service.ts` (discover → own DCR → PKCE+state → own loopback callback on `:53682` → token exchange → write tokens to opencode's `~/.local/share/opencode/mcp-auth.json` exact schema → raw `reconnectMcp`). Routes `POST/GET /opencode/mcp/:name/oauth/{start,status}`. Flutter `connectServer` branches OAuth servers to start+poll-status. Spec: `docs/superpowers/specs/2026-06-17-mcp-remote-oauth-workaround.md`.
- Also fixed earlier: `connectMcp` now calls `mcp.auth.start` first so a consent URL surfaces (the original "Connect doesn't open browser" report). Commits `2d096a1`, `2bc199a`, `20dbc1b`, `8a240b1`.
- **Next:** human merges #729 on GitHub, then fold into the next desktop release.

**2026-06-17 follow-ups (DONE, same branch, pushed):**
- Moved the **MCP Servers** section out of global Settings into the **Agent Settings** dialog (`_agent_settings_sheet.dart`); removed from `settings_view.dart`. Commit `14573df`. Smoked (renders in the right spot).
- **Credentials entry for curated key-based servers** (stripe/mailchimp): GET `/opencode/mcp` now flags `needsCredentials` from the catalog's `requiredEnv` (was only checking empty env values, so key-less curated servers showed bare "failed") and surfaces `requiredEnv`; new `POST /opencode/mcp/:name/credentials` merges the entered key into the curated command and reconnects. Flutter: tappable "Needs credentials" badge → focused secure-field-per-key dialog → `setCredentials` → refresh. Commits `14ba922` (backend), `8095341` (flutter). Verified live: stripe/mailchimp now report `needsCredentials:true` + `requiredEnv`. User opted NOT to enter real keys (will troubleshoot if a real user hits it) — the connect itself is untested end-to-end, but the UX path is in place and the backend reconnect reuses the proven `addMcp`.

---

**Branch:** `workflow/run-2026-06-16-mcp-autoinstall` (isolated git worktree at `~/Documents/Rhythm-mcp-autoinstall`, off `main` `20e9672`). Draft PR pending.
**Status:** Curated MCP-server autoinstall feature — all 7 issues (MCP-1…MCP-7) implemented, verified, and committed on the run branch. Auto-installs 7 church-staff MCP servers into the embedded opencode engine: PDF Tools (zero-auth), Google Workspace + Planning Center (token-bridged from Rhythm's stored OAuth), Stripe + Mailchimp (API-key via the new secrets UI), Canva + Notion (remote, OAuth-on-first-use). See per-issue entries below + `docs/ai/decisions.md` (2026-06-16).
**Worktree-isolation note:** this run was moved into a dedicated worktree mid-flight after a concurrent "inspector UI parity" session reset the shared checkout's branch/HEAD. The AgentFlow `implement_issue` engine writes to the main checkout, so MCP-2…7 were implemented via worktree-scoped coding subagents (skill-chain fallback) instead. node_modules symlinked + `flutter pub get` in the worktree.
**Test status:** api_server tsc 0 ✓ | vitest 857/857 (97 files) ✓ | flutter test 548/548 ✓ | flutter analyze 0 errors ✓ | dart format clean ✓.
**Open follow-ups before release:** (1) several MCP package pins are placeholders flagged `TODO(verify-pin)` (esp. community `@agentx-ai/mailchimp-mcp-server` + unversioned npx specs) — confirm + version-pin for supply-chain safety; (2) Google/PCO token-bridge injects Rhythm's raw access token into a server env var (`GOOGLE_OAUTH_ACCESS_TOKEN`/`PCO_ACCESS_TOKEN`) — confirm the chosen servers actually accept a bearer token via env (else they fall back to their own OAuth, which still works); (3) the `/opencode/mcp` router is unauthenticated in agent-local mode, so token injection only fires when `req.auth` is present — confirm the caller path supplies it.
**Next step:** push run branch, open draft PR, then human `flutter run -d macos` smoke test (Settings → MCP: confirm 7 servers appear, uncredentialed ones flagged, secrets entry persists, remote OAuth reachable).

## Known bugs (parked, not blocking PR #617)

_(Parked bugs from before 2026-05-27 run. #638 and #635 below are now RESOLVED — see 2026-05-27 run entry.)_

---
**Run history:** one file per run under `docs/ai/runs/` (surfaced as `ai-runs/`); prior log in `runs/_migrated-2026-06-18.md`. Snapshot overwritten in place.
