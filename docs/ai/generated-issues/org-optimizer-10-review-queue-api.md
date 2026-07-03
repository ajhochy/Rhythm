# org-optimizer-10: Human-gate review queue (API)

## Goal

REST endpoints to list, approve, and reject human-gated proposals. Approve runs
the matching generator's server-side apply step (the same code the auto path
would run, but only after explicit human consent).

## Context

Per decision doc §5: HIGH-risk proposals stop at `status='proposed'` and surface
in the queue. Approve → server runs the generator's apply → `applied`/`measuring`.
Reject → `rejected` (feeds dedup). `external-adoption` and `webhook-wiring` are
blocked from approval unless their required note is present.

## Likely files

- NEW `apps/api_server/src/routes/org_proposals_routes.ts`
- NEW `apps/api_server/src/controllers/org_proposals_controller.ts`
- `apps/api_server/src/app.ts` (mount, e.g. `/agent-org-proposals`)
- dispatches to the generators' apply steps (08, 09, 12, 13) + reuses
  org-optimizer-05 apply for gated body kinds

## Acceptance Criteria

- [ ] `GET /agent-org-proposals?status=proposed` lists the queue (high-risk only;
  low-risk never appears as `proposed`).
- [ ] `POST /agent-org-proposals/:id/approve` → runs the matching apply step →
  `applied` (then `measuring` for measurable kinds) → records `decided_by_user_id`.
- [ ] `POST /agent-org-proposals/:id/reject` → `rejected`, recorded in the dedup
  seen-set.
- [ ] Approve is **refused** (4xx) for `external-adoption` without
  `provenance_json`, or for `webhook-wiring` without the security note
  (`requiresSecurityNote`).
- [ ] Approve re-validates the change at apply time (names ⊆ live for agent/scope;
  auth+depth for delegation; HMAC/SSRF for webhook) and rejects if invalid.
- [ ] Endpoints respect the local agent-server auth model (`AGENT_LOCAL` bypass
  scoped to localhost — never exposed externally).

## Required tests

- queue contract: low-risk proposals never listed as `proposed`; approve high-risk
  → applied; reject → rejected + dedup; approve blocked w/o required note;
  approve re-validates and rejects an invalid change.

## Dependencies / order

Depends on 01, 04, and the generators (06–09; 12–13 add their apply steps).
Required by 11 (Flutter surface) and the gated generators' apply paths.

## Safety notes

The privileged writes (`agent_configs`, `allowed_delegates_json`,
`agent_webhook_endpoints`, external install) happen here, server-side, behind the
approval — not from the optimizer agent's tool surface.
