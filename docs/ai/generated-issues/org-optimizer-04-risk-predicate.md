# org-optimizer-04: Risk-classification predicate

## Goal

Implement `classifyProposalRisk(proposal): 'low' | 'high'` — the **single source
of truth** for whether a proposal auto-applies or is human-gated. Both the auto
path and the review queue read it.

## Context

Per decision doc §2, autonomy is hybrid: low-risk reversible/narrowing changes
auto-apply behind measure/revert; privilege-granting, expanding, inbound-surface,
and external-code changes are human-gated. The predicate must be the only place
this is decided, and must **default to high (fail-closed)**.

## Likely files

- NEW `apps/api_server/src/services/org_proposal_risk.ts`
- consumed by org-optimizer-05 (auto path) and org-optimizer-10 (queue)

## Acceptance Criteria

- [ ] LOW (auto): `refine-skill`, `consolidate-skill`, `tighten-scope`,
  `prune-scope`, `refine-recipe`.
- [ ] HIGH (gate): `create-agent`, `grant-delegation`, `expand-delegation`,
  `broaden-scope`, `create-recipe`, `webhook-wiring`, `external-adoption`.
- [ ] Any unknown/unlisted `kind` → `'high'` (fail-closed).
- [ ] `external-adoption` additionally implies the `external` flag is set (extra
  vetting gate downstream); `webhook-wiring` additionally requires the security
  note downstream — the predicate exposes a helper
  `requiresSecurityNote(kind): boolean` returning true for both.
- [ ] Pure function — no DB, no IO, deterministic.
- [ ] Documented hard rules enforced: any `allowed_delegates_json` write is HIGH;
  any `agent_configs` INSERT is HIGH; any allowlist *addition* is HIGH while
  *removal* is LOW; any webhook-endpoint create is HIGH; any external adoption is
  HIGH.

## Required tests

- risk-predicate table-test: every documented kind maps to its tier; an unknown
  kind → high; `requiresSecurityNote` true only for `webhook-wiring` +
  `external-adoption`.

## Dependencies / order

Depends on org-optimizer-01 (proposal types). Required by 05–13.

## Safety notes

Fail-closed default is load-bearing — a misclassified privilege grant must never
slip onto the auto path.
