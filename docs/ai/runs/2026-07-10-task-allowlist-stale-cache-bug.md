---
date: 2026-07-10
repo: rhythm
branch: feature/unified-session-observability
pr: null
issues: [1014, 999, 945]
status: filed
tags: [run, rhythm]
---

# Task-tool delegate allowlist not live-reloaded in open sessions

## Context

AJ edited an agent profile's task-tool subagent allowlist (allowed-delegates)
in the Rhythm UI mid-session — adding `config-doctor` as an allowed
`subagent_type` for the `secretary` profile. The change did not take effect
in the already-running session: repeated `task` calls with
`subagent_type: "config-doctor"` kept failing with a permission-denied error
still showing the pre-edit allowlist (workflow-orchestrator,
worship-planning, worship-production, librarian, theologian, fantasy-gm,
Theological-Researcher, AI-Trend-Researcher, graphic-designer, plus two raw
UUIDs — no config-doctor), even after retrying.

This contradicts the documented behavior that `PATCH /agent-configs/<id>`
changes take effect immediately in live sessions without a restart. That
guarantee appears to hold for fields like system prompt / model, but not for
the task-tool delegate allowlist specifically — it looks like the allowlist
is resolved/cached once at session start (likely somewhere around
`agent_delegation_service.ts` / `agent_profile_scope.ts`) rather than
re-read per `task` invocation.

Also compounding the confusion (separate, pre-existing issue): `config-doctor`
has no friendly agent-config id, so the user didn't know which raw UUID in
the allowlist (if any) mapped to it — see #945.

## Action taken

Filed **#1014** — "Task-tool delegate allowlist changes made in the UI don't
take effect in already-open agent sessions" — describing symptom, contrast
with known-good live-reload behavior, repro steps, expected behavior (either
re-read the allowlist per-call, or clearly surface that it's session-scoped),
and linked #999 / #945 as related context.

No code changes were made in this run — investigation + issue-filing only.

## Files

- None changed. Investigated `apps/api_server/src/services/agent_delegation_service.ts`
  and `apps/api_server/src/services/agent_profile_scope.ts` as the likely
  location of the cached/session-scoped allowlist resolution, but did not
  dig further — left for whoever picks up #1014.

## Checks

- N/A (no code changes).

## Notes

- Repo confirmed as `ajhochy/Rhythm` (remote `origin`/`plugin`), current
  branch `feature/unified-session-observability` at time of filing.
- Next step for #1014: trace where a session's resolved task-tool allowlist
  is stored (session state snapshot vs. per-call config lookup) and either
  make it re-read live or add an explicit UI/error warning that it's
  session-scoped.
