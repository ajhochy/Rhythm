---
date: 2026-10-01
repo: Rhythm
branch: codex/opencode-memory-recovery
pr: 1598
issues: [1603]
status: unverified
tags: [run, rhythm]
---

# Installed Flutter WebSocket profile frame

## Files

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`: retain the explicitly selected Rhythm profile ID beside its OpenCode agent name and include both on `session.input`. Reset clears both selections. The existing asynchronous session PATCH is unchanged.
- `apps/desktop_flutter/test/features/agents/opc_m4_4_agent_selection_test.dart`: hold profile persistence behind a gate and assert an immediate turn still carries profile B when the server has profile A and both execute via `build`; reset omits the explicit profile ID.

## Checks

- Pre-fix: `flutter test test/features/agents/opc_m4_4_agent_selection_test.dart --plain-name 'selected profile identity reaches the input frame before its PATCH settles'` failed as expected: frame had `agent: build` but lacked `profileId: profile-b`.
- Post-fix: `flutter test --no-pub test/features/agents/opc_m4_4_agent_selection_test.dart` passed 10/10; `flutter test --no-pub test/features/agents/issue_867_session_agent_binding_test.dart` passed 7/7.
- `dart format --output=none --set-exit-if-changed .` exited 0, 527 files checked and 0 changed.
- `flutter analyze --no-fatal-infos --no-pub` exited 0 with existing info-level lints; `git diff --check` exited 0.
- Pre-edit GitNexus upstream: `AgentsController.sendInput` MEDIUM, 7 direct callers/0 processes; `setSelectedAgent` LOW, 2 direct/0 processes; test fake `updateSession` LOW lower bound, 0 direct/0 processes. Index was 14 commits behind this worktree.

## Notes

- Decision: carry the already known canonical ID on the turn, rather than waiting for the PATCH; this preserves the existing selection, persistence, and permission semantics.
- Deviation: none. No API/engine process was started and no installed binary was changed here.
- The unit test verifies the producer frame. A same-source API/engine or installed-app turn remains a separate live gate; this receipt does not claim it.
