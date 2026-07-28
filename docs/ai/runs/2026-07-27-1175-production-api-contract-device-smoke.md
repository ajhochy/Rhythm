---
date: 2026-07-27
repo: Rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1175, 1199]
status: failed-environment
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Physical sign-in production-contract mismatch

## Files changed

- Added a failure postmortem and updated the canonical project snapshot.
- No source, native project, generated runtime, dependency, or credential file
  changed.

## Checks run

- Repeated the Google account flow in the credential-configured, locally signed
  development app on the physical test iPhone.
- Observed an HTTP 400 from the authorization-code exchange.
- Compared the installed PR app request with the PR backend handler: the app
  sends only the authorization code, PKCE verifier, and nonce; the PR backend
  pins the Google client and redirect from server configuration.
- Used a safe dummy request to confirm the deployed production endpoint still
  requires the older caller-supplied redirect field.
- Confirmed the production deployment therefore does not yet implement the
  draft PR contract.

## Notes

- This is an environment-contract failure, not evidence that the new Google iOS
  client is absent or that the hardened request should be weakened.
- The failed artifact was pointed at the deployed production API for this first
  tap. The documented #1199 gate instead requires a matching isolated
  branch-built API/engine plus private test gateway.
- PR #1165 remains draft and unmerged. No production deployment was changed.
- Existing #1199 already owns the corrective environment and full physical
  matrix, so no duplicate issue was opened.
- Credentials, private hostnames, device identifiers, and request values were
  not recorded.
