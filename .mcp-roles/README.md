# `.mcp-roles/` — Per-agent MCP scope profiles

Each JSON file in this directory defines an **MCP role** — a named subset of MCP servers
and tool allowlists that constrains what a scheduled or webhook-triggered agent may do.

## How it works

When a `agent_scheduled_tasks` row has a non-null `allowed_mcps_json`, the scheduler
includes that list in the `pending_claude_triggers` row it inserts. The agent runtime
(via `rhythm_list_pending_triggers`) surfaces `allowedMcps` and `allowedSkills` to the
agent process so it can filter its tool list.

The `.mcp-roles/*.mcp.json` files provide **human-readable definitions** of each role
for operators who want to understand or extend the scoping. The files are not loaded
automatically at runtime — they are documentation + a config template for the
`allowed_mcps_json` values stored in `agent_scheduled_tasks`.

## Defined roles

| Role | File | Purpose |
|------|------|---------|
| `daily-briefing` | `daily-briefing.mcp.json` | Morning PCO scan + task triage |
| `church-admin` | `church-admin.mcp.json` | Full PCO + Rhythm write access |
| `ffb` | `ffb.mcp.json` | Fantasy football — NFL MCP only |
| `dev` | `dev.mcp.json` | Development — all Rhythm tools |
| `org-optimizer` | `org-optimizer.mcp.json` | Org Self-Optimizer (#830) — read-audit + write-proposals only; no config/delegation/webhook write tools |
| `org-external-discovery` | `org-external-discovery.mcp.json` | Org Self-Optimizer's weekly external-discovery pass (#830) — mcp-registry + deep-research only, queue-only external-adoption proposals |

## Adding a new role

1. Create `<role-name>.mcp.json` with the schema above.
2. When creating a scheduled task, set `allowedMcps` to the list of MCP server names
   from the role's `mcpServers` keys.

## Manager roles: `isManager` + `allowedDelegates` (#883)

A role file may declare `"isManager": true` plus an `"allowedDelegates"` array
(a list of `agent_configs.id` values — the opencode agent-name slug, e.g.
`"theologian"`, not a raw UUID) to describe the delegation roster a manager
profile is entitled to invoke via the `rhythm_delegate` MCP tool
(`agent_delegation_service.ts` authorizes on `caller.isManager` +
`target ∈ allowedDelegatesJson`).

These two fields are **not** loaded by `resolveMcpRole()` at session-create
time (that path only reads `mcpServers`/`disabledMcpServers`) — they are
reconciled into `agent_configs.is_manager` / `agent_configs.allowed_delegates_json`
by the boot-time seed in `apps/api_server/src/services/secretary_delegation_seed.ts`
(mirrors the read-only role-file pattern in `ministry_recipes_seed.ts`). The
seed only **backfills a still-unset column** — `is_manager` still `false` /
`allowed_delegates_json` still `null` — so a value a human already set via the
Agent Profiles designer is never clobbered on a later boot. This makes the
manager/roster configuration reproducible from a clean database without
manual SQL or UI edits, while preserving live user edits.

## Security notes

- Roles do **not** grant additional access beyond what the agent's session token allows.
- The `disabledMcpServers` list in each file is advisory — enforcement happens at the
  scheduler/trigger layer where `allowed_mcps_json` is set.
- Never put API keys directly in these files. Use `${ENV_VAR}` references.
