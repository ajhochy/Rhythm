# P4-2 — Manager delegation implementation epic

**Labels:** `epic`, `api-server`, `agent-profiles`, `p4`
**Design authority:** `docs/ai/decisions/2026-06-24-manager-delegation.md`
**Status:** unblocked — P1a `resolveProfileScope` has landed

## Context / Background

Manager profiles (`is_manager = 1`) should be able to invoke specialist Rhythm
agent profiles as scoped sub-runs. Each delegate run must be re-scoped to the
TARGET profile via `resolveProfileScope`; the manager's MCP/skill scope must
not bleed into the specialist.

## Sub-Issues

- **D1:** `agent_configs.allowed_delegates_json` schema + repository/model field.
- **D2:** `resolveProfileScope`-backed scoped sub-run runner.
- **D3:** `rhythm_delegate` MCP/agent tool exposed only to manager profiles.
- **D4:** authorization, depth, cycle guards, and tests.
- **D5:** importer/config + UI surface for `is_manager` and `allowed_delegates_json`.

See individual issue files:
- `docs/ai/generated-issues/D1-manager-delegation-schema.md`
- `docs/ai/generated-issues/D2-manager-delegation-subrun.md`
- `docs/ai/generated-issues/D3-manager-delegation-tool.md`
- `docs/ai/generated-issues/D4-manager-delegation-auth-guards.md`
- `docs/ai/generated-issues/D5-manager-delegation-importer-ui.md`

## Acceptance Criteria

- [ ] All D1–D5 issue files exist and cite the design note.
- [ ] Implementation follows D1 → D2 → D3/D4 → D5 dependency order.
- [ ] Delegation is fail-closed for unknown/non-allowed targets.
- [ ] Delegated runs are scoped to the target profile, not the manager.
- [ ] Automated coverage proves manager allowed, manager denied, non-manager denied, self-delegation denied, and recursion/depth denied.
