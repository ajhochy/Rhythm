---
date: 2026-10-01
repo: Rhythm
branch: codex/opencode-memory-recovery
pr: 1598
issues: [C2]
status: scoped-pass-native-pending
tags: [run, Rhythm, verification]
index: "[[Rhythm]]"
---

# Installed WebSocket profile identity repair

## Files changed

- `apps/api_server/src/services/ws_gateway.ts` resolves the canonical Rhythm profile from trusted scope, explicit turn selection, recognized legacy profile ID, or the stored session before falling back to an OpenCode engine agent name. The eligibility, model and MCP scope checks use that canonical ID; the engine still receives its separate `build` or `plan` execution name. Unknown, disabled, locked, or mismatched explicit profiles fail before prompt dispatch.
- `apps/web/src/store.tsx` sends the selected canonical `profileId` with the engine `agent` on both text and attachment input frames; `apps/web/tests/electron-e22-live.spec.ts` checks the intercepted frame.
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` keeps the selected profile ID alongside its engine agent name and sends both on `session.input`, even if the session PATCH has not finished. `apps/desktop_flutter/test/features/agents/opc_m4_4_agent_selection_test.dart` reproduces that click-then-send race. Reset clears both selections.
- Focused API, live API/engine, and rendered browser regressions are in `apps/api_server/src/__tests__/installed_ws_profile_identity*.test.ts` and `apps/web/tests/installed-ws-profile-identity*.{spec.ts,config.ts}`. The [C2 contract](../contracts/c2-authoritative-profile-identity.json) now includes C2-c6 through C2-c8; the [postmortem](../../../.agent-stack/postmortems/2026-10-01-pr-1598-installed-manual-profile-ws.json) retains the failed old-build smoke.

## Checks run

- **Red before repair:** the installed 0.18.68 native client opened WebSocket 101 and sent `session.input` for an enabled custom profile whose engine agent was `build`; the old guard returned `agent disabled: 'build'` because the distinct `build` profile was disabled. The new focused default-profile unit case also failed before the source edit. The old signed artifact was built from 22df3b3a and is not evidence for the repair.
- **Focused repair:** `npm exec vitest run src/__tests__/installed_ws_profile_identity.test.ts src/__tests__/p2_systemprompt_ocagent.test.ts` from `apps/api_server` passed 19/19. Isolated real API/engine `installed_ws_profile_identity_live.test.ts` passed 1/1 in 14.85 s with a controlled synthetic provider. Rendered `installed-ws-profile-identity-playwright.config.ts` passed 1/1 in 11.0 s. The API tests assert the canonical MCP role, selected system prompt, engine name, and disabled/locked/unknown/mismatch denial before dispatch.
- **Flutter producer:** targeted profile-selection and session-binding suites passed 10/10 and 7/7; the full Flutter suite passed 1,356 tests. `dart format --output=none --set-exit-if-changed .` and `flutter analyze --no-fatal-infos --no-pub` exited 0. The linked [Flutter receipt](2026-10-01-installed-flutter-ws-profile-frame.md) records the race and commands.
- **Web:** production build and typecheck passed after the repair. `git diff --check` passed. GitNexus upstream impact was LOW for the API and web symbols and MEDIUM for `AgentsController.sendInput`; its index was stale, so the focused tests and final full checks remain authoritative.
- **Final-source API build:** passed. The serial full API suite was still running on frozen product source at this checkpoint. An earlier full API run began before the last legacy-guard edit, saw one agent-less failure, and was stopped with SIGINT/130; it is invalid mixed-source verification, not a final gate. New same-source CI and a rebuilt signed installed app remain pending.

## Notes

The prior C2 contract's five runner-identity criteria passed within their original scope. They did not send a manual WebSocket input frame; the new path was explicitly unverified. The historical native failure is categorized as a missing manual-entry contract, with no false PASS-to-FAIL claim. The 0.18.68 installed API/engine also produced a scoped harmless OpenAI schedule reply and a separate no-tool-call Sonnet image/workbook provider preflight; neither qualifies this corrected native input or the native picker.

The earlier installed C1 Run Now, E1 read-only approvals, and W6 selected-base checks remain scoped to the old signed source and their own private receipts. No original approval was decided. Final signed 0.18.69 and iOS build 17 require the next frozen SHA and separate installed/device readback; this receipt makes no release or physical-device completion claim. No duplicate follow-up issue was opened while the repair is in the existing draft PR.
