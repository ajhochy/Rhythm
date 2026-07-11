# Project State

## Current focus

**Unified Session Observability epic (#1034) + #1002 AgentRunner fix
(2026-07-11)** — every LLM call now observable in one filtered session list,
and the P1 headless-AgentRunner bug is fixed. 13 issues delivered across 6
parallel worktree workstreams, integrated + live-verified.
See `docs/ai/runs/2026-07-11-uso-epic-1002-live-e2e.md` and
`docs/ai/decisions/2026-07-11-1002-fix-lost-on-main.md`.

## Active branch / PR

- **`workflow/uso-epic-2026-07-11`** — opening PR closing #1002, #1023-#1034.
  Verified (tsc + 2683 vitest + Flutter 858 + live e2e). Awaiting CI + manual
  UI smoke. Do NOT merge without smoke.
- **Stale PR #1005** — superseded (its #1002 fix is re-landed on this branch);
  can be closed.

## In progress

- Manual UI smoke handoff for the Flutter Phase A surface (category dropdown /
  status sort / retired Session History / reused transcript detail) and the two
  deferred live loops (B4 measure re-run, B5 skill-extract).

## Risks / known issues

1. **#1023 release-build acceptance is deferred to a real workflow_dispatch**
   - bundled-node presence, notarization, ABI-equality on the runner, and
   real-machine start are only provable by an actual signed release build.
2. **B4/B5 not directly live-run** - unit-verified; their run() path was
   exercised live via B2/B3. Smoke: approve a measure-routed proposal; drive a
   2-round skill-extract.
3. Phase B run() adds skill/memory prefaces (input-only, parsers unaffected)
   and can teacher-escalate on error - could make a failing measure re-run read
   slightly cleaner (lenient KEEP); human revert (#857) backstops.
4. Full-suite has 2 order-dependent flaky tests (AgentProfileSync engine-not-
   ready timing) - green on clean re-run; pre-existing, not from this change.
5. Org-optimizer cron stays OFF pending safety review (unchanged).

## Test status

- api_server `tsc --noEmit` clean; full `vitest run` 2683 passed / 0 failed.
- Flutter `dart format` clean; `flutter analyze --no-fatal-infos` 0 errors/0
  warnings; `flutter test` 858 passed.
- Live e2e (standalone :4011, isolated DB copy): 3 scopes correct, #1002
  headless output confirmed (0 no-output errors), self_improvement transcripts
  present, B6 audit clean.

## Next step

1. Open the PR (Closes lines for #1002 + #1023-#1034) and watch CI to green.
2. Hand off manual UI smoke (checklist in the run log).
3. After smoke passes, merge; then trigger a release build to prove #1023.

## Recent coding-agent runs

### 2026-07-11 — USO Phase A Agents smoke follow-ups (branch uso/smoke-fix-agents-chat)
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart` —
    (1) hide the "By Project" dropdown (and skip project filtering) outside the
    CHATS scope; (2) `_onRowTap` now opens the interactive chat detail
    (`selectSession`) for EVERY scope instead of pushing the read-only
    `SessionTranscriptView` for scheduled/self_improvement (reverses #1027 A4
    row-tap routing). Removed now-unused session_history imports.
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — composer
    graceful-degrade: `_canSendTo(session)` gates the input/Send/Enter on the
    session having an `sdkSessionId`; unresumable rows open with full history but
    a disabled composer + inline reason (`composer-disabled-reason`).
  - `apps/desktop_flutter/test/features/agents/agents_nav_column_mounted_test.dart`
    — rewrote the #1027 transcript test into 3 mounted tests: By-Project hidden
    outside chats; scheduled+sdk row opens interactive detail w/ usable input;
    unresumable (no sdk) row opens detail w/ disabled input + reason.
- Checks run: `dart format` (0 changed) ✓ · `flutter analyze --no-fatal-infos`
  0 errors / 0 warnings (pre-existing infos only) ✓ · `flutter test` 860 passed ✓.
- Reused interactive path: `AgentsController.selectSession(id)` — the exact
  open path normal chat rows use; the backend WS input path auto-resumes the
  engine session via its persisted `sdkSessionId` (OPC-M1-5, ws_gateway
  auto-resume), so no new resume path was forked.
- Deviations from spec: coordinator listed "errored" rows as unresumable, but an
  errored run that HAS an sdkSessionId is left enabled — the backend clears the
  error state on the next prompt (ws_gateway 333-343), so disabling it would
  remove the supported retry path. The disable predicate is "no sdkSessionId",
  which reliably identifies legacy/dead rows without misclassifying fresh chats
  (create assigns sdkSessionId eagerly) or continuable runs.
- Concerns: `SessionTranscriptView` is no longer the row-tap target; it's left
  in place (still referenced by tests) rather than retired, to keep the diff
  minimal.
