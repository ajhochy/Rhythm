# Rhythm — Project State

**Focus:** Mobile smart-client migration (`docs/ai/plan-mobile-smart-client.md`) — the phone stops
being a thin client of the raw OpenCode engine and becomes a client of api_server's smart server.

**Two open PRs, neither merged. Do NOT merge — AJ merges after manual testing.**

| PR | Branch | Scope |
|---|---|---|
| [#1384](https://github.com/ajhochy/Rhythm/pull/1384) | `mobile/sqlite-mirror` | Phase 0 (#1378 fail-soft) + Phase 1 (#1379a mirror-served reads) |
| TBD | `mobile/mirror-event-fanout` | Phase 2 (#1379b event fan-out) — branched off `main`, not off #1384 |

Both branch off `main` (`23c51f12`, the merged MEGA PR #1368). They overlap in exactly one file,
`apps/api_server/src/services/mobile_sse_proxy.ts`, in disjoint regions — #1384 adds a bounded
scope-check pre-check at the top of `stream()`, Phase 2 replaces the transport loop below it.

## In progress / next

- **AJ:** manual-smoke both PRs on a physical device over the remote gateway, then merge.
- **#1379 is not auto-closed by either PR alone.** Its remaining acceptance is device-only:
  measured cold-start timings and physical-device evidence over a remote gateway, which cannot be
  produced in a headless environment.
- Phase 3 follow-ups not yet filed: optimistic outgoing-bubble send on the phone; mirror child
  message *parts* (the bridge mirrors child rows but not child parts); mirror pending
  permissions/questions; dispatch queue so even submit does not block on a saturated engine.

## Test status

- **Phase 2 branch:** api_server serial suite **524 files / 4311 tests passed, exit 0**. 15 of 16
  PR-level checks green; the serial gate surfaced one shared-state flake (see below) that passes
  standalone and in isolation.
- **Phase 1 branch (#1384):** 529 files / 4349 tests passed, exit 0; all 16 checks green.
- desktop_flutter: format + analyze clean, flutter test green. mcp_server, opencode fork, and the
  four mobile suites green on both branches.

## Flaky note (pre-existing, out of scope)

The api_server serial gate surfaces ~1 shared-state ordering flake per full run — a *different*
test each time (observed: `dashboard_summary`, `agent_configs_routes`), always passing in isolation
and on a standalone re-run of the full serial suite. Documented on `PR_CHECKS` in
`scripts/run_ai_workflow.py` (#755/#1088). Re-run clears it.

## Risks

- The consolidated `/global/event` bridge stream is now on the critical path for **mobile
  streaming**, not just desktop and persistence. If it stops, phones fall back to per-device engine
  SSE (the pre-Phase-2 behavior) rather than failing — but the fallback is the slow path.
- Phase 1's mirror reads fall through live on any ambiguity, so a mirror bug degrades to the old
  behavior rather than serving wrong data. Paging past the mirror's earliest row for a session
  always costs one live engine call.

## Launch

```bash
tools/dev/launch_desktop_current.sh
```
