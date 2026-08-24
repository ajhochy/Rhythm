---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-7]
status: complete
tags: [run, Rhythm]
---

# Post-M1 Phase 7 capability inventory

## Files

- Added `docs/ai/coverage/react-electron/phase-7-knowledge-runs-notifications-inventory.md`.
- Added `docs/ai/contracts/post-m1-phase-7.json`.
- Added this run note.

## Checks

- Read `docs/ai/plans/2026-08-15-post-m1-parity-phases.md` Phase 7 before the capability walk.
- Confirmed the Flutter reference from read-only `origin/main` (`9fa2761ed78159f83f56982c03fcd85dc035039a`) using `git ls-tree`, `git show`, and `git grep`; did not fetch or change git state.
- Walked Flutter memory, research projects, Gallery, playbooks, cookbook, schedules, run quality, notifications, native presentation, approval push/signing, badge, and actionable navigation paths.
- Walked React `ToolWorkspace`, `Shell`, store/WebSocket handling, and the live gateway; walked Electron main/preload host contracts.
- Walked the requested API repositories/controllers/services plus scheduler ownership, run-quality, notification creation, and approval vocabulary sources.
- Compared the new JSON contract shape with `docs/ai/contracts/post-m1-phase-1.json`.
- Per unit constraints, ran no test suite, Playwright, parity generator, GUI, server, sandbox, or port-bound command.

## Findings

- Twelve first-class Flutter capabilities are absent from React/Electron.
- All Phase 7 React Tool screens are deterministic component-state previews. `ToolWorkspace.tsx` contains no fetch/gateway call; its HTTP-looking footer is a local trace.
- The live React gateway exposes only `tasks` and `sessions`, so memory, research, Gallery, playbooks, cookbook, schedules, run quality, notifications, and approvals have no live renderer domain.
- The React notification bell is fixed at two unread, does not list repository rows, and its read action only emits a toast.
- React's WebSocket handling has no `notification.push` branch.
- Electron has no native `Notification` use, no notification IPC/preload allowlist, no activation replay, and no secure approval signer. Flutter on `origin/main` has all of those contracts.
- Several fixture literals are schema hazards: memory `trust` values `verified`/`reviewed` are not canonical `trustTier`; React offers memory kind `decision`, which is not in the canonical memory-kind union; research display statuses must not be promoted into a new persisted enum; schedule `type` is not canonical `scheduleType`.
- The Phase 7 contract contains 22 pending executable sub-criteria, including explicit coverage for every missing capability and packaged native presentation/activation.

## Notes

- Scheduled execution remains local SQLite agent state. The hosted Postgres scheduler must not fire copied rows.
- `dispatched` is the canonical async-delegation acknowledgement, not a completion state.
- Persisted notification `type`/`entityType` unions are narrower than Flutter's broader navigation payload parser; the implementation must preserve that boundary rather than widening database vocabulary from display routes.
- Native payloads are untrusted input even though Flutter currently uses colon-delimited forms.

## Blockers

None for inventory/contract authoring. Implementation and every named test remain future work by design.
