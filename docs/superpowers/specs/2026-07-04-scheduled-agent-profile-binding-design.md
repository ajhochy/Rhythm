# Scheduled Agent Profile Binding Design

## Scope

Fix two Rhythm-owned projection paths without changing the separate
`agent-stack` repository:

1. Let `rhythm_create_scheduled_task` accept and forward `agentConfigId`.
2. Make Rhythm's generated `workflow-orchestrator.md` internally consistent:
   it must not delegate coding work to itself, and it must grant `write`.

## Findings

- `agent_scheduled_tasks.agent_config_id`, SQLite/Postgres migrations, the
  repository model, REST create/list routes, and scheduler dispatch already
  support `agentConfigId`.
- The MCP create-tool schema omits `agentConfigId`, so MCP clients cannot send
  the binding.
- `buildHubRoutingPreamble()` always emits the Secretary-style coding handoff
  to `workflow-orchestrator`, even when the file being generated is itself
  `workflow-orchestrator.md`.
- Rhythm currently preserves existing permission frontmatter. For its own
  workflow-orchestrator projection, it will independently ensure
  `permission.write: allow`; no `agent-stack` file will be edited.

## Design

Add `agentConfigId` as an optional string in the MCP tool schema. The REST API
will continue deriving `agentKind` from `agentConfigId` when no explicit kind
is supplied, preserving existing generic `opencode` behavior when both are
absent.

Make manager-preamble generation aware of the profile id. Hub managers other
than `workflow-orchestrator` retain the existing Secretary-style coding
handoff. The workflow orchestrator instead receives instructions to own
workflow coordination and dispatch implementation to `coding-agent`.

During agent-file projection, normalize only the workflow-orchestrator's
frontmatter by inserting or replacing the nested `permission.write` entry with
`allow`. All other profiles and unmanaged frontmatter remain unchanged.

## Verification

- MCP tool schema exposes and forwards `agentConfigId`.
- REST create/list round-trips `AI-Trend-Researcher`.
- Scheduler dispatch passes both `agentKind` and `agentConfigId` as
  `AI-Trend-Researcher`.
- A task without `agentConfigId` retains generic `opencode` behavior.
- A projected workflow-orchestrator file contains `write: allow`, mentions
  `coding-agent`, and contains no self-delegation instruction.
