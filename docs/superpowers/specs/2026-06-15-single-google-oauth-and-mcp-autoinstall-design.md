# Single Google OAuth + MCP Auto-Install — Design

Date: 2026-06-15
Status: Approved for planning
Branch base: `main` (current work branch: `opc-m1-foundation`)

## Summary

Three related features that eliminate redundant logins and manual setup by
reusing the credential and token a user already has:

1. **Calendar reuse** — the Google credential captured at sign-in already
   contains a calendar scope and refresh token; the Integrations screen should
   recognize it instead of launching a second OAuth round-trip.
2. **MCP auto-install** — the app registers the rhythm MCP server into opencode
   automatically using the live session token, replacing the hand-copied
   config in Settings.
3. **Google tools in the rhythm MCP** — Calendar and Gmail read/write tools,
   brokered through the Rhythm backend so they ride on the same single sign-in,
   gated behind an opt-in step-up consent for the broader scopes.

The features share infrastructure (the `integration_accounts` credential, the
`/auth/google/begin` re-auth path, the rhythm MCP server, opencode's `addMcp`)
and ship as three sequenced PRs: **F1 → F2 → F3**.

## Background (verified in code)

- Desktop sign-in (`desktop_google_oauth_client.dart:23,53–58`) requests
  `openid email profile calendar.readonly gmail.metadata` with
  `access_type=offline` + `prompt=consent`, so Google returns a refresh token.
- On exchange, `auth_controller.ts` calls `storeDesktopIntegration()`
  (`google_oauth_service.ts:148`), which calls `upsertGoogleAccountAsync`. That
  method writes **both** `google_calendar` and `gmail` rows
  (`integration_accounts_repository.ts:176`) with the refresh token.
- Calendar sync reads its bearer token from that `google_calendar` row and
  auto-refreshes via `ensureFreshAccount` / `refreshAccessToken`.
- `GET /integrations/accounts` already returns a per-provider DTO with a
  `status` field (`integrations_controller.ts:57–63`).
- The rhythm MCP server (`apps/mcp_server`) authenticates with
  `RHYTHM_API_TOKEN` (the session token shown in Settings → MCP Server Token)
  and calls the Rhythm API with `Authorization: Bearer`.
- opencode exposes `addMcp(name, config)` (`opencode_client_service.ts:1047`)
  which persists to `~/.config/opencode/opencode.json` **and** registers the
  server live. `McpLocalConfig` supports an `environment` map
  (`@opencode-ai/sdk` `types.gen.d.ts:946–968`), so the token passes in as an
  env var.

Net: the calendar credential and the MCP token already exist; these features
are wiring, not new auth systems.

---

## Feature 1 — Reuse sign-in OAuth for Calendar sync

**Goal:** after Google sign-in, calendar is connected silently — no second
"Connect Google" click, no second OAuth.

### Changes

1. **Backend — tighten "connected" semantics**
   (`integrations_controller.ts`, `toAccountDto` / `getAccounts`):
   - Report `google_calendar` as `connected` only when the stored row has both
     (a) a refresh token and (b) `calendar.readonly` present in its scope.
   - Add a derived `needsReauth: true` flag for the legacy case — a row exists
     but lacks the required scope (account created before the scope was added,
     or before a scope upgrade). This flag is the single signal the UI uses to
     decide whether to show a reconnect affordance.

2. **Frontend — silent connection**
   (`integrations_view.dart`, `integrations_controller.dart`):
   - When status is `connected`: render "Google Calendar — Connected" plus a
     **Sync** button. No connect button, no OAuth.
   - On first load after sign-in, kick an automatic initial calendar sync
     (silent auto-connect model).
   - When `needsReauth` or `disconnected`: show a **"Reconnect Google"** button
     that calls the existing `GET /auth/google/begin`. This is the only path
     that ever triggers a Google prompt.

3. No new OAuth flow, no schema change. Reuses `integration_accounts`,
   existing refresh logic, and the existing begin/callback as a fallback only.

### Error handling
- A sync returning 401 / `invalid_grant` (refresh token revoked at Google)
  flips the account to `disconnected`, surfacing the Reconnect button.

### Testing
- Unit: `toAccountDto` scope/refresh logic — connected vs needsReauth vs
  disconnected.
- Widget: connected state shows Sync and no connect button; needsReauth shows
  Reconnect.

---

## Feature 2 — Auto-install the rhythm MCP into opencode

**Goal:** the app registers the rhythm MCP server into opencode automatically
with the live token, self-healing on token rotation. Replaces the hand-copied
Settings JSON.

### Changes

1. **Backend — idempotent registration helper** (new method on
   `OpencodeClientService`, e.g. `ensureRhythmMcp(token, apiUrl)`):
   - Target config:
     ```jsonc
     {
       "type": "local",
       "command": ["npx", "-y", "@ajhochy/rhythm-mcp-server"],
       "environment": {
         "RHYTHM_API_URL": "<apiUrl>",
         "RHYTHM_API_TOKEN": "<token>"
       }
     }
     ```
   - Read current `opencode.json` `mcp.rhythm`:
     - absent → `addMcp('rhythm', config)`;
     - present but `environment.RHYTHM_API_TOKEN` (or URL) differs → rewrite +
       reconnect;
     - identical → no-op (makes repeated "on launch" calls cheap and safe).
   - Expose as `POST /opencode/mcp/rhythm/ensure` — no body; token from the
     authenticated request, `apiUrl` from server config.

2. **Trigger — on launch + on auth change** (Flutter,
   `AgentServerController` / auth listener):
   - Call the ensure endpoint when **both** opencode is ready **and** the user
     is authenticated against the cloud server (`api.vcrcapps.com`).
   - Re-fire whenever the session token changes (re-sign-in / rotation) so the
     MCP env never goes stale.
   - Guard: skip silently when not on the cloud server (a localhost-only token
     can't be reached by the MCP server), mirroring existing Settings gating.

3. **Settings UI:** keep the token display; demote the hand-copy JSON block to
   informational/advanced. Add a status line ("Rhythm tools: installed in
   opencode") reflecting the ensure result, plus an optional manual
   "Reinstall" button for recovery.

### Error handling
- `ensure` failures (npx missing, write error) are non-fatal: log + soft
  warning in Settings; never block app launch or agent sessions.

### Testing
- Unit: diff logic — absent → add; token changed → rewrite; identical → no-op.
- Integration: a token rotation updates `opencode.json`.

---

## Feature 3 — Google Calendar/Gmail tools in the rhythm MCP (brokered)

**Goal:** expose Calendar and Gmail read/write tools to opencode, authenticated
by the same single sign-in, via the Rhythm backend broker.

### External dependency (non-engineering gate)
`https://www.googleapis.com/auth/calendar` (full) and Gmail read/send are
Google sensitive/restricted scopes. General-user rollout requires Google OAuth
app verification, and Gmail restricted scopes require an annual third-party
security assessment (CASA). Engineering can land ahead of verification, but the
broader scopes will not work for general users until verification clears.

### Consent model — step-up, not sign-in broadening
- Keep base sign-in scopes unchanged (`calendar.readonly` + `gmail.metadata`)
  so Feature 1's silent calendar read stays zero-disruption and
  verification-light.
- Add an explicit **"Enable Google tools for the assistant"** action (Settings,
  near the MCP section) that runs an incremental authorization through the
  existing `GET /auth/google/begin` + `forceConsent` flow, requesting:
  - `https://www.googleapis.com/auth/calendar`
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/gmail.send`
- This reuses the same begin/callback machinery Feature 1 designates as the
  reconnect path, so the "needsReauth / scope-upgrade" path is unified across
  F1 and F3. Users who never enable agent Google tools never see the heavy
  consent.

### Changes

1. **Backend — new Rhythm API broker routes** (in `integrations` or a new
   `google` controller) wrapping Google REST calls via
   `ensureFreshAccount(...)` + the stored credential:
   - Calendar: list events, create event, update event, delete event.
   - Gmail: search messages, read message (body), send message.
   - Each enforces the requesting user's session and checks the stored scope;
     when the broader scope is missing, returns a structured
     `needs_scope_upgrade` error (not a generic 403).

2. **MCP tools** — add to the existing rhythm MCP server (`apps/mcp_server`):
   `rhythm_list_calendar_events`, `rhythm_create_calendar_event`,
   `rhythm_update_calendar_event`, `rhythm_search_gmail`, `rhythm_read_email`,
   `rhythm_send_email`. They call the new broker routes with the same
   `RHYTHM_API_TOKEN` they already use — no new env vars, no new opencode
   config. Feature 2's auto-install ships these tools the moment they exist.

3. **Scope-gating UX:** a tool returning `needs_scope_upgrade` causes
   Settings / the assistant to surface "Enable Google tools" → step-up consent.
   Same Google account throughout; the step-up only widens scopes on the
   already-linked credential.

### Error handling
- `invalid_grant` / revocation flips the account to `disconnected` (shared with
  Feature 1).
- Missing scope returns the structured upgrade signal, not a generic 403.

### Testing
- Unit: broker routes with mocked Google API — success, expired→refresh,
  missing-scope.
- Contract: MCP tool input/output shapes.
- Integration: step-up consent widens the scope set on the stored row.

---

## Sequencing

Three independent PRs, in order:

1. **F1 — Calendar reuse** (backend status semantics + Flutter Integrations UI).
   Establishes the shared `needsReauth` / scope-status signal.
2. **F2 — MCP auto-install** (backend `ensureRhythmMcp` + Flutter trigger +
   Settings status). Independent of F1.
3. **F3 — Google tools in rhythm MCP** (step-up consent + broker routes + MCP
   tools). Depends on F1's status/`needsReauth` work and F2's auto-install.

## Non-goals
- No standalone third-party Google MCP server (rejected: leaks Rhythm's Google
  client secret and raw refresh tokens into local opencode config, duplicates
  refresh logic).
- No broadening of base sign-in scopes for all users.
- No change to mobile sign-in beyond what F3's shared scope-upgrade path
  implies (mobile UI work tracked separately if needed).
