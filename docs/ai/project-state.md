# Project State

## Current focus

Post-#812 stabilization plus the first org-self-optimizer foundations (epic
#816) and designated obsidian write access. Memory-vault epic #801 is DONE
(all sub-issues #802–#808 shipped inside #812) and closed.

## Active branch / PR

Four open PRs from the 2026-07-02 run awaiting manual review/merge:

- #836 — local Ollama/Qwen provider (opt-in, cloud-first), branch
  `codex/local-ollama-wip-2026-07-01`.
- #837 (draft) — #817 `agent_org_proposals` store + lifecycle state machine,
  branch `issue-817-org-proposals-store`. Server CI green.
- #838 (draft) — #818 `denied_tool_events` deny-path telemetry, branch
  `issue-818-denied-tool-log`. Server CI green.
- #839 (draft) — #834 obsidian write grant for secretary + worship-planning,
  branch `issue-834-obsidian-write-designated`. Server CI green.

Pre-existing: #832 (org-optimizer plan docs), #835 (local MCP sidecar, draft).

## In progress

- Nothing executing. All 2026-07-02 tracks are gated, CI-green, and parked in
  draft PRs for human review.

## Risks / known issues

- **Merge-order conflict:** #837, #838, and #839 each append to
  `docs/ai/project-state.md` on their own branches. Merge in any order and
  resolve project-state.md in favor of THIS snapshot (branch
  `docs/state-2026-07-02-run`); each branch's own `docs/ai/runs/` file does
  not conflict.
- #838 logs `agent_config_id` as null from the bridge seam; org-optimizer-03
  must join `session_id → agent_sessions` for the per-profile dimension.
- #839 mirrors librarian's grant, which includes `obsidian_delete_file` +
  `obsidian_execute_command` — reviewer flag in the PR body; trim if unwanted.
- `agent_profile_sync*.test.ts` can time out under full parallel vitest load;
  green in isolation (pre-existing flake).
- 12 npm dependency audit findings (1 low, 8 moderate, 3 high) still open.
- Open hygiene issues: #768 (remove cowork MCP), #814 (pin rhythm MCP server
  version).

## Test status

Per-branch verification gates all PASS (2026-07-02):

- #817 @ 836e303ef: tsc + prod build + full vitest 178 files/1539 tests;
  falsification real; Server CI run 28602245964 exit 0.
- #818 @ 4e49efc72: tsc + prod build + full vitest 179 files/1530 tests;
  `mcp_dispatch_guard.ts` byte-identical (guard purity preserved); Server CI
  run 28602454039 exit 0.
- #834 @ 055dd15da: 13/13 role files valid JSON; tsc + prod build + full
  vitest 178 files/1523 tests; alignment/guard suites 77 tests; Server CI run
  28602742779 green.
- mem-vault-01 re-verification on origin/main: 23/23 targeted memory tests,
  tsc clean, falsification confirmed load-bearing.

## Next step

1. Human review + manual merge of #836–#839 (resolve project-state.md in
   favor of this snapshot), then manual smoke per checklist.
2. Next epic #816 issue: org-optimizer-03 (read-only org audit + signal
   collector, #819) — now unblocked by #817 + #818. #820 (risk predicate) and
   #821 (auto-apply) follow, implementing the locked full-autonomy-with-
   rollback policy (see decisions/2026-07-02-autonomy-and-vault-intent.md).

## Recent coding-agent runs

### 2026-07-02 — #845 skill-effectiveness dashboard (tokens-05)
- Files modified:
  - `apps/api_server/src/routes/opencode_skills_routes.ts` — added
    `measureReason: string | null` to `SkillMetadata`, `DEFAULT_METADATA`, and
    the `?withMetadata=true` join (the sidecar row already carried it;
    `postScore`/`uses` were already exposed pre-#845).
  - `apps/api_server/src/__tests__/opencode_skills_routes.test.ts` — updated 3
    pre-existing `toEqual` metadata fixtures to include `measureReason: null`
    (API boundary change, no behavior change for those cases).
  - `apps/api_server/src/__tests__/issue_845_contract.test.ts` (new) — 3
    contract tests for the `measureReason` join (kept-measurement narrative,
    revert marker, and the no-sidecar-row null default).
  - `apps/desktop_flutter/lib/features/agents/data/opencode_skills_data_source.dart`
    — added `OpencodeSkillMetadata.measureReason` (+`hasMeasurementHistory`,
    `isRevertEvent` getters).
  - `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart`
    — added sortable Score/Usage columns (`skills-sort-score`,
    `skills-sort-usage`, null-safe comparator treating missing values as
    lowest), `_NumericCell` row renderer, and a `_MeasurementHistory`
    expansion-area widget (kept vs. reverted rendering).
  - `apps/desktop_flutter/test/features/agent_skills/agent_skills_view_test.dart`
    — 6 new widget tests (issue-845-c1a–e, c2a–c). `docs/ai/contracts/issue-845.json`
    (new).
- Checks run:
  - `npx vitest run src/__tests__/issue_845_contract.test.ts` — 3/3 pass.
  - `npx vitest run opencode_skills` — 12/12 pass (no regression).
  - `./node_modules/.bin/tsc --noEmit` — clean.
  - `npx vitest run` (full server suite) — 1564/1566 pass; the 2 failures are
    `agent_profile_sync_hygiene.test.ts` timeouts, the pre-existing documented
    flake (see Risks above), reproduced in isolation and unrelated to this
    diff (file untouched by this change).
  - `dart format` — clean (1 file reformatted, then stable).
  - `flutter analyze --no-fatal-infos lib/features/agent_skills/ test/features/agent_skills/ lib/features/agents/data/opencode_skills_data_source.dart` — 0 issues.
  - `flutter test test/features/agent_skills/` — 26/26 pass (17 pre-existing
    #813/#796 + 9 new server/UI contract tests represented as 6 widget tests).
  - Falsification: hardcoded `measureReason: null` in the route's join map —
    2/3 contract tests (`issue-845-c1`, `issue-845-c2`) went red as expected;
    restored, re-confirmed 3/3 green. Proves the join line is load-bearing.
- Decisions made: measurement "history" is the existing single-entry sidecar
  ledger (`baselineScore`/`postScore`/`measureReason` on the current
  `agent_skills` row), not a new per-measurement history table — the
  `agent_skill_versions` table has no score columns, and adding one would
  require touching `migrations.ts`, which is out of scope/forbidden for this
  issue. This satisfies the AC's "baseline vs post score, revert events"
  requirement with the data the auto-apply loop already persists.
- Deviations from spec: none functionally; simplified `_NumericCell`'s
  `isInteger` parameter (originally planned) since both formatting branches
  were identical — removed the redundant parameter during implementation.
- Concerns: the measurement ledger is single-entry (current state only), not
  a true append-only history — if a skill is measured, reverted, then
  re-measured and kept, only the latest event is visible in the expansion
  area. A true history view would need `agent_skill_versions` to carry score
  columns (a separate, larger issue).
