---
date: 2026-07-28
repo: rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1175]
status: passed-focused-smoke
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Mobile OAuth live-route compatibility repair

## Files changed

- Restored the configured iOS OAuth client and redirect fields in the mobile
  exchange request for compatibility with the currently deployed Cloud route.
- Kept the hardened server behavior unchanged: the server continues to pin
  trusted OAuth configuration instead of accepting caller-selected values.
- Added return-value and request-forwarding regression coverage and criterion
  `issue-1175-c33`.

## Checks run

- `npm run test:google-mobile-oauth` — PASS.
- `npm run test:rhythm-account` — PASS, 25 tests.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS with one pre-existing warning in generated Expo types.
- `ai-workflow checks --level issue` — PASS.
- `ai-workflow checks --level pr` — PASS across the configured Flutter, API,
  MCP, OpenCode fork, mobile contract, fake-server, and web E2E gates.
- Signed development iPhone build — build, signature verification,
  installation, and launch PASS.
- Focused physical smoke — user reported `Connected`.
- `git diff --check` — PASS.

## Notes

- The initial physical smoke exposed a deployed-route compatibility gap:
  the route still required the client and redirect fields that the hardened
  mobile request had stopped sending. The repair restores only those request
  fields; it does not weaken server-side OAuth pinning.
- The earlier failed-smoke record and the separate recovery-pass record remain
  in the local workflow postmortem store. No follow-up issue was filed because
  the focused recovery smoke passed.
- GitNexus impact/detect tools were unavailable. Manual changed-file and caller
  inspection found only the two mobile auth modules, their focused tests, and
  project evidence; no API server source changed.
- No credential, signing asset, device identifier, pairing token, private
  hostname, or generated build artifact is included in this run record or diff.
- This result covers Google authentication and the app reaching `Connected`;
  it does not complete the broader #1175 physical tools, isolation, streaming,
  approvals, revocation, background recovery, production archive, or
  TestFlight matrix.
