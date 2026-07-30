---
date: 2026-07-30
repo: rhythm
branch: codex/msp-002-profile-first-sessions
pr: null
issues: [MSP-002]
status: pending-native-verification
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# MSP-002 profile-first sessions

## Files

- Added the shared mobile `SessionConfigurationSheet` and routed all explicit
  new-chat controls through it.
- Added Secretary-first/profile-default, picker-search, and isolated session
  state helpers.
- Extended only the provider preference/creation/state seams; no
  `openSession()` or `ensureActiveSession()` navigation logic was edited.
- Removed the composer execution-control row and global-looking approval
  shield while retaining MSP-005's multiline input behavior.
- Added the missing MSP-002 acceptance contract, automated contract test, and
  native smoke checklist.

## Checks

- `cd apps/mobile && ./node_modules/.bin/tsc --noEmit` — pass.
- `cd apps/mobile && npm run lint` — pass.
- `cd apps/mobile && node --test tests/contract/msp-002-profile-first-sessions.test.mjs`
  — 7 passed, 0 failed.
- `cd apps/mobile && npm test -- --runInBand tests/chat/chat-composer.test.tsx`
  — 4 passed, 0 failed.
- `cd apps/mobile && node --test tests/provider-utils.test.mjs tests/contract/msp-001-session-profile-contract.test.mjs`
  — 3 passed, 0 failed.
- `git diff --check` — pass.
- Entry audit — the three explicit UI entry points delegate to the shared
  creation sheet and provider flow; direct SDK creation exists only inside
  `OpencodeProvider.createSession`.
- GitNexus scoped detection — HIGH risk, 13 files, 59 symbols, six affected
  mobile chat/workspace flows. The `main` comparison is CRITICAL because it
  includes the inherited MSP-001/MSP-005 base.
- `ai-workflow checks --level issue` — environment-blocked: Flutter SDK cache
  writes are outside the managed workspace, and missing API/MCP local
  TypeScript binaries attempted blocked registry resolution.

## Notes

- Focused commits: `66889deb7` (acceptance contract), `6bec3a247` (isolated
  provider creation/preference/state seams), and `4a81d4a03` (UI and mobile
  documentation).
- Baseline acceptance run before implementation: 0 passed, 6 failed. A seventh
  global-approval guard was added before the final green run.
- The referenced MSP-002 contract JSON was missing, so it was generated from
  the task's final product decisions.
- No server, sandbox, database, or port was started or touched.
- Native visual/accessibility smoke was not run; follow
  `docs/testing/msp-002-profile-first-sessions-smoke.md`.
- Failure triage corrected an inconsistent three-dot accessibility label, made
  the scope assertion whitespace-safe, and moved native modal accessibility
  props off the Paper `Dialog` type. Focused checks passed afterward.
- The empty-workspace bootstrap remains owned by MSP-004. It receives
  Secretary defaults through `createSession()` but intentionally does not add a
  picker to MSP-004's route/opening flow.
