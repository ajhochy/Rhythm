---
date: 2026-07-04
repo: Rhythm
branch: feature/config-doctor-agent
pr: https://github.com/ajhochy/Rhythm/pull/901
issues: []
status: pr-open-awaiting-smoke
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- `apps/api_server/src/cli/checks/api_keys.ts` — `checkApiKeys()` gained an
  `authedProviders` param (default: `OpencodeAuthStore().listAuthedProviders()`).
  The "AI provider (Anthropic or OpenAI)" check now passes on env var OR an
  OAuth entry for `anthropic`/`openai` in opencode's `auth.json`.
- `apps/api_server/src/cli/checks/api_keys.test.ts` — added 5 OAuth-path
  test cases; isolated 3 pre-existing tests that were unintentionally
  reading the real local `auth.json` once the default param went live.
- `apps/api_server/src/cli/doctor.test.ts` — 2 integration tests needed an
  explicit `deps.apiKeys` override to stay isolated from the real `auth.json`.

## Checks

- `npx vitest run` — 2403 passed, 1 skipped, 280 files.
- `npx tsc --noEmit` — clean.
- `npm run doctor` locally — "AI provider (Anthropic or OpenAI)" ✅ (was ❌).
- CI on PR #901 (run 28722816512) — Type-check and build passed.

## Notes

Root cause: `checkApiKeys` only read `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`
env vars. Investigated which execution context the check actually gates —
grepped `src/` for those two env vars outside `cli/setup`/`cli/checks` and
found no runtime read; real agent dispatch goes through the opencode CLI
(`agent_runner.ts` → `opencode_engine.ts`), which is commonly OAuth-authed.
Confirmed OAuth is the correct thing to check, not a red herring. Reused
the existing `OpencodeAuthStore` service (already used elsewhere for the
same auth.json read) instead of adding a new abstraction.

Branch `feature/config-doctor-agent` had unrelated pre-existing uncommitted
changes in the worktree (`AGENTS.md`, `CLAUDE.md`, `bun.lock`, a few
untracked docs) — left untouched; only the 3 files above were committed.
Branch had never been pushed before this run; pushed and opened draft PR
#901 after confirming with the user.

Deferred — still open: the other 4 doctor findings from the same diagnosis
session (Python version check, Canva/Notion/Supabase 401s, duplicate
"Theological Researcher"/"AI Trend Researcher" agent profiles) — no `Closes`
line for these, intentionally out of scope for this PR.
