---
date: 2026-07-11
repo: Rhythm
branch: ocu-15-org-skill-publish-pipeline
status: ready-for-coding
issues: [1056]
order: 15
depends_on: [OCU-12]
tags: [issue, Rhythm, opencode-utilization, m3-org-skill-library]
---

# OCU-15 — Publish pipeline — promote approved skills to the org library

## Summary

Rhythm already harvests/evaluates skills locally and has a human-gated org proposals Review Queue. Publishing a skill to the org library should ride that existing approval flow rather than a new one. Given an approved local skill, POST it to the production /org-skills endpoint (authed with the user's session token).

## Scope (in)

- New proposal type / applier "publish-skill-to-org": given an approved local skill, POST it to the production /org-skills endpoint (authed with the user's session token)
- Surface publish status
- Unpublish path (DELETE) behind the same review queue
- Wire into org_proposal_appliers_wiring.ts alongside existing appliers

## Non-goals (out)

- No auto-publishing without human approval (hard rule: org-visible artifacts are human-gated)
- No versioning/rollback of org skills (follow-up if needed)
- No changes to production user data beyond what the spec names

## Likely files

- apps/api_server/src/services/org_proposal_apply_service.ts
- apps/api_server/src/services/org_proposal_appliers_wiring.ts
- apps/api_server/src/services/skill_apply.ts (reuse read of managed skill body)
- apps/api_server/src/routes/org_proposals_routes.ts (if a new proposal kind needs listing metadata)

## Acceptance criteria

- Approving a publish proposal in the Review Queue results in the skill appearing in prod index.json (and on a second machine's engine after refresh)
- Rejection publishes nothing
- Unpublish removes from index
- Failure (prod down) surfaces as failed proposal, retryable

## Required tests

- Applier unit tests (publish/unpublish, auth header, failure path)
- End-to-end contract test with mocked prod endpoint

## Dependencies

OCU-12
