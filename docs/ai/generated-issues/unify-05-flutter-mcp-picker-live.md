# Flutter: MCP picker reads live (de-hardcode `_kAvailableMcps`)

**Order:** 5 · **Depends on:** #4 (same file — sequence after) · **Milestone:** Unify skills source of truth

## Why

`_kAvailableMcps` (`_agent_profile_sheet.dart:16`) is the second hardcoded list. The fork
already exposes its configured MCP servers and api_server proxies them (`opencode_mcp_routes`
/ `GET /opencode/mcp`). The MCP picker should list the live servers so stored `allowed_mcps`
names match what the engine can enforce (same drift hazard as skills).

## What

Source the MCP picker from the live MCP list instead of the hardcoded array, reusing/extending
the existing opencode MCP data source/route.

## Acceptance criteria

1. The MCP picker in the Agent Profile sheet renders from the live MCP list
   (`GET /opencode/mcp`); no hardcoded MCP-name array (`_kAvailableMcps`) remains.
2. Selecting MCPs persists `allowed_mcps` with names that exist in the live set.
3. **Boundary:** when the live MCP list is empty/unavailable, the picker shows an empty/“no
   servers” state rather than crashing or falling back to a stale hardcoded list.
4. Changing the production Server URL in Settings does not affect the MCP picker.

## Likely files

- `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart`
- `apps/desktop_flutter/lib/features/agents/data/*` (reuse/extend the MCP data source)
- `apps/desktop_flutter/test/features/agents/*` (extend test)

## Required tests

- Widget test: MCP picker renders live server names; empty-state path covered.
  `dart format .` + `flutter analyze --no-fatal-infos` clean.

## Data-safety / out-of-scope

- Read-only listing; no MCP server management here.

## Verification

- `flutter analyze --no-fatal-infos`; `flutter test`.
