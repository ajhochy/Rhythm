---
date: 2026-07-27
repo: Rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1175, 1198, 1199]
status: blocked
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Google iOS client physical-device smoke

## Files

- Added the required failed-smoke postmortem.
- Updated project state with the bounded Google OAuth configuration blocker.
- No source, native configuration, dependency, credential, or generated runtime
  file changed.

## Checks

- Confirmed the standalone `.app` is signed for
  `org.visaliacrc.rhythm.agents.dev` by the intended Apple team.
- Confirmed the app installed, launched, and reached the account flow on an
  iPhone 13 mini.
- Confirmed the build shell and checked-in/local mobile environment contain no
  configured `EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID` or matching redirect URI.
- Inspected the embedded Metro bundle without printing values:
  `OAUTH_CLIENT_EMBEDDED=no`, `OAUTH_REDIRECT_EMBEDDED=no`,
  `CONFIG_GUARD_EMBEDDED=yes`.
- Read #1175, #1198, and #1199 and confirmed this is an existing human release
  prerequisite rather than a new product issue.
- `ai-workflow checks --level issue` passed Flutter analyze/format and the API
  and MCP TypeScript checks.
- `ai-workflow checks --level pr` passed the complete Flutter, API, MCP,
  vendored-engine, mobile static/contract, fake-server, and web-E2E matrix.
- `node .gitnexus/run.cjs detect_changes --repo Rhythm-1172 --scope working
  --limit 8` reported LOW risk, no affected processes, and only documentation
  symbols.
- `git diff --check` passed.

## Notes

- Physical smoke stopped at `Google mobile client ID is not configured.`
- Classification: C5 environment/configuration issue, with no divergence from a
  completed physical-device claim because `issue-1175-c5`, #1198, and #1199 are
  still pending.
- The repository already records that the real Google iOS OAuth client was not
  available to the implementation account. A Google Cloud project
  administrator must provision or reveal it through secure configuration.
- Reusing a desktop/web client, inventing a value, or committing a credential
  was rejected because the API pins the exact mobile client and redirect.
- The next executable step is to securely configure the real client/redirect
  for both the build and isolated API, rebuild the exact reviewed source, and
  rerun Google sign-in before continuing the section-14 device matrix.
