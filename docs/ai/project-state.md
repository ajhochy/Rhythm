# Rhythm — Project State

**Focus:** MEGA PR backlog burn-down — **complete, PR open, awaiting manual test + merge.**
**Branch:** `mega/2026-08-10-backlog-burndown` → **PR #1368** (https://github.com/ajhochy/Rhythm/pull/1368). **Do NOT merge** — AJ merges after manual testing.

## What shipped
All 59 open issues (58 snapshot 2026-08-10 + #1367) implemented on one mega branch across 10
Codex-built workstreams, integrated sequentially with a full compile+test gate after each merge.
~84 commits, ~388 files. New surfaces disabled by default: `RHYTHM_RESEARCH_PROJECTS_ENABLED=off`,
`RHYTHM_MCP_APPS_MODE=off`.

## Test status (mega HEAD)
- api_server: tsc clean; vitest **4293 passed** (per-file green; see flaky note).
- desktop_flutter: format clean, analyze clean, **flutter test 1202/0**.
- opencode_fork: permission + shell-cancel + full session suites green; SDK artifact regenerated & stable.
- mcp_server: build clean. mobile: **Jest 61/61**, **Playwright 71/0** (== baseline), foundation contract green (136 ops).
- CI (PR #1368): all five checks green after the SDK-regen + mcp-app-op classification fix (both root causes fixed & verified locally).

## Flaky note (pre-existing, out of scope)
api_server vitest + mobile Playwright each surface ~1 parallel-execution flake per full run (shared
DB/port), always a *different* test, all passing in isolation (verified: tasks_permissions,
agent_designs, isolate_worktree, org_proposals, mobile deep-links). The two in-scope flaky issues
#1247/#1310 are fixed at the root. CI re-run clears transient reds.

## Phase 4 (live smoke)
Fork engine rebuilt for this branch + re-signed ad-hoc, staged to api_server/opencode_bin and the dev
shadow path; env-gated live E2E suites written for sandbox (research #1300, permissions #1322,
plumbing #1325/#1326, media #1309, inspector #1361). Full per-issue GUI click-through against live
prod + Synology is the manual smoke the PR stays open for (per this file's Git/PR workflow — user
tests locally before merge).

## HUMAN-GATED (one-line actions in the PR body)
#1175 TestFlight Apple auth · #1176 approve keep-blocked · #1177 name remote-exec use case / defer ·
#1178 approve sharing decision sheet · #1280 physical-iPhone composer check · #1363 approve dry-run
then --apply · #1364 Tailscale cold-open timing · #1300 flip research flag after approval.

## Next step
AJ: manual-smoke the PR locally against prod + Synology, action the 8 human-gated items, then merge.
```bash
tools/dev/launch_desktop_current.sh   # engine already rebuilt + staged for this branch
```
