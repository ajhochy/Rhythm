# MCP-4: Surface installed-but-uncredentialed servers

## Summary

Enhance `McpSection` to display a distinct "Needs credentials" / "Sign-in required" badge for curated servers whose required environment keys are absent (key-based servers) or whose status is `needs_auth` (remote OAuth servers). Include an affordance to add a key without full re-add.

## Goal

- `McpSection` shows a distinct "Needs credentials" badge for curated key-based servers with absent required env keys
- Remote servers with status `needs_auth` show a "Sign-in required" badge
- Fully-credentialed servers render the normal connected badge (no false positive)
- Tapping the badge affordance opens the secrets dialog pre-filled with the server name

## Likely Files

- `apps/desktop_flutter/lib/features/settings/widgets/mcp_section.dart`
- `apps/desktop_flutter/lib/features/settings/data/mcp_data_source.dart`
- `apps/desktop_flutter/lib/features/settings/controllers/mcp_controller.dart`

## Test Files

- `apps/desktop_flutter/test/features/settings/widgets/f2_mcp_status_test.dart` (extend existing)

## Dependencies

- **MCP-1** (environment keys exposed in API response)
- **MCP-3** (secrets editor in place)

---

## Acceptance Criteria

### c1: "Needs credentials" badge for key-based servers
- A curated key-based server (e.g., Stripe) whose required env keys are absent:
  - Renders a "Needs credentials" badge with widget key `mcp-needs-credentials-{name}`
  - Badge is visually distinct (e.g., orange/warning color)
  - Is not hidden or false-positive for already-credentialed servers

### c2: "Sign-in required" badge for remote servers
- A remote server (e.g., Canva, Notion) with status `needs_auth`:
  - Renders a "Sign-in required" badge
  - Is distinct from the "Needs credentials" badge
  - Matches the SDK `needs_auth` enum value

### c3: Normal badge for connected servers
- A fully-credentialed/connected server:
  - Renders the normal connected badge (checkmark, green, etc.)
  - No false "Needs credentials" badge
  - No regression on existing status displays

### c4: Affordance to add key
- Tapping the "Needs credentials" badge opens the Add/Edit secrets dialog
- Dialog is pre-filled with the server name
- User can add the missing key/value pairs
- Dialog flow matches the existing Add-MCP flow
