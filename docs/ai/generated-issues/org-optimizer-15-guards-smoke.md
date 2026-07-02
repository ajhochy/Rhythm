# org-optimizer-15: Guards / smoke

## Goal

Lock the safety invariants with a smoke check: the low-risk auto path is
reversible, every high-risk kind stays gated, created agents pass names ⊆ live,
and external-adoption / webhook-wiring require their note before approval.

## Context

Per decision doc §8. Extend the existing alignment smoke or add a dedicated
`smoke_org_optimizer.sh`. These are verifiable (no manual click-through) and run
against the built binary in CI.

## Likely files

- `tools/release/smoke_mcp_alignment.sh` (extend) or NEW
  `tools/release/smoke_org_optimizer.sh`
- CI wiring (the workflow that runs the alignment smoke)

## Acceptance Criteria

- [ ] Smoke asserts the auto path reverts: a forced regression on a low-risk
  proposal restores `before_snapshot_json` and sets `status='reverted'`.
- [ ] Smoke asserts gate invariants: no `create-agent`, `grant-delegation`,
  `expand-delegation`, `broaden-scope`, `webhook-wiring`, or `external-adoption`
  proposal is ever auto-applied (all remain `proposed` until approved).
- [ ] Smoke asserts a created agent's role file names ⊆ live (reuses the existing
  alignment invariant).
- [ ] Smoke asserts `external-adoption` and `webhook-wiring` cannot be approved
  without their required note.
- [ ] Runs in CI against the built binary; non-zero exit on any violation.

## Required tests

- the smoke script itself is the test; plus a fail-injection case proving the
  smoke catches an auto-applied high-risk proposal (guard regression detection).

## Dependencies / order

Depends on 05–14. Final issue.

## Safety notes

This is the regression guard for the whole epic's safety model — it must fail
loudly if any high-risk kind ever reaches auto-apply or if the alignment invariant
breaks.
