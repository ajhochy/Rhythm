---
date: 2026-08-01
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285, 1287]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1285 projectless desktop-to-mobile live update

## Files changed

- Extended the authenticated mobile SSE filter to accept a session event outside the selected project directory only when the session is an exact-owner selected-project-or-projectless chat and the event directory canonicalizes to its stored working directory.
- Removed the proxy's redundant selected-project directory predicate so the hardened owner/session-directory predicate is authoritative.
- Added deterministic c21 coverage, upgraded the real issue #1283 stream test to an All Sessions projectless chat, and recorded the failed device smoke.

## Checks run

- `npx vitest run src/__tests__/issue_1170_mobile_realtime_proxy.test.ts -t "issue-1285-c21"` — red before the fix, then PASS 1/1 after the fix.
- Focused realtime/security/API set — PASS, 3 files / 21 tests.
- `npm run build` in `apps/api_server` — PASS.
- `bun run build --single` in the vendored fork — PASS after granting the documented models.dev fetch; standalone binary smoke passed.
- Isolated foreground sandbox on API 4098 / engine 4097 plus `RHYTHM_LIVE_E2E=1 ... issue_1283_mobile_desktop_live_stream.test.ts --no-file-parallelism` — PASS 1/1 in 3.31 seconds.
- `ai-workflow checks --level issue` — PASS.
- `ai-workflow checks --level pr` — PASS for all configured stages.
- Desktop runtime probes on port 4001 — `/health` and `/opencode/health` returned HTTP 200 with `ok` and `ready`.
- GitNexus upstream impact — LOW for `mobileSseEventBelongsToOwner` and `MobileSseProxy.consume`; unstaged change detection LOW.

## Notes

The physical-iPhone smoke failed because desktop-originated turns appeared only after manual mobile refresh. Triage found both the gateway security filter and client expected the selected project directory, while All Sessions events carried their projectless chat working directory. A first live correction still failed because macOS represented the same temp directory as `/var/folders/...` in SQLite and `/private/var/folders/...` in the engine event; the guard now uses the existing realpath-safe canonicalizer. The initial detached sandbox process was reaped by the host, so the unchanged live test was rerun with the documented foreground hold. Existing follow-up #1287 remains the tracker; no duplicate issue was opened.
