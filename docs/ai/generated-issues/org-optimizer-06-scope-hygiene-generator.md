# org-optimizer-06: Scope-hygiene generator

## Goal

Generate `tighten-scope`, `prune-scope`, and `consolidate-skill` proposals from
the audit snapshot — the lowest-risk, mostly-mechanical generators that prove the
auto path end-to-end.

## Context

Per decision doc §4: over-broad scopes (granted tool/server never invoked) →
`tighten-scope`; dead/drifted allowlist names (no live engine id, flagged by
`mcp_name_alignment`) → `prune-scope`; high-overlap skills → `consolidate-skill`.
All three are LOW risk (reversible/narrowing) per the predicate.

## Likely files

- NEW `apps/api_server/src/services/generators/scope_hygiene_generator.ts`
- reads the `OrgAuditSnapshot`; uses `mcp_name_alignment.ts` results and
  `skill_refiner` overlap matching; writes proposals via the repo
- `apps/api_server/src/repositories/agent_org_proposals_repository.ts`

## Acceptance Criteria

- [ ] A dead/unresolved allowlist name → one `prune-scope` proposal with
  `target_ref` = the profile + the name, `change_json` = remove that name,
  `signal_ref` citing the drift gap.
- [ ] A granted tool/server with zero invocations in the trailing window → one
  `tighten-scope` proposal removing it.
- [ ] Two+ skills above the overlap threshold → one `consolidate-skill` proposal
  referencing both skill ids.
- [ ] A tool/server that WAS exercised is never proposed for removal.
- [ ] A USER-authored scope entry is not proposed for change without flagging it
  for the gate (do not silently auto-prune user-edited overlays).
- [ ] All emitted proposals are LOW risk (assert via `classifyProposalRisk`) and
  carry a `dedup_key`; duplicates against the seen-set are skipped.

## Required tests

- generator contract: dead name → prune; never-invoked tool → tighten; overlapping
  skills → consolidate; exercised tool NOT pruned; user-authored entry not
  auto-pruned; emitted kinds are all low-risk.

## Dependencies / order

Depends on 03 (audit), 04 (predicate), 05 (auto path). With 05, this is the
cheapest end-to-end proof.

## Safety notes

Narrowing only. Never broadens. User overlays (#785) are immutable input unless
gated.
