---
date: 2026-08-04
repo: Rhythm
tags: [decision, Rhythm, security, agents, scheduler]
---

# Scheduled agents may write unattended; first-party reads no longer arm the approval gate

## Context

All 8 scheduled runs on 2026-08-04 ended in `completed_no_op` or
`blocked_on_approval`. Zero did their job unattended. Diagnosed live against the
running agent server on `:4001` (17 enabled tasks, 14 session transcripts read
via `GET /agent-sessions?scheduledTaskId=<id>` — `is_system=1` rows are excluded
from the plain session list).

Five independent defects, all verified against live data:

1. **Taint → approval deadlock.** `consumeApproval()` requires a security-bound
   approval for any protected mutation once a session carries a taint, and
   security-bound approvals hard-code `autoApprove: false` (#1134). So
   `agent_configs.auto_approve_actions` was structurally unreachable on exactly
   the sessions that needed it. `librarian` had the flag set to `true` since
   2026-08-03 18:39 and still produced 4 pending approvals.
2. **All-or-nothing scanner on batch payloads.** One match withholds the whole
   payload. Reproduced with the real payload: **2 of 50 rows** in
   `rhythm_list_memories` mention `.env` (`secrets-dotenv`), and all 50 were
   withheld. The Memory Consolidation agent could not read the store it exists
   to consolidate.
3. **Bash allowlists contradicting skill allowlists.** `librarian` allows the
   `defuddle` *skill* but denies the `defuddle` *binary* → 11 denied calls in one
   run. `email-assistant`, `graphic-designer`, `money` had allowlists of length
   **zero**.
4. **`completed_no_op` on every run.** `MUTATION_TOOL_PATTERN` was `^`-anchored
   while real tool names are namespaced (`obsidian_obsidian_put_file`) or bare
   builtins (`write`). Measured: it matched **0 of the 40** tool names used that
   day, so no run could ever be classified `success`. It also only inspected the
   root session, so delegated work was invisible.
5. **Headless hang on an `ask`.** `APPROVALS_MODE` is unset → `manual`, in which
   every escalated command classifies `ask`; the `ask` branch registered a
   permission card and `break`ed past the #1156 headless auto-accept, so an
   unattended run waited on a human until the 600s inactivity abort.

## Decision

**1 — First-party reads do not arm the outbound-write approval gate.**
`SOURCES_EXEMPT_FROM_APPROVAL_GATE` widened from `agent-session.list` alone to
all 17 genuinely first-party sources (memory, tasks, rhythms, projects,
facilities, automations + their static catalogs, agent-profile permissions). The
membership rule is *"did this content arrive from outside Rhythm?"*, **not** *"is
this content sensitive?"*.

Email, calendar, message threads, PCO, triggers, feedback and `research.job`
keep arming the gate. `research.job` was initially exempted in error and removed
on audit — its own label is `"external research job result"`, i.e. fetched web
content.

**2 — Unattended scheduled runs may satisfy the security-bound gate.**
*User decision, explicitly chosen 2026-08-04 over the narrower first-party-only
option.* Three conditions must ALL hold:

- `auto_approve_actions = 1` on the bound profile (opt-in, default 0)
- `is_system = 1`
- `scheduled_task_id IS NOT NULL`

Delegated children inherit `is_system` and `scheduled_task_id`, so subagents of a
scheduled run are covered — necessary, because the blocked writes were often in
children.

**3 — Flagged first-party LIST payloads are filtered per item**, returning the
clean rows plus a declared count of withheld ones, instead of withholding the
batch. Genuinely external batches stay all-or-nothing.

**4 — Deny-by-default bash is preserved**; each broken profile gets only the
binaries its own allowed skills actually invoke, derived from their fenced bash
blocks rather than guessed. `email-assistant` and `money` are deliberately left
unrepaired — their skills declare no bash, so there is nothing to derive and a
speculative grant would be unjustified.

## Alternatives considered

- **First-party exemption only** (no scheduled auto-approve). Fixes Memory
  Consolidation and Org Discovery but leaves `daily-email-triage`,
  `pco-song-usage-sync` and `worship-volunteer-care` unable to write unattended,
  since their input is genuinely external. Rejected by the user as insufficient.
- **Per-profile opt-in to external taint** (a second flag). More granular, but a
  larger surface and a second overlapping switch; deferred.
- **Standardize all profiles on `bash: "*": allow`** with the destructive-ask
  list. Simpler and uniform, but drops deny-by-default for 7 profiles. Rejected
  by the user in favor of per-profile derivation.
- **Widening per-item salvage to external content.** It would also close a real
  denial-of-service edge (one crafted email making an inbox permanently
  unreadable), but an external batch can carry an attack split across rows and
  the taint record asserts `blocked` for the whole payload. Left as a follow-up.

## Consequences

**Accepted risk, stated plainly:** for an auto-approve profile on a scheduled
run, attacker-influenced text (an email body, a web page, PCO data) can now reach
a protected mutation with **no human in the loop**. This is the deliberate cost
of unattended operation.

What keeps it reviewable: every auto-authorization writes an `agent_approvals`
row with `actor = 'auto-approved:scheduled-task:<id>'`, the exact
`security_action`, the canonical `payload_digest`, the `taint_id`, **and the
taint source** — so an after-the-fact review can answer "which read influenced
this write?". A `logger.warn` is emitted per bypass.

Guards that remain intact, each covered by test:

- Interactive sessions get the full #1134 gate — `is_system` and
  `scheduled_task_id` are both unreachable for them.
- `#878`'s hardline blocklist and `deny` classification are still absolute and
  unreachable by the unattended path.
- Plan mode still auto-denies, and outranks the unattended auto-accept.
- Bare `bypassPermissions` is **not** treated as unattended — an interactive
  session in bypass mode still surfaces a card for `git push --force`. Getting
  this wrong is what the existing bridge test caught mid-implementation.
- Flagged rows are still never shown; only their innocent siblings are.

`APPROVALS_MODE` remains unset/`manual` and there is still no UI to change it.
That is now survivable rather than fatal, but it is a latent sharp edge.

## Follow-ups

- No stale-`running` reaper for `agent_schedules.last_run_status`. The boot
  reaper resets `agent_sessions` only, so `ffb-podcast-vibes` sat pinned at
  `running` from 2026-08-03T18:30 with its `bash` tool part still `running`.
- Child scope projection injects a tool name into the `servers` array — observed
  `rhythm_rhythm_get_dashboard` inside `mcpAllowedToolsJson.servers`. Harmless
  today (it matches no server) but wrong.
- Delegation capability mismatch: `Theological-Researcher` may run `defuddle` but
  delegates archiving to `librarian`, which could not. Nothing checks that a
  delegate can actually perform the delegated work.
- Junk MCP entry `foo` still present and failing; `stripe`, `mailchimp`,
  `ableton-mcp` failing; `notion` needs auth.
- Seven skills referenced by `librarian` have no directory in
  `~/.config/opencode/skills/` — several are named for working *around* blocked
  filesystem commands (`create-directories-when-mkdir-is-blocked`), i.e.
  artifacts of this same over-restriction.
