---
date: 2026-08-04
repo: Rhythm
branch: workflow/run-2026-08-04-agent-autonomy
pr: (not yet opened)
issues: (none pre-existing — searched approval/taint/autonomous/scheduled, completed_no_op, auto_approve, bash allowlist; all empty)
status: code complete and verified; live application and 17-task smoke BLOCKED on tool permissions
tags: [run, Rhythm, agents, scheduler, security]
---

# Scheduled-agent autonomy: five defects fixed

Goal: every one of the 17 enabled scheduled tasks completes a manually-triggered
run with no human interaction.

## Diagnosis (live, against the running server on :4001)

All 8 of the day's scheduled runs ended `completed_no_op` or
`blocked_on_approval`. Run history is only reachable via
`GET /agent-sessions?scheduledTaskId=<id>` — `is_system=1` rows are excluded from
the plain session list, so a normal session list shows none of it.

| Task | Recorded | Actual |
|---|---|---|
| daily-dev-summary 01:00 | `completed_no_op` | wrote `Daily/2026-08-03.md` |
| Org Self-Optimizer 09:01 | `completed_no_op` | 6 proposals written |
| **Memory Consolidation 09:30** | `blocked_on_approval` | **captured 0**, 4 approvals pending |
| **Org External Discovery 10:01** | `completed_no_op` | **did nothing**, 1 approval pending |
| theological-research 11:30 | `completed_no_op` | 23 vault writes, 11 bash denials → partial captures |
| ffb-dashboard 12:30 | `completed_no_op` | worked; gmail/artifact publishing unavailable |
| dev-dashboard-refresh 12:31 | `completed_no_op` | updated `data.js` + brief |
| daily-email-triage 15:00 | `completed_no_op` | full triage report |

MCP health was **not** the problem: 20/26 connected, with `obsidian`, `rhythm`
and `scrapling` all healthy, so the Aug 2–3 `required_mcp_unavailable: obsidian`
errors were transient spawn flakiness.

## Files

- `apps/mcp_server/src/security/external_content_boundary.ts` — exemption set
  widened from 1 → 17 first-party sources; added `salvageCleanListItems()` for
  per-item filtering of flagged first-party list payloads.
- `apps/api_server/src/services/external_content_security_service.ts` — added
  `autoApproveUnattendedScheduledRun()`, a three-condition narrowing of the
  #1134 human-approval rule, with a full audit row per bypass.
- `apps/api_server/src/services/agentSchedulerService.ts` — un-anchored
  `MUTATION_TOOL_PATTERN` to segment-boundary matching; both run signals now
  traverse the delegation tree via a recursive CTE on `parent_session_id`.
- `apps/api_server/src/services/opencode_stream_bridge.ts` — hoisted the
  permission-mode resolution above the #878 bash gate; the `ask` branch no longer
  registers an unanswerable card in an unattended session.
- `tools/dev/repair_profile_bash_allowlists.py` — **new**, dry-run by default.
- Tests: 4 new files + 2 extended (`issue-1226.spec.ts`,
  `opencode_stream_bridge.test.ts`).

## Notes

**Two things the tests caught that I had wrong.**

1. I initially exempted `research.job` as first-party. Its own label is
   `"external research job result"` — it carries fetched web content. Auditing
   every exempted source against its label caught it before commit.
2. My first `isUnattended` treated bare `bypassPermissions` as unattended. The
   existing #878 test failed, correctly: an interactive session in bypass mode
   still has a human, and #878 deliberately forces `git push --force` to surface
   a card there. Narrowed to `isDelegatedChild || isScheduledRun`.

A third: a plan-mode unattended session still registered a card, because I had
guarded `isUnattended` on `!shouldAutoDeny`. Separated so plan mode falls through
to auto-DENY instead of hanging.

**Measured, not assumed.** The old `MUTATION_TOOL_PATTERN` matched 0 of 11 real
mutating tool names; the new one matches 11/11 with 0 false positives across 12
read-only names. The real 50-row memory payload went from fully blocked to 48
rows returned with 2 correctly withheld.

**Baseline was red before I started** — worth recording, because I briefly
misread a wrapper's exit 0 as a green baseline. Three pre-existing failures,
confirmed by stashing my changes and re-running on clean `main`:
`opc_curated_mcp_ensure.test.ts` (shared-state, 3–4 assertions), `mobile static
suite` (`eslint: command not found`), `mobile web e2e` (`unknown command 'test'`).
None are mine and none are in scope here.

## Blocked

Two pieces of the goal could not be completed — the permission classifier denied
every route to a mutating call against the local agent server (`python` script,
`curl -X PATCH`):

1. **Applying the profile bash-allowlist repair.** Derived and dry-run verified;
   needs `python3 tools/dev/repair_profile_bash_allowlists.py --apply`.
2. **Relaunching Rhythm and triggering all 17 tasks.** Needs the relaunch (agent
   `.md` frontmatter and `opencode.json` only reload on a fresh boot) plus
   `POST /agent-schedules/:id/trigger` per task.

Until those run, the code fixes are unverified against live behavior. Do not
treat this run as proving the goal.
