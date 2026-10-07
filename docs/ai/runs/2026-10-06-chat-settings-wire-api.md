---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-mobile-canonical-backend-20261006
pr: none
issues: []
status: source-complete-unverified-composed
tags: [run, rhythm]
---

# Chat-settings wire v1 alignment — API only (source)

Authority: `docs/ai/plans/2026-10-06-chat-settings-wire-contract.md` (sha `eb0a8068…d1add4`), `…-wire-fixtures.json` (sha `46e9af5d…fa2a9b`) and the Astra wire review, read in full, plus `../chat-settings-wire-api-preparation.json`. This supersedes the previous turn's inferred local-id fallback on the **no-selector** PATCH. No commit; no live operation; no web/mobile/fork/OpencodeClient/bridge/memory/auth/MCP/router/Dayflow edit; signed goal repair and automatic Dayflow C2 untouched.

## Files (pre/post sha256 in `2026-10-06-chat-settings-wire-api.sha256`)

Production (four of the five allowed; `coordinator_conversation_service.ts` and `server.ts` needed no change this turn and are byte-identical): `routes/mobile_gateway_routes.ts`, `services/mobile_profile_catalog.ts`, `services/mobile_session_state_scope.ts`. Test: `__tests__/mobile_coordinator_settings_scope.test.ts` rewritten to the wire (the parity dispatch test is unchanged and still passes).

## Behavior

- `GET` and `PATCH /mobile-gateway/sessions/:id/state` accept `?identity=local-primary|sdk`. A present value that is not exactly one of the two (including empty, other case, comma list, repeated key) is 400 before any lookup. **Absent selector → the legacy SDK-keyed full-profile PATCH, restored to its previous behavior** (no local-id lookup, no Fast write; its response now also carries `fastMode`, which the shared safe type requires).
- `local-primary`: `:id` must be the exact local session id; `findById` + the server's read-only designated-primary read (`findPrimaryOwnerRoot`, never a create/resolve call) + strict `canUpdateMobileLocalPrimaryState` (exact owner, exact nonblank project equal to the request project, nonarchived nonchild nonsystem chat) + current nonarchived project row + eligible selected profile (enabled, agent, unlocked, executable). No SDK is created or required. `sdk`: `findBySdkSessionId` with the existing owner/project admission and an exact SDK-id echo. Anything else → 404; no cross-identity or generic-key fallback.
- Explicit PATCH (`parseMobileSettingsPatch`): body must be an object with a nonempty subset of `modelMode/providerId/modelId/thinkingBudget/fastMode`. Fixed = mode + nonempty provider and model; Auto = mode only (stored tuple untouched, `router_decided_at` cleared by the existing repository rule); tuple without a mode, tuple with Auto, partial tuple, blank strings, unknown/profile/permission/agent fields, non-integer/negative budget, non-boolean Fast, empty/array body → 400. Only present fields are written, so omitted reasoning (e.g. 2048) and Fast (true) are preserved exactly; explicit `false` and `0` are honored. No profile defaults, no tier inference.
- Fixed models pass an awaited `authorizeSessionModel` (router dependency; default = the provider is in `opencodeClient.listAuthedProviders()`, the same authority ordinary routing records as `routeAuthed`); refusal is 403 with nothing written. After the await the target is re-resolved and must be the same row, project, profile, agent and SDK id before one `updateFields`; otherwise 404. The written row is read back by its proven local id and serialized — the PATCH response is the readback.
- Responses (`safeMobileSettingsState`): existing safe state plus `settingsContractVersion:1`, `settingsIdentity`, `sdkSessionId` (nullable) and `fastMode`.
- The GET layer is registered after the PATCH layer so existing harnesses that locate the first layer for this path still get the legacy PATCH handler.

## Commands and results (repo root)

- **Red first** — `npm --prefix apps/api_server test -- --run src/__tests__/mobile_coordinator_settings_scope.test.ts` against the previous route (no selector support): 35 failed / 1 passed (the legacy ordinary PATCH positive).
- **Green** — same command → **36/36** (frozen-fixture response key set, GET both selectors, inert primary with no new session/SDK, fixed/Auto/reasoning/Fast edits with exact preservation, readback equals a fresh GET, every frozen negative body ×2 identities, unknown selectors, authorization refusal, selector separation incl. generic view keys and no no-selector local-id access, wrong owner/project, 10 request-time stale states, 12 post-await replacements (incl. SDK replacement), legacy positive).
- Affected set → `mobile_routing_scope`, `issue_1286_projectless_profile_state`, `coordinator_chat_controls_parity`, `mobile_coordinator_settings_scope` → **93/93** (the first run of this set failed 2 legacy harness tests because the new GET layer was found first; fixed by registration order above).
- `npm --prefix apps/api_server run build` → pass; `git diff --check` → clean.
- Protected pins from the preparation file (everything not owned this turn, including the signed-goal controller/test and run record, the frozen wire docs, and the service/server/parity-test bytes) re-verified with `shasum -a 256 -c` → no mismatch. Not run: the 342 group, closed baselines, other suites.

## Honest limits

- Source/synthetic handler tests only (real route layer handlers, real SQLite and repositories; the model authorizer is injected in tests and defaults to provider-authed in production). Not proven: installed app, composed server, real provider/model catalog membership of a specific model id, the b70 client, device behavior, or the actual next-request model/reasoning/tier (that stays with the earlier dispatch proof and builder's served-model check).
- Model authorization checks the provider only (the existing ordinary routing authority), not per-model entitlement; a stricter per-model catalog would be a further bounded decision.
- Unauthorized model is 403 (not specified by the wire); stale/replaced targets are 404 as specified.
- `server.ts` still cannot be imported by tests; this turn does not change it.
- GitNexus unavailable; manual caller review: the new handlers are used only by the two registered layers; `canUpdateMobileLocalPrimaryState`/`safeMobileSessionProfileState` callers unchanged apart from the added `fastMode` field.
