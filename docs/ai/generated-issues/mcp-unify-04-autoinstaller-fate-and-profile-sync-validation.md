# Resolve auto-installer fate; validate `agent_profile_sync` MCP defaults against live ids

**Order:** 4 · **Depends on:** #2 (provenance flag) · **Milestone:** Unify MCP source of truth

## Why

Two loose ends remain after the engine is the source of truth:

1. **Client-side auto-installers** (`curated_mcp_auto_installer.dart`,
   `rhythm_mcp_auto_installer.dart`) fire on launch and POST to the server-side
   template ensure endpoints (`/opencode/mcp/curated/ensure`,
   `/opencode/mcp/rhythm/ensure`). They are the **materialize-on-install
   trigger**, not a display source — but their role is undocumented and their
   existence reads as "another MCP source." Their fate must be decided + recorded.
2. **`agent_profile_sync`** seeds `IMPORTER_DEFAULT_ALLOWED_MCPS_JSON = '["rhythm"]'`
   and may derive MCP scope at import. Nothing validates those names against the
   live engine ids, so a default/derived name that drifts silently scopes to
   nothing (same #781 hazard as the picker had).

## What

1. **Decide + document** the auto-installer fate (see open question 1 in
   `current-plan.md`). Default recommendation: **keep**, but add a header/doc
   comment to both files stating they are the materialize-on-install trigger for
   the curated/rhythm templates, and that display/source-of-truth is the live
   engine list. If the user/orchestrator chooses "fold," refactor the trigger to
   a single server-side ensure-on-ready and delete the redundant client path.
2. **Validate MCP defaults:** make `agent_profile_sync` check that its default
   (`["rhythm"]`) and any derived MCP scope are present in the live
   `GET /opencode/mcp` id set; emit a loud warning/log (and let issue 01's test
   fail) when a name is absent, rather than persisting a dead name.

## Acceptance criteria

1. A short decision note (in the issue-03 decision doc or its own) records the
   auto-installer fate and the rationale.
2. **If keep (default):** both `*_auto_installer.dart` files carry a doc comment
   explaining they are the materialize-on-install trigger; behavior unchanged;
   `flutter analyze --no-fatal-infos` clean.
3. **If fold:** the launch-time client trigger is replaced by a single
   server-side ensure path; no duplicate ensure call; existing
   `agent_server_controller` tests updated and green.
4. `agent_profile_sync` validates the importer-default + derived MCP names
   against the live engine id set; a name not in the set is **not silently
   persisted as scope** — it is logged loudly (and caught by issue 01's
   names-alignment test).
5. **Boundary:** when the live MCP list is empty/unavailable at import, the sync
   falls back to its existing behavior (default `["rhythm"]`) without crashing.

## Likely files

- `apps/api_server/src/services/agent_profile_sync.ts` (validate default/derived
  MCP names against live ids)
- `apps/desktop_flutter/lib/app/core/agents/curated_mcp_auto_installer.dart`
- `apps/desktop_flutter/lib/app/core/agents/rhythm_mcp_auto_installer.dart`
- `apps/desktop_flutter/lib/app/core/agents/agent_server_controller.dart` (only
  if folding)
- `apps/api_server/src/**/__tests__/agent_profile_sync*.test.ts` (extend)

## Required tests

- Vitest: importer default `["rhythm"]` validated against a live-set fixture; a
  derived name absent from the live set is flagged, not silently persisted.
- Flutter: `analyze` clean; if folding, the controller test reflects the single
  ensure path.

## Data-safety / out-of-scope

- No new DB columns (`allowed_mcps_json` already exists in both engines). If any
  column is added, backfill in `postgres_bootstrap.ts`.
- Do not change the OAuth flow or #765 enforcement.
- Persisted **user** `allowed_mcps_json` rows are not rewritten here — that is
  issue 05's reconciliation policy.

## Verification

- `cd apps/api_server && npx vitest run agent_profile_sync`.
- `cd apps/desktop_flutter && flutter analyze --no-fatal-infos && flutter test`.
