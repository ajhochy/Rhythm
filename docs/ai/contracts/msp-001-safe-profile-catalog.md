---
date: 2026-07-30
repo: rhythm
status: implemented
tags: [contract, rhythm, mobile, agent-profile]
---

# MSP-001 safe mobile profile catalog

`GET /mobile-gateway/profile-catalog` is the only paired-mobile profile picker
source. It requires both `Device` authentication and a valid
`X-Rhythm-Project-ID`. Authorization fails closed before the catalog handler.

The response is:

```json
{
  "profiles": [
    {
      "profileId": "rhythm-agent-config-id",
      "opencodeAgentId": "engine-agent-name",
      "name": "Display name",
      "defaults": {
        "providerId": "anthropic",
        "modelId": "claude-sonnet-4-5",
        "reasoningEffort": "high",
        "approvalMode": "default"
      },
      "display": {
        "icon": "terminal",
        "color": null
      }
    }
  ]
}
```

Both IDs are required and distinct:

- `profileId` is `agent_configs.id` and is the value submitted to Rhythm when
  selecting a profile.
- `opencodeAgentId` is the OpenCode engine `agent` name. Clients display it
  only as execution metadata and must not use it as a profile lookup key.

Only enabled, unlocked, `sessionSelectable` profiles with a non-empty
`ocAgent` are returned. The projection is an explicit allowlist. It must never
include system prompts, skills or MCP contents, delegate rules, permission
configuration, environment values, account identifiers, tokens, or
credentials.

The paired session response extension is:

```json
{
  "rhythm": {
    "localSessionId": "local-agent-session-id",
    "profileId": "rhythm-agent-config-id",
    "opencodeAgentId": "engine-agent-name",
    "profileAvailability": "available",
    "providerId": "anthropic",
    "modelId": "claude-sonnet-4-5",
    "thinkingBudget": 8192,
    "permissionMode": "plan"
  }
}
```

`profileAvailability` is `available`, `unassigned`, or `unavailable`.
Ambiguous and unknown legacy engine-agent mappings have `profileId: null` and
must render as **Unassigned**, never as the first catalog item.

`PATCH /mobile-gateway/sessions/:sdkSessionId/state` accepts the complete
session state. The server resolves `opencodeAgentId` from `profileId` and
rejects a mismatched engine ID. The session row is authoritative after the
response; mobile globals are defaults for creating a new session only.

R5 should consume the catalog item above as its minimal picker DTO without
fetching the broader agent-config payload.
