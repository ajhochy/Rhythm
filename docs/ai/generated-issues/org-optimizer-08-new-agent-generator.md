# org-optimizer-08: New-agent generator (gated)

## Goal

Generate `create-agent` proposals (HIGH, gated) for detected coverage gaps: a new
`agent_configs` row + a valid `.mcp-roles/<slug>.mcp.json` role file + scopes,
all validated against the live set and the alignment guards. Applied only on
human approval via the queue.

## Context

Per decision doc §1/§4/§7: a recurring task/session cluster with no well-fitting
profile (or repeated denied-tool implying a missing specialist) justifies a new
agent. Creating an agent is HIGH risk — never auto-applied. The apply step must
reuse `agent_profile_sync` / `opencode_agent_writer` conventions and produce a
role file that passes `smoke_mcp_alignment.sh` (names ⊆ live).

## Likely files

- NEW `apps/api_server/src/services/generators/new_agent_generator.ts`
- reuse `agent_profile_sync.ts`, `opencode_agent_writer.ts`,
  `mcp_name_alignment.ts`, `agent_configs_repository.ts`
- proposals repo; `.mcp-roles/<slug>.mcp.json` written at apply time (behind queue)

## Acceptance Criteria

- [ ] A coverage-gap signal → one `create-agent` proposal (HIGH) with
  `change_json` = proposed id/label/systemPrompt + `allowed_mcps_json` /
  `allowed_skills_json` (and optional `allowed_delegates_json`).
- [ ] Proposed scopes are validated: every MCP/skill name resolves to a live
  engine id via `mcp_name_alignment`; a proposal whose names can't resolve is not
  emitted (or is emitted flagged-invalid and cannot be approved).
- [ ] The apply step (run only on approval) creates the `agent_configs` row with
  `is_manager=0` and writes a valid `.mcp-roles/<slug>.mcp.json`
  (`{ mcpServers: { ... } }`) that passes the alignment invariant; apply is
  rejected if any name is not in the live set at apply time.
- [ ] Never auto-applied (assert: not reachable from the auto path).

## Required tests

- generator contract: gap → high-risk create-agent proposal; proposed scopes
  ⊆ live; apply produces a role file whose names round-trip through the
  per-session allowlist; apply rejected when a name is not live.

## Dependencies / order

Depends on 03, 04, and 11 (the queue runs the apply step on approval). Generator
emission can land before 11; apply wiring depends on 11.

## Safety notes

HIGH risk, gated. Created agents must satisfy the alignment guards and get a
valid role file. `is_manager` stays 0 (manager status is user-controlled, #
decouple-is_manager).
