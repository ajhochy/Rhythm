---
date: 2026-07-30
repo: rhythm
status: contract
tags: [contract, rhythm, desktop, agent-profile, transcript]
---

# R5 desktop picker catalog and transcript windows

## Caller inventory

- The only shipping desktop caller of `GET /agent-sessions/agents` is
  `AgentsDataSource.fetchAvailableAgents`, consumed through
  `AgentsRepository` / `AgentsController` by the fallback agent selector. It
  now requests `view=picker`.
- Agent Designer and profile/configuration surfaces do **not** consume that
  endpoint. They use `AgentConfigsDataSource` and `/agent-configs`; create,
  update, security-lock, re-enable, and delete paths already project the
  affected profile explicitly. Bulk engine reconciliation remains available
  through `/agent-configs/sync-opencode` as well as the new picker-adjacent
  refresh path.
- Backend route, security, and live-diagnostic tests inspect raw engine fields
  such as `permission`, `mode`, or `prompt`. The legacy no-param response and
  explicit `?full=1` retain that full engine shape.

## Desktop picker DTO

The shipping desktop requests:

`GET /agent-sessions/agents?view=picker&cwd=<directory>`

The response is an explicit allowlist:

```json
{
  "agents": [
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
      },
      "profileAvailability": "available",
      "builtIn": false
    }
  ]
}
```

Vocabulary is aligned with
`msp-001-safe-profile-catalog.md`: `profileId` is the Rhythm
`agent_configs.id`; `opencodeAgentId` is the engine execution name; `name` is
the human-facing label; and `defaults` and `display` have the same field names
and null semantics. `profileAvailability` reuses MSP-001 session-state values:
`available`, `unassigned`, or `unavailable`. Engine-only entries have
`profileId: null` and `profileAvailability: "unassigned"`.

No system prompt, skill/MCP configuration, delegate rules, permission JSON,
environment values, account identifiers, tokens, or credentials may appear.
For the observed 39-agent case the UTF-8 JSON response budget is **32 KiB**.

Compatibility is param-gated: older desktop clients may continue using the
legacy no-param response during rollout, and raw inventory/diagnostic callers
must request `?full=1`. No GET variant performs reconciliation. Explicit
projection refresh is `POST /agent-sessions/agents/refresh`.

## Transcript pagination

The new desktop detail request uses:

`GET /agent-sessions/:id?transcriptLimit=50`

It receives the session plus the most recent messages in chronological display
order and a `transcriptPage` object. Older clients that omit
`transcriptLimit` retain the existing response behavior.

Older pages use:

`GET /agent-sessions/:id/messages?limit=50&before=<cursor>`

The cursor is the first message's stable numeric row id from the current
window. `before` is exclusive. Each response keeps messages in chronological
display order:

```json
{
  "messages": [],
  "pageInfo": {
    "nextCursor": "123",
    "hasMore": true
  }
}
```

Flutter merges older rows by stable SDK-message id (falling back to the DB row
id), sorts the combined cache chronologically, and never replaces messages or
parts already received from the WebSocket stream. Selection and resume keep
using the same controller cache and subscription path.

Session-detail JSON at or above the documented large-response threshold is
decoded with a background Flutter isolate; smaller responses stay inline to
avoid isolate startup overhead.
