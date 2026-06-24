# P4-2 — Manager delegation: file implementation sub-issues (epic tracker)

**Labels:** `epic`, `api-server`, `agent-profiles`, `p4`, `deferred`
**Depends on:** P4-1 (design note must exist before implementation sub-issues are written)

## Context / Background

This is an **epic tracker issue** — its deliverable is the set of scoped implementation issues for the manager-delegation feature. No code lands here. All sub-issues are explicitly deferred until P0–P3 are complete and the design note from P4-1 is reviewed.

The delegation feature: manager profiles (`is_manager = 1`) can invoke a target agent profile as a re-scoped sub-run via a delegation tool, gated by an `allowed_delegates_json` allowlist and a re-entry guard. The sub-run is scoped by `resolveProfileScope` (P1a).

## Sub-Issues To File

When this issue is worked, create individual issue files (or GitHub issues) for each item below. Each sub-issue should include likely files, acceptance criteria, and required tests per the standard issue template.

### D1 — `allowed_delegates_json` column migration
- Add `allowed_delegates_json TEXT` column to `agent_configs` in `migrations.ts` (guarded `ALTER TABLE`).
- Add corresponding column to `postgres_bootstrap.ts` (dual-DB parity).
- Add `allowedDelegatesJson` field to the `AgentConfig` TS interface in `agent_configs_repository.ts`.
- Add column-parity assertion to the existing column-parity test.
- **No behavior change** — column added, nothing reads it yet.

### D2 — Delegation dispatch function
- Add `delegateTo(targetAgentConfigId: string, prompt: string, callerSessionId: string): Promise<string>` in a new `agent_delegation_service.ts`.
- Calls `resolveProfileScope(targetAgentConfigId)` for an independent scope.
- Rejects if caller session's `agentConfigId` maps to a profile where `is_manager = 0` (unauthorized).
- Rejects if `targetAgentConfigId` is not in caller profile's `allowedDelegatesJson` (fail-closed).
- Re-entry guard: rejects if `callerSessionId` is itself a delegation sub-run (no recursive delegation).
- Returns delegate output string.

### D3 — Delegation tool registration for manager sessions
- Register the delegation tool (MCP or built-in dispatch) only for sessions whose resolved profile has `is_manager = 1`.
- Wires `delegateTo` from D2 as the tool handler.
- The tool must NOT appear in non-manager session tool lists.
- Acceptance: a session for a non-manager profile cannot call the delegation tool.

### D4 — `is_manager` flag activation + manager profile seeding
- Set `is_manager = 1` on at least one profile in the importer (`agent_profile_sync.ts`) to designate `workflow-orchestrator` (or another designated manager) as the default manager profile.
- Ensure the column is preserved across re-syncs (not reset to 0 on re-import).
- Update `GET /agent-configs` response to include `isManager` in the returned DTO.

### D5 — Authorization test suite
- New `src/__tests__/agent_delegation_auth.test.ts` covering: manager can delegate to allowed target; non-manager cannot delegate; manager cannot delegate to unlisted target; recursive delegation is rejected.

## Acceptance Criteria

- [ ] This issue file (`P4-2-manager-delegation-issues.md`) exists with the above sub-issue list.
- [ ] The five sub-issues (D1–D5) are filed as individual issue files under `docs/ai/generated-issues/` (or as GitHub issues when the user is ready to implement).
- [ ] Each sub-issue cites the P4-1 design note as its design authority.
- [ ] Each sub-issue is explicitly marked `deferred` in its Labels field until P0–P3 are merged.
- [ ] No code changes in `apps/api_server/src/`. No database changes. No Flutter changes in this issue.

## Required Tests

None in this issue. Tests are specified per sub-issue (D1–D5 above).

## Dependencies

- **P4-1 must be reviewed and merged** before sub-issues are filed — the design note is the authority for implementation details.
- **P1a must be merged** before D2 is implemented (D2 calls `resolveProfileScope`).
- D1 → D2 → D3 → D4 (in dependency order within the epic).
- D5 can be written alongside D2.

## Safety Notes

- All sub-issues must include the fail-closed semantics: unknown delegate target = reject, not fall-through to unscoped run.
- `allowed_delegates_json` column follows the same pattern as `allowed_mcps_json` — null means "no delegation allowed" for manager profiles (managers must opt in explicitly).
- No sub-issue may activate `is_manager` enforcement in the interactive or scheduled run paths until D3 is complete (gate is the tool registration, not a pre-flight check in the runner).
