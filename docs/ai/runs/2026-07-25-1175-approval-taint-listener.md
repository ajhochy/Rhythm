---
date: 2026-07-25
repo: Rhythm
branch: codex/1175-approval-taint-listener
pr: null
issues: [1175]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1175 approval, taint, and listener hardening

## Files changed

- Pinned the unauthenticated `AGENT_LOCAL` primary API to IPv4 loopback and
  rejected non-loopback bind overrides.
- Added a distinct Keychain capability plus nonce/payload/status-bound P-256
  signatures for human approval listing and decisions. Only the capability
  digest and public key reach the API child.
- Centralized user/external read scanning, durable taint, and untrusted fencing
  across Rhythm tasks, triggers, schedules, sessions, automations, rhythms,
  projects, facilities, memory, research, messages, calendar, Gmail, and PCO.
- Payload-bound every consequential Rhythm mutation granted to a role that can
  consume those reads. Removed direct PCO/Calendar bypasses from daily-briefing,
  worship-planning, and worship-production in favor of centralized Rhythm PCO
  reads.
- Added the exhaustive role graph and a real built API adversarial smoke.

## Consequential tool → SecurityAction inventory

| Rhythm tool | SecurityAction |
|---|---|
| `rhythm_send_email` | `email.send` |
| `rhythm_send_message` | `message.send` |
| `rhythm_create_message_thread` | `message-thread.create` |
| `rhythm_create_calendar_event` | `calendar.create` |
| `rhythm_update_calendar_event` | `calendar.update` |
| `rhythm_pco_update_plan_item` | `pco.plan-item.update` |
| `rhythm_pco_assign_person` | `pco.person.assign` |
| `rhythm_pco_update_scheduled_person` | `pco.scheduled-person.update` |
| `rhythm_clear_pending_trigger` | `trigger.clear` |
| `rhythm_create_task` | `task.create` |
| `rhythm_update_task` | `task.update` |
| `rhythm_complete_task` | `task.complete` |
| `rhythm_delete_task` | `task.delete` |
| `rhythm_create_rhythm` | `rhythm.create` |
| `rhythm_update_rhythm` | `rhythm.update` |
| `rhythm_create_project_instance` | `project-instance.create` |
| `rhythm_create_reservation` | `facility-reservation.create` |
| `rhythm_remember_memory` | `memory.remember` |
| `rhythm_forget_memory` | `memory.forget` |
| `rhythm_start_research` | `research.start` |
| `rhythm_update_research_job` | `research.update` |
| `rhythm_run_org_optimizer` | `org-optimizer.run` |
| `rhythm_delegate` | `delegation.start` |

`rhythm_request_approval` is the only intentional active exemption because it
creates the gate rather than executing a consequential mutation.
`rhythm_remember`, `rhythm_forget`, and `rhythm_search_context` are retained in
legacy role files but are proven by the graph not to be registered MCP tools.

## Checks run

- `ai-workflow checks --level issue` — pass: Flutter analyze/format, API and
  MCP TypeScript.
- `npm test` in `apps/mcp_server` — pass, 22 files / 99 tests.
- `npx vitest run src/__tests__/human_approval_signature.test.ts
  src/__tests__/issue_1134_external_content_security.test.ts
  src/__tests__/issue_895_agent_approvals.test.ts` — pass, 15 tests.
- `npx vitest run src/contract/issue_1175_adversarial_followup.test.ts -t
  'issue-1175-c17|issue-1175-c20|issue-1175-c21'` — pass, 3 tests; 2 unrelated
  parallel criteria skipped.
- `npm run build` in `apps/api_server` — pass.
- `RHYTHM_LIVE_E2E=1 npx vitest run
  src/__tests__/issue_1175_adversarial_live.test.ts` — pass, 3 tests against
  the real built API; listeners 4001/4096/4097/4098 were untouched.
- GitNexus unstaged scope — LOW, 67 files / 76 symbols / zero affected flows.
- GitNexus compare to `main` — CRITICAL, 600 files / 3,323 symbols / 24 flows,
  caused by the inherited cumulative #1076–#1175 base; aggregate review owns
  those parallel flows.

## Notes

Failure triage corrected one genuine regression found by the first PR gate:
the #834 immutable Obsidian contract requires secretary and worship-planning
same-vault grants, so those grants were restored while all direct Gmail,
Calendar, and PCO bypasses remained removed. The same gate also failed on a
shared `better-sqlite3` Node ABI and a parallel mobile dependency; rerunning
with the repository-compatible Node 22 toolchain made the relevant API suite
green. No follow-up issue was filed.
