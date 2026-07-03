# org-optimizer-09: Delegation generator (gated)

## Goal

Generate `grant-delegation` / `expand-delegation` proposals (HIGH, gated):
proposed edits to a manager's `allowed_delegates_json`. Applied only on human
approval.

## Context

Per decision doc §2/§7 and the manager-delegation decision: delegation is
authorized by `is_manager` + `allowed_delegates_json`, depth-capped at 2, no
self-delegation. The optimizer may notice a manager repeatedly doing work a
specialist already covers, or failing/abandoning a sub-task it could delegate, and
propose granting the edge. Any `allowed_delegates_json` write is HIGH — never
auto-applied.

## Likely files

- NEW `apps/api_server/src/services/generators/delegation_generator.ts`
- reuse `agent_delegation_service.ts` (auth rules + depth cap),
  `agent_configs_repository.ts` (`allowedDelegatesJson`)
- proposals repo

## Acceptance Criteria

- [ ] A signal (manager redoing specialist work / abandoned delegable sub-task) →
  one `grant-delegation` or `expand-delegation` proposal (HIGH) with `target_ref`
  = the manager config, `change_json` = the target id(s) to add.
- [ ] Proposal targets only existing, enabled, `isAgent` configs; never the
  manager itself (no self-delegation); never proposes an edge that would exceed
  the depth cap.
- [ ] Only managers (`is_manager=1`) are valid `target_ref`s; a non-manager never
  gets a delegation proposal.
- [ ] Never auto-applied; apply (on approval) edits `allowed_delegates_json` via
  the repo and re-validates the auth rules at apply time.

## Required tests

- generator contract: valid manager + covered-specialist signal → high-risk grant
  proposal; never self; respects depth cap; non-manager target → no proposal;
  proposal not reachable from the auto path.

## Dependencies / order

Depends on 03, 04, 11 (apply on approval).

## Safety notes

HIGH risk, gated. Never auto-grant or auto-expand delegation. Re-validate auth +
depth at apply time, not just at proposal time.
