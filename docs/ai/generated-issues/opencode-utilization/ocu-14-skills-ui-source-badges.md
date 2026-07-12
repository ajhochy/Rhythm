---
date: 2026-07-11
repo: Rhythm
branch: ocu-14-skills-ui-source-badges
status: ready-for-coding
issues: [1055]
order: 14
depends_on: [OCU-13]
tags: [issue, Rhythm, opencode-utilization, m3-org-skill-library]
---

# OCU-14 — Skills UI — source badges and read-only org skills

## Summary

The skills manager currently assumes all skills are locally managed. With org skills arriving via skills.urls, users need to see where a skill comes from and must not get edit/delete affordances on remote ones. Surface skill source from the backend listing and add badges for Org / Local sources.

## Scope (in)

- Surface skill source from the backend listing (backend GET /opencode/skills already reads engine skill list — extend response with source: managed|org|external if not present)
- Badge rows (Org / Local)
- Hide edit/delete for non-managed
- Profile-sheet "Allowed Skills" section keeps working with org skills selectable in allowlists
- Add a "refresh org skills" action triggering backend reloadSkills

## Non-goals (out)

- No org-skill editing from the client (publishing is OCU-15, server-side)
- No new skills-view redesign
- No changes to production user data beyond what the spec names

## Likely files

- apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart
- apps/desktop_flutter/lib/features/agents/data/opencode_skills_data_source.dart
- apps/api_server/src/routes/opencode_skills_routes.ts (source metadata)
- apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart (allowlist rows show badge)

## Acceptance criteria

- Org skills render with badge and no edit/delete
- Local managed skills unchanged
- Org skill selectable in a profile allowlist and enforcement works (agent can invoke it)
- Refresh action pulls newly published org skills without restart
- Flutter analyze clean

## Required tests

- Widget test with mixed-source fixture asserting badges + affordance gating
- Backend test for source metadata field

## Dependencies

OCU-13
