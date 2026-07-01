---
index: "[[Rhythm]]"
date: 2026-06-27
repo: rhythm
branch: fix/opencode-jit-entitlements
pr: 756
issues: []
status: merged
tags: [run, rhythm]
---

# v18.52 regression fix — opencode JIT entitlements (v18.53)

## Files changed
- `apps/desktop_flutter/macos/Runner/opencode.entitlements` — NEW; opencode-only relaxations (allow-jit, allow-unsigned-executable-memory, disable-library-validation)
- `apps/desktop_flutter/macos/Runner/Release.entitlements` — reverted to original strict set (app does not need the relaxations)
- `tools/release/sign_and_notarize_macos.sh` — sign the opencode binary with `opencode.entitlements`; app signs with its own (reverted) entitlements

## Checks run
- `plutil -lint` + strict `plistlib` parse on both plists — PASS
- `bash -n` signing script — PASS
- **Local hardened-runtime re-sign matrix** (the check v18.52 lacked):
  - no entitlements → launches, PTY dlopen FAILS
  - `disable-library-validation` only → SIGTRAP exit 133 at launch (reproduces v18.52)
  - `+ allow-jit + allow-unsigned-executable-memory` → launches AND `POST /pty` returns a live `/bin/zsh`
- Final test with the repo's `opencode.entitlements` verbatim — engine alive + PTY shell ✓
- Desktop CI (#756, run 28296144072) — SUCCESS
- v18.53 release (run 28296267259) triggered

## Notes
**Repair loop.** v18.52 (PR #752) was a manual-smoke FAIL: it signed the opencode binary with `disable-library-validation` alone, which fixed the PTY dlopen but regressed the engine — adding ANY entitlement turns on Hardened Runtime JIT enforcement on the bun standalone, and without `allow-jit` + `allow-unsigned-executable-memory` it SIGTRAP-crashed in dyld at launch ("Server exited with code null", exit 133). v18.51 had no entitlements blob so it launched (but PTY failed).

Diagnosed via direct launch of the installed binary (exit 133) + crash report (SIGTRAP in /usr/lib/dyld) + a controlled re-sign matrix that isolated the exact entitlement set. Postmortem: `.agent-stack/postmortems/2026-06-27-issue-752.json` (C1 — missing local launch check; soft W5 — verification asserted presence not behavior).

**Process fix:** codesign/entitlement changes to a bundled bun/JIT/standalone binary MUST be locally launch-tested under hardened runtime (`cp` + `codesign --force --options runtime --entitlements <f> -s -` + run + exercise feature) before release. Presence ≠ correctness.
