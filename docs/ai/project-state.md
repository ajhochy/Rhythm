# Project State

## Current focus

Live-testing follow-ups on `issue-batch-july4` (three commits, not yet PR'd):

1. #904 — Trigger Now on a scheduled task no longer corrupts local state.
   Root cause: `trigger-now` returned a message-only body that the Flutter
   client parsed as a garbage `AgentScheduledTask` (the "Daily" phantom
   row). Now returns the updated task; empty `scheduledTaskId` no longer
   leaks unrelated sessions; activity log rows are now tappable.
2. #911 follow-up — manual refresh button on the Agent Profiles manager
   sheet so out-of-band profiles (e.g. from the Rhythm Setup agent) appear
   without an app relaunch.
3. Cleanup — removed the dead capability-status file-write path; narrowed
   `CapabilityState` to `'ok' | 'down'`.

Prior session (already on `main` via PR #901): scheduled-task↔agent-profile
binding via the MCP create tool, and the `rhythm doctor` OAuth-provider
false-positive fix.

## Active branch / PR

- `issue-batch-july4` — 21 commits ahead of `main`; PR opened this session
  after full verification (api_server 2435 tests + tsc clean; flutter 846
  tests, analyze at 272-info baseline, `dart format` clean).
- PR #901 (`feature/config-doctor-agent`) merged to `main` last session.
- PR #924 (`issue-912-913-opencode-continuity`) open — opencode session
  continuity fixes for #912/#913 (CI green). Separate branch off `main`.

## In progress

- Implementation and verification are complete locally for both slices.
- No live SQLite database was edited directly and no existing scheduled
  task was deleted.
- Other Config Doctor findings from the 2026-07-04 diagnosis session are
  still open (see Risks below) — not yet turned into issues/fixes.

## Risks / known issues

- Branch-vs-main GitNexus comparison is CRITICAL for future long-lived
  branches — the pre-merge `feature/config-doctor-agent` branch had
  accumulated 236 changed files at one point; the two shippable change
  sets folded into #901 are each LOW risk with no affected execution
  flows outside their own area.
- Rhythm intentionally owns its projected agent-file normalization
  separately from the external agent-stack repository.
- Four other `rhythm doctor` findings from the same 2026-07-04 diagnosis
  session are still outstanding: Python version check (system `python3`
  on `$PATH` resolves to Apple's stale 3.9.6 stub ahead of a newer
  Homebrew install — cosmetic, nothing in Rhythm actually depends on bare
  `python3` off `$PATH`), Canva/Notion/Supabase MCP servers returning 401,
  and duplicate agent profiles for "Theological Researcher" and "AI Trend
  Researcher".

## Test status

- api_server: 2435/2435 (2 new), `tsc --noEmit` clean.
- flutter: 846/846 (3 new/updated), analyze at the 272-info baseline,
  `dart format` clean.
- Prior session (#901): MCP server 68/68; api_server 2403 passed;
  `ai-workflow checks --level issue`/`--level pr` passed; doctor OAuth
  check ✅; CI run 28722816512 passed.

## Next step

Push `issue-batch-july4` and open a PR for the three commits above, then
let the user re-test the Trigger Now / activity-log flow live. Still open:
the 4 remaining `rhythm doctor` findings from the 2026-07-04 diagnosis.
