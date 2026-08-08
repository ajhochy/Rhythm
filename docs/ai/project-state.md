# Project State

## Current focus

Verified desktop/mobile UI polish is ready for AJ review: adaptive Flutter workspace navigation, a denser and accessible Flutter Agents session pane, and compact nested Expo mobile session rows.

## Active branch / PR

- Branch: `ui/desktop-mobile-session-polish`; commit `464ed71c` is pushed.
- Draft PR: [#1337](https://github.com/ajhochy/Rhythm/pull/1337).
- Contracts: `ui-desktop-global-navigation.json`, `ui-desktop-agents-session-pane.json`, and `ui-mobile-agents-session-list.json`.
- Run notes: `2026-08-08-desktop-global-navigation.md`, `2026-08-08-desktop-agents-session-pane.md`, and `2026-08-08-mobile-agents-session-list.md`.

## In progress

- Awaiting AJ manual smoke and review of draft PR #1337; never merge without explicit approval.
- Existing unrelated follow-ups remain: on-device confirmation of #1327 subagent approvals; #1319 parent taint propagation and `rhythm_delegation_transcript`; transcript fencing for the remaining half of #1331.

## Risks / known issues

- Manual smoke still needs iOS VoiceOver traversal across row-open/disclosure/overflow sibling controls, confirmation of the macOS Tools focus outline, and a populated session-list visual review.
- #1322 remains partial: plan mode does not make arbitrary `bash` read-only.
- Never start a bare manual `api_server` for smoke; use `tools/dev/sandbox.sh` to avoid the live engine/DB collision paths.
- `apps/api_server` still has no effective lint gate; TypeScript compilation is its static check.

## Test status

- Verification gate: **PASS**, after two UI/UX/accessibility repair attempts.
- Verification remains current because no production code changed after commit `464ed71c`.
- Flutter: format clean; analyze exit 0; 31 focused and 1,059 full tests pass.
- Mobile: 13 focused and 53 broader tests pass; lint and typecheck pass.
- Ownership/diff review: exact 15-file union, clean; no API, provider, persistence, config, dependency, migration, or security changes.
- Verification sandbox stopped cleanly.

## Next step

AJ completes the residual manual smoke and reviews draft PR #1337. Never merge without explicit approval.
