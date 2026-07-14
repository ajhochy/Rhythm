---
date: 2026-07-11
repo: Rhythm
branch: ocu-02-permission-card-always-allow
status: ready-for-coding
issues: [1043]
order: 02
depends_on: [OCU-01]
tags: [issue, Rhythm, opencode-utilization, m1-interaction-polish]
---

# OCU-02 — PermissionCard — "Always allow" button + deny-with-reason field

## Summary

The Flutter permission prompt (PermissionCard) currently offers only Approve/Deny (once). With OCU-01 the backend accepts always + rejection message. Staff repeatedly re-approve the same action. This issue adds an "Always allow" action and an optional deny-with-reason field, improving the approval flow and reducing friction.

## Scope (in)

- Add an "Always allow" action to PermissionCard (secondary emphasis, next to Approve)
- Add an optional reason text field revealed when Deny is pressed (single-line, submit on enter, skippable)
- Wire through agents_controller acceptPermission/denyPermission and agents_data_source to the extended REST contract
- Keep the 60s auto-deny timer and DestructiveModalService flow intact
- The destructive-tool modal also gains Always allow

## Non-goals (out)

- No per-agent permission-matrix UI (OCU-33)
- No permission-mode picker changes
- No changes to production user data; local agent-server (port 4001) surface only unless the spec says otherwise

## Likely files

- apps/desktop_flutter/lib/features/agents/views/_permission_card.dart
- apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart
- apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart

## Acceptance criteria

- Always-allow visible on standard and destructive-modal permission prompts
- Choosing it approves the request and the same action is not re-asked later in the project
- Deny reason (when provided) is sent and visible to the agent
- flutter analyze --no-fatal-infos passes
- dart format clean

## Required tests

- Widget test pumping the real mounted PermissionCard surface (not isolated widget) covering all three actions + reason field
- Controller unit test for the new data-source call shape

## Dependencies

OCU-01
