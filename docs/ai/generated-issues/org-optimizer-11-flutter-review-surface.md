# org-optimizer-11: Flutter review surface

## Goal

A new Agents tab (alongside Cookbook and Webhooks) that lists human-gated
proposals with kind / risk / rationale / evidence, and lets the user approve or
reject. For `external-adoption` and `webhook-wiring`, the provenance/security note
is shown and the Approve button is disabled until the note is present.

## Context

Per decision doc §5/§6/§7. Mirror the existing `agent_cookbook` and
`agent_webhooks` Flutter features (model/controller/data_source/view + nav wiring,
light theme tokens).

## Likely files

- NEW `apps/desktop_flutter/lib/features/agent_optimizer/models/org_proposal.dart`
- NEW `.../agent_optimizer/data/org_proposals_data_source.dart`
- NEW `.../agent_optimizer/repositories/org_proposals_repository.dart`
- NEW `.../agent_optimizer/controllers/org_proposals_controller.dart`
- NEW `.../agent_optimizer/views/org_proposals_view.dart`
- nav wiring in the Agents shell; data source uses `AppConstants.agentLocalBaseUrl`

## Acceptance Criteria

- [ ] The tab lists `status='proposed'` proposals (from `GET /agent-org-proposals`)
  with kind, risk badge, title, rationale, and an evidence/expand affordance.
- [ ] Approve → `POST /:id/approve`; Reject → `POST /:id/reject`; list refreshes.
- [ ] For `external-adoption`: the provenance block (source/stars/downloads/
  last-updated/maintainer/license/install-cmd) is rendered; Approve is **disabled**
  until that note is present.
- [ ] For `webhook-wiring`: the security block (trigger source/event, target
  agent/recipe + scope, HMAC setup, SSRF/allowlist, fencing note) is rendered;
  Approve is **disabled** until present.
- [ ] Uses the agent-local base URL (not `serverConfigService.url`).
- [ ] `dart format` clean; `flutter analyze --no-fatal-infos` passes.

## Required tests

- widget test pumping the MOUNTED surface (not an isolated widget): list renders
  from a fake data source; Approve disabled until note present for
  external/webhook kinds; reject calls the endpoint. (Per repo memory on the
  orphaned inspector — wire to the real surface, not isolated widgets.)

## Dependencies / order

Depends on 10 (queue API). Required before the gated generators are useful to a
human (08, 09, 12, 13).

## Safety notes

UI must not expose an approve path that bypasses the server-side note gate — the
disabled state is a UX aid; the API (10) is the real gate.
