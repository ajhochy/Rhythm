---
date: 2026-09-24
repo: Rhythm
branch: swarm/issue-1579
pr: null
issues: [1579]
status: needs_context
tags: [run, Rhythm]
---

## Files

- Added preliminary `docs/ai/contracts/issue-1579.json` and `apps/electron/test/issue-1579-contract.test.mjs`. These are **not** a complete acceptance contract or passing implementation; do not use them as readiness evidence.
- Preserved `docs/ai/runs/2026-09-24-issue-1579-u0-api-auth-proof.md` unchanged. No product code edited.

## Checks

- `pwd && git branch --show-current && git status --short && git status --branch --short` in `/private/tmp/rhythm-swarm-1579`: correct worktree/branch; only the existing U0 receipt was untracked at entry.
- `gh issue view 1579 --json title,body` and `gh issue view 1579 --comments`: issue body returned acceptance criteria, no plan/correction/session text in comments.
- `node --test test/issue-1579-contract.test.mjs` in `apps/electron`: final output `# tests 3`, `# pass 0`, `# fail 3`; c1 and c2 `false !== true` (missing main and preload wiring), c5 `true !== false` (renderer notification permission still granted). No compilation/runtime error.
- GitNexus upstream impact: `syncNativeApprovalNotifications` LOW (one direct `main.mjs` caller, zero affected processes); `invalidateAuthentication` LOW (one direct `main.mjs` caller, zero processes); `FixtureProvider` LOW (three direct test harness callers, zero processes); `AgentsWorkspace` LOW (two direct callers including `App`, zero processes); `Transcript` LOW (one direct caller `AgentsWorkspace`, zero processes). File-level main/preload lookup did not resolve. No HIGH/CRITICAL warning occurred; no symbols edited.

## Notes

- NEEDS_CONTEXT: user specifically requires implementing U1 then U2 **using Opus plan `afcc9687`, Astra correction `22ff4516`, and U0 sessions `46ea7e01` / `cd766293`**. Those session contents were not supplied in the dispatch, are not in `docs/ai/`, and are not in the #1579 issue/comments. Request the plan and correction text (or an accessible path/API for those sessions) before editing the security-sensitive host/renderer boundary. The U0 run receipt itself is available and confirms anonymous local route returns 200, so a nonempty main-owned bearer must gate all notification GETs.
- Phase 0 is **incomplete**: only three preliminary red assertions exist; they prove missing wiring/unsafe permission but do not exercise the behavioral acceptance criteria. Full host/Playwright/live contracts, U1/U2 implementation, builds, sandbox 6298/6297/6299, packaged U3 automated evidence and manual smoke were not run. No approval, navigation, API, engine, Flutter, routes, dependencies or state/plan files were changed. No commit/push/merge/stash/clean.
- `git status --short --branch && git diff --check && git diff -- docs/ai/runs/2026-09-24-issue-1579-u0-api-auth-proof.md`: only U0 receipt plus three new untracked files, no tracked diff, U0 receipt unchanged. Note `git diff --check` does not cover untracked files.
- Manual targets `issue-1579-c9`: visible Notification Center completion and ask banners; physical notification click; System Settings permission state; after-quit behavior explicitly not tested (not in approved scope).
