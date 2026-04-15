# Rhythm MCP Server

Rhythm MCP Server lets you manage tasks, projects, rhythms, messages, and facilities in Rhythm directly from Claude.

## Prerequisites

- Node.js 18 or later
- A Rhythm account at [api.vcrc.com](https://api.vcrc.com)
- Claude Desktop, Claude Code, or any MCP-compatible client

## Get your API token

Open Rhythm → **Settings → Claude Integration** and copy your session token.

Alternatively, obtain one via the API:

```bash
curl -X POST https://api.vcrc.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "yourpassword"}'
# Response: { "sessionToken": "abc123...", "user": { ... } }
```

Copy the `sessionToken` value.

## Claude Desktop setup

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "rhythm": {
      "command": "npx",
      "args": ["-y", "@rhythm/mcp-server"],
      "env": {
        "RHYTHM_API_URL": "https://api.vcrc.com",
        "RHYTHM_API_TOKEN": "paste-your-session-token-here"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

## Claude Code setup

Add to `~/.claude/settings.json` (global) or `.claude/settings.json` (per-project):

```json
{
  "mcpServers": {
    "rhythm": {
      "command": "npx",
      "args": ["-y", "@rhythm/mcp-server"],
      "env": {
        "RHYTHM_API_URL": "https://api.vcrc.com",
        "RHYTHM_API_TOKEN": "paste-your-session-token-here"
      }
    }
  }
}
```

## Verify it's working

In Claude, ask: *"Call rhythm_ping to check the connection."*

Expected response: Rhythm API status and the email address your token authenticates as.

## Available tools

| Tool | Description |
|------|-------------|
| `rhythm_ping` | Verify connectivity and confirm your token is valid |
| `rhythm_get_dashboard` | Summary snapshot of tasks, projects, rhythms, and threads — start here |
| `rhythm_list_tasks` | List tasks with optional status/date/search filters |
| `rhythm_create_task` | Create a task |
| `rhythm_update_task` | Update task fields (title, notes, due date, status) |
| `rhythm_complete_task` | Mark a task as done |
| `rhythm_delete_task` | Permanently delete a task |
| `rhythm_list_rhythms` | List recurring rules |
| `rhythm_create_rhythm` | Create a recurring rule |
| `rhythm_update_rhythm` | Update or enable/disable a rhythm |
| `rhythm_delete_rhythm` | Delete a rhythm |
| `rhythm_list_project_templates` | List project templates |
| `rhythm_create_project_template` | Create a project template |
| `rhythm_add_project_step` | Add a step to a template |
| `rhythm_create_project_instance` | Instantiate a template as an active project |
| `rhythm_list_project_instances` | List active projects with step progress |
| `rhythm_update_project_step` | Mark a project step done or add notes |
| `rhythm_list_message_threads` | List message threads |
| `rhythm_create_message_thread` | Create a message thread |
| `rhythm_send_message` | Send a message to a thread |
| `rhythm_list_facilities` | List facilities |
| `rhythm_create_reservation` | Reserve a facility for a time window |

## Troubleshooting

**`RHYTHM_API_TOKEN environment variable is not set`** — The token is missing from your MCP config. Double-check the `env` block in your settings file.

**401 errors** — Token expired or invalid. Re-fetch a token from Rhythm Settings or re-run the login curl command.

**Can't reach API** — Confirm `RHYTHM_API_URL` is set to `https://api.vcrc.com`.

**`npx` fails** — Ensure Node.js 18+ is installed: `node --version`.
