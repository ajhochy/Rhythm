---
date: 2026-07-12
repo: Rhythm
branch: uso/agent-followups
pr: (opening, stacked on workflow/uso-epic-2026-07-11)
issues: [1039, 1040]
status: live-verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# USO follow-ups — background-agent execution + live streaming, live-verified

Stacked on the USO epic (PR #1036). Every fix below was verified against the
RUNNING app (:4001 / engine :4096), most through multiple falsification rounds
driven by the user's manual smoke.

## #1039 — background/scheduled runs fail (3 distinct causes, all fixed)

- **A. "Agent not found"** — schedulable profiles now written `mode: all`
  (writer: `sessionSelectable ? 'all' : 'subagent'`; `all` = selectable AND
  still a delegation target); scheduling a delegation-only profile is rejected
  with an actionable 400; the writer fires `reloadConfig` after every .md
  write; and — the last gap — the fork's `/config/reload` is PER-DIRECTORY
  instance state, so the client now reloads default + `process.cwd()` (the
  headless instance). PROOF: live demote→re-promote→trigger with the engine
  hot = 0 "Agent not found"; the promoted Theological-Researcher completed
  idle with output. GOTCHA: promotions must go through the API (PATCH
  agent-configs) — raw SQL gets reverted by profile sync.
- **B. Empty output on long runs** — Node fetch (undici) aborts at ~300s
  (UND_ERR_HEADERS_TIMEOUT) under any headless turn longer than 5 min; the
  engine turn was healthy. Raised global dispatcher timeouts to 900s (above
  AGENT_RUN_TIMEOUT_MS 600s) so `_withinRunDeadline` is the single timeout
  authority. PROOF: AI-Trend scan ran 7+ min, completed, delivered its
  notification + summary. (Two earlier "fixes" — system-prompt dedupe,
  tools-allowlist theory — were falsified live before this root cause.)
- **C. Stuck 'starting'** — boot recovery covers `starting`; runtime reaper
  (20-min cutoff) sweeps post-boot orphans; headless runs now flip
  starting→working at session creation.

## #1040 — headless sessions stream live

AgentRunner sessions subscribe to the same `opencode_stream_bridge` as
interactive chats (lazy-imported — top-level import instantiates repos at
module load and broke 96 mocking test files). Blocking `prompt()` stays the
completion authority. Dedupe both sides: final output upserted by
sdk_message_id; legacy input append skipped when the bridge wrote one.
PROOF (session e9e78916): 1 input + 6 sdk-id'd output messages (5 tool steps
+ 1 final 1929-char answer), zero duplicates.

## UI fixes (same branch)

- Uniform interactive chat for every session category (partially reverses
  #1027 row-tap; unresumable = closed/error with no sdkSessionId only).
- Composer no longer claims fresh starting/working sessions "ended".
- Open detail view polls headless runs (4s) until completion (Codex).
- By-Project filter hidden outside the Chats scope.

## Checks

api_server tsc clean; full vitest 2692/0 (the 96-file failure was the
top-level bridge import — fixed via lazy import). Flutter 861/0 + analyze
clean. Multiple live e2e rounds on the running app.

## Follow-ups filed

#1038 (Projects dark mode), #1041 (workflow-prompt-fix ref resolver). Also
noted: async delegation + completion notify (feature ask, not yet filed as
an issue).
