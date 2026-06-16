# Current Plan — Curated MCP-server autoinstall for the embedded opencode engine (2026-06-16)

## Status

**PLANNING COMPLETE (2026-06-16).** 7 atomic issues decomposed, dependency-ordered, on branch
`workflow/run-2026-06-16-mcp-autoinstall` (one combined run branch per user decision). Issue
creation is **local files only** (`docs/ai/generated-issues/`). Awaiting `acceptance-contract` +
`coding-agent`.

## Goal (one sentence)

Auto-install (and idempotently refresh) a curated set of 7 MCP servers — Planning Center (PCO),
Google Workspace, Canva, Stripe, Mailchimp, Notion, PDF Tools — into the opencode engine bundled
in the Rhythm macOS app, reusing Rhythm's existing stored OAuth where a usable runtime token
exists, collecting API-key secrets for local key-based servers, and using opencode's
OAuth-on-first-use for remote servers — all idempotent, non-fatal on failure, and gated exactly
like the existing `ensureRhythmMcp` installer.

## Credential model (locked — do NOT relitigate)

Per the user decision: **reuse Rhythm's existing stored OAuth wherever possible.**

| Server | Type | Credential path (decided) |
|---|---|---|
| Planning Center (PCO) | local stdio | Reuse Rhythm-stored PCO token (token-bridge, MCP-6) or PAT fallback |
| Google Workspace | local stdio | Reuse Rhythm-stored Google token (token-bridge, MCP-6) |
| Canva | remote (`{type:'remote',url}`) | opencode OAuth-on-first-use — no install-time secret |
| Stripe | local stdio | User-entered API key via extended Add-MCP secrets UI (MCP-3) |
| Mailchimp | local stdio | User-entered API key via extended Add-MCP secrets UI (MCP-3) |
| Notion | remote (`{type:'remote',url}`) | opencode OAuth-on-first-use — no install-time secret |
| PDF Tools | local stdio | None — true zero-touch autoinstall |

## CENTRAL ARCHITECTURAL FINDING (verified during planning — read before MCP-6)

**Rhythm DOES persist reusable per-user Google + PCO access/refresh tokens, but they are not
currently shaped for direct injection into a third-party MCP server.**

Verified evidence:
- `integration_accounts` SQLite table (`migrations.ts:72-90`) stores `access_token` /
  `refresh_token` / `expires_at` / `scope` per `(owner_id, provider)`.
- `google_oauth_service.ts:80-90,189-218` and `planning_center_oauth_service.ts:41-92` persist
  AND actively refresh those tokens.
- The local agent server (`AGENT_LOCAL=true`) reads them via
  `integration_accounts_repository.ts:50-73` **only when it points at the same SQLite DB**.
- Today these tokens are consumed via a **broker pattern**, NOT env injection:
  `integrations_controller.ts:15-56` deliberately strips `accessToken`/`refreshToken` from the
  DTO; `google_broker_controller.ts:31` calls `ensureFreshGoogleAccount(...)` server-side and
  returns only results. The ONLY env block injected into any MCP server today is
  `{RHYTHM_API_URL, RHYTHM_API_TOKEN}` in `ensureRhythmMcp` (`opencode_client_service.ts:~1070`).
- `opencode_plugin_config.ts` is **not** a credential bridge — it only ensures provider *auth
  plugins* are listed (`opencode-claude-auth`, etc.). It does not write `auth.json`.

**Implication for MCP-6:** App-level OAuth *client* creds (`GOOGLE_CLIENT_ID/SECRET`,
`PCO_APPLICATION_ID/SECRET`) are NOT directly usable; the per-user token IS persisted and
refreshable, but two mismatches remain and are flagged in Open Questions: (1) the Rhythm-issued
token is scoped to Rhythm's OAuth client/scopes — the chosen third-party MCP server must accept a
raw bearer token via env rather than running its own OAuth; (2) the local agent server must be
confirmed to read the same SQLite store the desktop app writes. MCP-6 plans the **smallest** token
read→inject bridge and explicitly defers the scope/PAT decision to the Open Questions resolutions.

## Architecture decisions (locked)

- Extend the existing `opencode.json` read-merge-write pattern; do NOT introduce a new config store.
- New idempotent `ensureCuratedMcps()` modeled on `ensureRequiredPlugins()` (Set/JSON-compare
  no-op detection) + `ensureRhythmMcp()` (persist-before-SDK-register, non-fatal live register).
- Autoinstall gated like `shouldAutoInstallRhythmMcp` (engineReady && authenticated && isCloudServer)
  and de-duped per the existing `_lastInstalledToken` style.
- No third-party OAuth client apps are obtained and no third-party secrets are committed.
- Exact package/URL choices are recorded in MCP-7 (the curated registry) and reviewed at PR.

## Issues (dependency-ordered)

| Order | Issue file | Title | Goal | Likely files | Tests | Depends on |
|---|---|---|---|---|---|---|
| 1 | `mcp-1-env-injection-plumbing.md` | Env-map plumbing through POST /opencode/mcp + entry surfacing | `POST /opencode/mcp` accepts and persists an optional `environment` map (and explicit `type`); `addMcp` already passes it to SDK; `listMcp`/`McpServerEntry` surface `environment` keys + a `needsCredentials` signal so the UI can flag uncredentialed servers | `apps/api_server/src/routes/opencode_mcp_routes.ts`, `apps/api_server/src/services/opencode_client_service.ts`, `apps/api_server/src/@types/opencode-ai-sdk.d.ts` | vitest (`opc_m4_3_mcp_routes.test.ts` extended) | — |
| 2 | `mcp-2-ensure-curated-set.md` | Idempotent `ensureCuratedMcps()` + curated registry scaffold + route | New `ensureCuratedMcps(opts)` merges a `CURATED_MCP_SERVERS` array into `opencode.json` `mcp` block: adds missing, refreshes changed, no-ops identical (JSON-compare), persists `environment`, best-effort live-registers (non-fatal); proven end-to-end with PDF Tools (zero-auth local stdio) as the first registry entry; exposed via `POST /opencode/mcp/curated/ensure` returning `{changed, registered, servers}` | `apps/api_server/src/services/opencode_client_service.ts` (or new `services/curated_mcp.ts`), new `apps/api_server/src/config/curated_mcp_servers.ts`, `apps/api_server/src/routes/opencode_mcp_routes.ts` | vitest (new `opc_curated_mcp_ensure.test.ts`) | MCP-1 |
| 3 | `mcp-3-flutter-secrets-field.md` | Per-server env-secrets field in Add-MCP dialog | `_AddMcpServerDialog` gains a key/value secrets editor; `McpController.addServer` and `McpDataSource.addServer` accept an `environment` map and send it in the POST body | `apps/desktop_flutter/lib/features/settings/widgets/mcp_section.dart`, `apps/desktop_flutter/lib/features/settings/controllers/mcp_controller.dart`, `apps/desktop_flutter/lib/features/settings/data/mcp_data_source.dart` | flutter test (extend `opc_m4_3_mcp_section_test.dart`) | MCP-1 |
| 4 | `mcp-4-needs-credentials-ui.md` | Surface installed-but-uncredentialed servers | `McpSection` shows a distinct "Needs credentials" / "Sign-in required" badge for curated servers whose required env keys are absent (key-based) or whose status is `needs_auth` (remote OAuth), with an affordance to add a key | `apps/desktop_flutter/lib/features/settings/widgets/mcp_section.dart`, `apps/desktop_flutter/lib/features/settings/data/mcp_data_source.dart`, `apps/desktop_flutter/lib/features/settings/controllers/mcp_controller.dart` | flutter test (extend `f2_mcp_status_test.dart`) | MCP-1, MCP-3 |
| 5 | `mcp-5-curated-autoinstall-trigger.md` | Curated autoinstall trigger wiring | New `CuratedMcpAutoInstaller.ensure()` POSTs `/opencode/mcp/curated/ensure`; `shouldAutoInstallCuratedMcp(...)` gate mirrors the rhythm installer; called from `agent_server_controller.dart`, de-duped, non-fatal | `apps/desktop_flutter/lib/app/core/agents/curated_mcp_auto_installer.dart` (new), `apps/desktop_flutter/lib/app/core/server/agent_server_controller.dart` | flutter test (new `curated_mcp_autoinstall_test.dart` mirroring `f2_rhythm_mcp_autoinstall_test.dart`) | MCP-2 |
| 6 | `mcp-6-google-pco-token-bridge.md` | Google + PCO token bridge (reuse stored OAuth) | Smallest mechanism to make Rhythm's persisted per-user Google/PCO tokens usable by their MCP servers: read fresh token from `integration_accounts` (reuse `ensureFresh*Account`) and inject into the curated server's `environment` at ensure time (or document the PAT path for PCO); skip the server cleanly when no token is connected | `apps/api_server/src/services/curated_mcp.ts` (or `opencode_client_service.ts`), `apps/api_server/src/services/integrations_service.ts`, `apps/api_server/src/repositories/integration_accounts_repository.ts`, `apps/api_server/src/config/curated_mcp_servers.ts` | vitest (new `opc_curated_mcp_token_bridge.test.ts`) | MCP-2 |
| 7 | `mcp-7-curated-server-entries.md` | Per-server curated config entries (remaining 6) | Add the remaining 6 entries to `CURATED_MCP_SERVERS` with exact package/URL, type, and required-env metadata: PCO (maintained people/services/giving server), Google Workspace (`taylorwilsdon/google_workspace_mcp`), Canva (official remote URL), Stripe (official `@stripe/mcp`), Mailchimp (maintained server), Notion (official makenotion hosted MCP); record every exact choice in this plan + decisions.md | `apps/api_server/src/config/curated_mcp_servers.ts`, `docs/ai/decisions.md` | vitest (extend `opc_curated_mcp_ensure.test.ts` — assert 7 entries, correct types, required-env metadata) | MCP-2, MCP-3, MCP-5, MCP-6 |

## Acceptance criteria (per issue — all testable)

**MCP-1**
- c1: `POST /opencode/mcp` with body `{name, command, environment:{K:'v'}}` persists `environment`
  into `opencode.json` `mcp[name].environment` (assert written file contents).
- c2: `POST /opencode/mcp` with `{name, url, type:'remote'}` persists a `{type:'remote',url}` entry
  with no `command`.
- c3: `POST` with neither `command` nor `url` → 400.
- c4: `GET /opencode/mcp` entries expose `environment` keys (values MAY be redacted) and a boolean
  `needsCredentials` field; assert shape against a real-shape SDK status fixture.
- c5: existing `opc_m4_3_mcp_routes.test.ts` assertions still pass (no regression).

**MCP-2**
- c1: ensure on an `opencode.json` lacking PDF Tools → entry added (`changed:true`), file contains
  the PDF Tools `{type:'local',command:[...]}` entry.
- c2: ensure again with identical config → `changed:false`, file byte-identical (no-op).
- c3: ensure when an entry's desired config differs (e.g. env changed) → that entry rewritten,
  unrelated `mcp` entries (incl. `rhythm`) preserved.
- c4: live-register failure (SDK throws) → function still returns `changed:true, registered:false`
  and does not throw (non-fatal).
- c5: `POST /opencode/mcp/curated/ensure` returns `{changed, registered, servers:[...]}` 200.

**MCP-3**
- c1: Add-MCP dialog renders a secrets editor (key `mcp-dialog-env-add`); adding a row + confirm
  calls `addServer` with a non-empty `environment` map (assert fake data source captured it).
- c2: `McpController.addServer(environment:{...})` forwards the map to the data source.
- c3: `McpDataSource.addServer` includes `environment` in the POST JSON body (assert request body).
- c4: dialog with no secret rows sends `environment` omitted/empty (back-compat with command/url-only).

**MCP-4**
- c1: a curated key-based server whose required env keys are absent renders a "Needs credentials"
  badge (`mcp-needs-credentials-{name}`).
- c2: a remote server with status `needs_auth` renders a "Sign-in required" badge.
- c3: a fully-credentialed/connected server renders the normal connected badge (no false positive).
- c4: tapping the "Needs credentials" affordance opens the secrets dialog pre-filled with the
  server name.

**MCP-5**
- c1: `CuratedMcpAutoInstaller.ensure()` POSTs to
  `${agentLocalBaseUrl}/opencode/mcp/curated/ensure`; returns `true` on 2xx.
- c2: returns `false` (non-fatal) on server error and on thrown exception.
- c3: `shouldAutoInstallCuratedMcp(engineReady, authenticated, isCloudServer)` returns true only
  when all three hold.
- c4: `agent_server_controller` invokes `ensure()` once per distinct token (de-dupe assertion).

**MCP-6**
- c1: when a Google `integration_account` row with a valid token exists, ensuring the Google
  curated server injects the fresh access token into that server's `environment` (assert the env
  key the chosen server expects is populated).
- c2: token bridge calls the existing `ensureFresh*Account` refresh path (assert refresh invoked
  when `expires_at` is past).
- c3: when no Google/PCO account is connected, the corresponding curated server is skipped (not
  written with an empty token) and ensure does not throw.
- c4: injected token values are never returned verbatim in the route response (redaction).

**MCP-7**
- c1: `CURATED_MCP_SERVERS` contains exactly 7 entries with the IDs PCO, Google Workspace, Canva,
  Stripe, Mailchimp, Notion, PDF Tools.
- c2: Canva + Notion entries are `type:'remote'` with a non-empty `url` and no `command`.
- c3: Stripe + Mailchimp + PCO + Google Workspace + PDF Tools entries are `type:'local'` with a
  non-empty `command` argv.
- c4: each entry carries `requiredEnv: string[]` metadata (empty for PDF Tools; the OAuth/remote
  servers have `requiredEnv: []`) so MCP-4 can compute `needsCredentials`.
- c5: ensuring the full set on an empty config writes all 7 (minus any cleanly-skipped
  uncredentialed local servers per MCP-6 c3) and is idempotent on a second run.

## Validation plan

1. Each issue gets a contract (`docs/ai/contracts/<issue>.json`) via `acceptance-contract`;
   red-proven before, green after.
2. Real-shape rule: route/service tests use real SDK `mcp.status()` / config shapes captured from
   the embedded SDK (`needs_auth`/`connected`/`failed` enums, `{type,command,url,environment}`),
   never invented values. Token-bridge tests use the real `integration_accounts` row shape.
3. `ai-workflow checks --level pr` exits 0 per issue (flutter analyze, dart format, tsc --noEmit,
   vitest); full `flutter test` green.
4. At least one vitest per backend issue inspects `spy.mock.calls` for the expected SDK/config
   shape; at least one Flutter widget test exercises the real mounted surface (`McpSection`),
   matching the orphaned-widget regression guard from prior runs.
5. Secrets must never be logged or echoed in API responses (MCP-6 c4); add an assertion.
6. Manual smoke at the end: `flutter run -d macos`, open Settings → MCP, confirm the 7 servers
   appear, uncredentialed ones flagged, a Stripe/Mailchimp key entry persists, and a remote
   (Canva/Notion) first-use sign-in is reachable.

## Branch / PR strategy

- One combined run branch (already created): `workflow/run-2026-06-16-mcp-autoinstall`.
- Issues land sequentially in dependency order on that branch; single PR for the run (consistent
  with the prior OPC run's stacked-PR decision). Manual merge only.

## Out of scope (with justification)

| Item | Why excluded |
|---|---|
| Obtaining Canva/Notion OAuth client apps | Per request non-goal — remote `{type,url}` + opencode OAuth-on-first-use covers it; no committed third-party secrets. |
| Broadening Rhythm's Google/PCO OAuth scopes | Scope expansion for third-party MCP servers is a credential-policy decision (Open Question 1), not in this autoinstall scope. |
| Multi-user / shared MCP credentials | Auth model is per-user per-machine (architecture.md); no shared-credential path. |
| Replacing the broker pattern | The broker stays for Rhythm's own tools; MCP-6 adds a minimal token-read bridge alongside it, not a rewrite. |

## Estimated effort

- Backend (MCP-1, MCP-2, MCP-6, MCP-7): ~3-4 sessions (MCP-6 token bridge is the risk).
- Flutter (MCP-3, MCP-4, MCP-5): ~2-3 sessions.
- Total: ~5-7 focused sessions, smoke at the end.

## Open questions (flagged for user resolution)

1. **Google/PCO token reuse is architecturally non-trivial (BLOCKS MCP-6 final form).** Rhythm's
   stored token is scoped to *Rhythm's* OAuth client and scopes. The chosen Google/PCO MCP servers
   typically run their *own* OAuth (their own client id/secret) rather than accepting a raw bearer
   token via env. Resolution needed: (a) inject Rhythm's raw access token into an env var the
   server accepts (requires a server that supports bearer-token env injection + Rhythm's scopes
   covering the MCP's needs), OR (b) use a PCO Personal Access Token path and a separate Google
   approach, OR (c) keep MCP-6 as a thin bridge and accept first-use OAuth for Google/PCO too. The
   plan assumes (a) with (b) as PCO fallback; confirm before implementing MCP-6.
2. **Does the local agent server read the SAME SQLite store the desktop app writes its Google/PCO
   tokens to?** Verified the *capability* exists (`DB_CLIENT=sqlite`), but the runtime DB-path
   wiring between the embedded server and the desktop app's `integration_accounts` must be
   confirmed, or MCP-6 c1 cannot pass against real data.
3. **Exact npm package / remote URL for each of the 7 servers (MCP-7).** Candidates are named in
   the request (`taylorwilsdon/google_workspace_mcp`, official Canva/Notion/Stripe, a maintained
   PCO + Mailchimp server, a maintained PDF MCP) but the precise package names, versions, and
   remote OAuth URLs must be pinned and recorded in decisions.md at MCP-7 time; treat any
   unverified package as a supply-chain risk to confirm before autoinstall ships.
4. **Secret-at-rest posture.** API keys entered via MCP-3 are persisted in plaintext in
   `~/.config/opencode/opencode.json` (same as opencode's own model). Confirm this is acceptable
   for church-staff machines or whether keychain storage is required (would expand MCP-3 scope).
5. **Vague-criteria flags pinned during planning:** "surface installed-but-uncredentialed servers
   clearly" (MCP-4) was pinned to concrete badge keys + the absent-required-env / `needs_auth`
   computation; "smallest mechanism to obtain tokens" (MCP-6) was pinned to read-fresh-token →
   inject-into-environment with clean-skip. Re-confirm these concretizations at issue/PR read.
