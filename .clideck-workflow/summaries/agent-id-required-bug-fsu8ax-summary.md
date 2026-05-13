# Agent Id Required Bug

## Description

Bug in CLI integration in Rhythm: whenever an agent was launched, it threw `agentId is required` for all agent types. The Flutter `createSession` POST body was sending `agent_id` (snake_case) but the api_server controller (`AgentSessionsController.create`) reads `body.agentId` (camelCase), causing validation to fail.

## Issues

| # | Title | Commit |
|---|-------|--------|
| [#544](https://github.com/ajhochy/Rhythm/issues/544) | Fix agent_id payload key in Flutter createSession | `75983a0` |

**Fix:** In `apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart` line 153, changed `'agent_id': agentId,` → `'agentId': agentId,`.

## Manual Setup Needed

None. This is a pure code fix with no infrastructure, secrets, or environment variable changes required.
