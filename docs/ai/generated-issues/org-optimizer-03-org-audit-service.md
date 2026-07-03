# org-optimizer-03: Read-only org audit + signal collector

## Goal

Implement `org_audit_service.ts` — a **read-only** snapshot of the whole agent
org (profiles + scopes, skills, recipes, delegation graph, webhook endpoints)
plus recent activity signals, assembled into one structured digest the optimizer
agent and the generators consume. No writes.

## Context

Per decision doc §4, each proposal kind is justified by a concrete signal read
from a specific source. This service centralizes those reads so generators don't
each re-query. It also computes "detected gaps" (recurring task with no good
tool, missing capability, repeated denied-tool, unwired recurring inbound
trigger) that external-discovery and webhook-wiring tie their suggestions to.

## Likely files

- NEW `apps/api_server/src/services/org_audit_service.ts`
- reads: `agent_configs` (+ `allowed_*_json`, `is_manager`), `agent_skills`,
  `agent_cookbook`, `agent_webhook_endpoints`, `agent_sessions` (+ messages),
  `denied_tool_events` (org-optimizer-02), `claude_triggers`, live
  `GET /opencode/mcp` + `listSkills()`, `mcp_name_alignment.ts` (unresolved names)

## Acceptance Criteria

- [ ] `buildOrgAuditSnapshot(): Promise<OrgAuditSnapshot>` returns a typed digest
  with: profiles + their scopes, skills (w/ overlap candidates), recipes,
  delegation edges, webhook endpoints, recent session/task clusters, denied-tool
  aggregates, drift (allowlist names not in the live set), and a `gaps[]` list
  (each gap has a stable `gapId`, `kind`, evidence).
- [ ] The service performs **no writes** to any table (assert read-only).
- [ ] Drift detection uses `mcp_name_alignment` to flag `allowed_*` names that no
  longer resolve to a live engine id (the prune-scope signal).
- [ ] Each `gap` carries enough evidence (session ids / counts / task names) to
  populate a proposal's `signal_ref`.
- [ ] Respects the #746 cold-start window — does not call the engine before it is
  ready; degrades gracefully if the engine listing is empty (does not emit false
  "dead name" gaps when the live set is unavailable).

## Required tests

- audit-snapshot contract: snapshot shape; read-only (no DB mutations); a dead
  allowlist name produces a prune gap; an empty live set produces NO false prune
  gaps; an over-broad never-invoked tool produces a tighten gap; a repeated
  inbound pattern produces a webhook gap.

## Dependencies / order

Depends on org-optimizer-01 (proposal types may share models) and
org-optimizer-02 (denied-tool log). Required by all generators (06–13) and the
cron (14).

## Safety notes

Read-only. Must not weaken or bypass any guard. Local-only data.
