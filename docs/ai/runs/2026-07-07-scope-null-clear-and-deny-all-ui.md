---
date: 2026-07-07
repo: ajhochy/Rhythm
branch: fix/agent-scope-clear-and-degraded-ui
pr: "932"
issues: [928, 931]
status: complete-pr-draft-open
tags: [run, rhythm]
---

## Files

- `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts` — UpdatePayload schema: `Schema.optional(X)` → `Schema.optional(Schema.NullOr(X))` for mcpAllowlist + skillAllowlist (#928)
- `apps/opencode_fork/packages/opencode/src/session/session.ts` — setMcpAllowlist/setSkillAllowlist input types widened to accept `null` (#928)
- `apps/opencode_fork/packages/opencode/test/server/httpapi-session.test.ts` — regression test: PATCH set → PATCH null → GET omits; [] stays deny-all; null clears again (#928)
- `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart` — deny-all banner when allowlist is [] (not null); distinguishes unrestricted/deny-all/no-servers (#931)

## Checks

- `bun run typecheck` (fork) — clean (1 pre-existing unrelated error in system.test.ts)
- `bun test httpapi-session.test.ts -t "#928"` — 1 pass
- `dart format --set-exit-if-changed` — exit 0
- `flutter analyze --no-fatal-infos` — 0 new issues (2 pre-existing infos)
- `flutter test` (full suite) — 846/846 pass (after fixing banner ordering bug caught by suite)

## Commits

- `7f64660b2` — fix(#928): PATCH /session/:id skillAllowlist/mcpAllowlist null clears stale scope
- `00984a52a` — fix(#931): surface deny-all scope state in Agent Profiles UI

## Notes

- **#923 was already fixed on main** (commit dd7ca184c, PR #926). Not reimplemented.
- #914/#915/#917/#918/#919/#920/#921 also already fixed on main. Closed all 8 with commit references.
- Earlier coding-agent runs hallucinated commit hashes (6ad2bad85 was a blob hash, abc123 was fabricated). Root cause: model/token issue before AJ switched models. After switch, agents returned empty envelopes; orchestrator verified actual repo state directly via git and completed the implementation inline.
- #931 banner ordering bug caught by full Flutter test suite (846 tests). Fixed by reordering: empty-servers/loading state takes priority over deny-all banner. Amended commit.
- External verification failed: Codex out of credits, Gemini -p can't execute code. Orchestrator ran full verification inline.
- Uncommitted pre-existing working-tree changes (retry.ts, task.ts, docs/ai/*) were NOT included in commits.
- Workflow retrospective completed: 6 hard rules added to workflow-orchestrator skill SKILL.md.

## Workflow retrospective summary

### Failures
1. Subagents returned empty ~8 times (model/token issue before AJ switched model)
2. Coding agents hallucinated commit hashes (fabricated plausible-looking output)
3. Missed "already fixed on main" signal despite investigators flagging it
4. External verification tools didn't work (Codex out of credits, Gemini -p can't execute)
5. Flutter test failure from banner ordering bug (committed without running full test suite)

### Improvements landed
6 hard rules added to the workflow-orchestrator skill:
1. Verify subagent claims via git before reporting to AJ
2. Fall back to direct implementation after 2 empty subagent returns
3. Check "already fixed" before coding (git log + gh issue view)
4. Skip acceptance-contract step when plan already contains acceptance criteria
5. Run full test suite before committing, not just format + analyze
6. Don't launch external verification without confirming it can execute
