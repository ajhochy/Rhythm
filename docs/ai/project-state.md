# Project State

## Current focus

PR #1337 product scope is frozen and fully verified: adaptive global top tabs, a compact/collapsible Agents pane, mobile session hierarchy, the native prompt undefined-field fix, and the paired compact dashboard layout.

## Active branch / PR

- Branch: `ui/desktop-mobile-session-polish`; verified follow-up changes after `464ed71c` are currently uncommitted and pending push.
- Draft PR: [#1337](https://github.com/ajhochy/Rhythm/pull/1337).
- Final evidence: `docs/ai/evidence/2026-08-08-pr-1337-ui-smoke.md` (97/97 contract criteria).

## In progress

- AJ accepted all desktop, mobile, and dashboard smoke results and authorized commit/push, fresh CI, readying and merging PR #1337, branch cleanup, and desktop release `v0.18.57` with start confirmation.
- Existing unrelated follow-ups remain: on-device confirmation of #1327 subagent approvals; #1319 parent taint propagation and `rhythm_delegation_transcript`; transcript fencing for the remaining half of #1331.

## Risks / known issues

- Nonblocking residual: VoiceOver traversal through offscreen dashboard rows.
- GitNexus risk is **MEDIUM** only because of the Build→FocusBusinessProjectProgress process; tests and default call sites are green.
- #1322 remains partial: plan mode does not make arbitrary `bash` read-only.
- Never start a bare manual `api_server` for smoke; use `tools/dev/sandbox.sh` to avoid the live engine/DB collision paths.
- `apps/api_server` still has no effective lint gate; TypeScript compilation is its static check.

## Test status

- Final verification gate: **PASS**; workflow-hygiene retrospective and evidence reconciliation are included.
- Flutter: format and analyze pass; 103 focused and 1,081 full tests pass; macOS build passes.
- Mobile: focused suites (3 + 5), full 53 tests, lint, and typecheck pass.
- UI/WCAG review and AJ desktop/mobile/dashboard smoke pass. The final dashboard refinement remained within 12 focused tests, analyze, and build; final UI review includes that structure.

## Next step

Commit and push the frozen scope, run fresh CI, mark PR #1337 ready, merge to `main`, clean the branch, then dispatch desktop release `v0.18.57` and confirm it starts.
