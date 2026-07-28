---
date: 2026-07-28
repo: Rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1171, 1172, 1199, 1235, 1237, 1238, 1239]
status: failed
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Physical iPhone mixed smoke

## Files changed

- Updated `docs/ai/project-state.md` with the current release blockers.
- Recorded the manual checkpoint here.
- The source screenshot and failure postmortem remain outside the repository;
  no user content or connection credential was copied into project files.

## Checks run

- Force-quit/relaunch recovery: pass.
- Active session background/foreground survival: pass.
- Tailscale loss: automatic reconnect passed after Tailscale returned, but
  Settings remained stale as Connected and paired-Mac loading could spin.
- Long prompt/response: failed keyboard-safe composition and complete transcript
  visibility.
- Desktop pairing/revocation discovery: blocked; the code path exists, but the
  conditional Agent Server Ready entry was not visible to the tester.

## Notes

- Created #1237 for authoritative paired-Mac disconnect/reconnect state.
- Created #1238 for multiline composition, keyboard dismissal, and complete
  transcript behavior.
- Created #1239 for persistent desktop Mobile Access pairing/revocation.
- Existing #1235 covers the duplicated oversized session chrome seen in the
  same smoke.
- Added a sanitized result comment to #1199. That release gate remains open.
- Failure-postmortem classification: C1. The matrix lacks granular observable
  contracts for five behaviors; there were no direct contract-pass-to-smoke-fail
  criterion divergences.
