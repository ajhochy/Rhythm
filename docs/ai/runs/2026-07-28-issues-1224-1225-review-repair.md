---
date: 2026-07-28
repo: rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1224, 1225]
status: complete
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Issues #1224 and #1225 corrective-review repair

## Files changed

- Account/origin-scoped Direct-Mac persistence, credentials, notifications,
  account cleanup, paired-host transitions, and focused contracts under
  `apps/mobile/`.
- Injectable Android release orchestration, its CLI wrapper, and focused
  signing-security contracts under `apps/mobile/`.
- Mobile package verification gates and adjacent persistence/account tests.

## Checks run

- Review-hardening contracts initially exposed five failures for #1224 and
  three failures for #1225.
- `npm run test:corrective:1224`: 8/8 passed after repair.
- `npm run test:corrective:1225`: 8/8 passed after repair.
- `npm run test:rhythm-account`: 25/25 passed.
- `npm run test:ci:static`: passed.
- `npm run verify:foundation`: passed, including 46/46 Playwright tests.
- `git diff --check -- apps/mobile docs/ai/contracts/issue-1224.json
  docs/ai/contracts/issue-1225.json`: passed.

## Notes

- Triage found that token loss and 401 expiry did not fully revoke stale
  account state; cleanup could stop at its first failure; notification
  completion could clear the newly active account instead of its originating
  account; and ordinary stale writes could replace the active origin.
- The repair makes account cleanup failure-safe, separates registry membership
  from explicit active selection, and binds notification completion to the
  originating account and origin.
- Triage also found the Android tests covered helpers rather than the real
  release orchestration, and that keystore inputs/files were not guaranteed to
  be scrubbed across every exit path.
- The repair makes the production orchestration injectable and tested, removes
  all signing inputs before the first child process, uses minimum child
  environments, redacts failures, and removes the generated keystore on
  prebuild, keytool, Gradle, and successful exits.
- No follow-up issue was filed; the findings were repaired in scope.
- GitNexus impact and `detect_changes` evidence remains unavailable. Bounded
  caller inspection and the full mobile verification matrix were used as the
  documented fallback, not represented as a GitNexus pass.
