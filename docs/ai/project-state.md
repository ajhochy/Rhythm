# Project State

## Current focus

Config Doctor diagnostic/repair agent work on `feature/config-doctor-agent`.
Most recent slice: `rhythm doctor`'s "AI provider (Anthropic or OpenAI)"
check no longer false-positives for users authenticated via opencode OAuth
instead of a raw API-key env var.

## Active branch / PR

- Branch: `feature/config-doctor-agent` (pushed, tracking `origin`)
- PR: [#901](https://github.com/ajhochy/Rhythm/pull/901) (draft) — OAuth-authed
  AI provider fix. CI green (Type-check and build, run 28722816512).
- The checkout still contains unrelated pre-existing uncommitted changes
  (`AGENTS.md`, `CLAUDE.md`, `apps/opencode_fork/bun.lock`, a few untracked
  `docs/ai/*` files) that predate this session and were deliberately left
  untouched — not part of PR #901.

## In progress

- PR #901 awaiting manual smoke + human merge decision.
- Other Config Doctor findings from the same diagnosis session are still
  open (see Risks below) — not yet turned into issues/fixes.

## Risks / known issues

- Four other `rhythm doctor` findings from the same diagnosis session are
  still outstanding, out of scope for PR #901: Python version check, Canva/
  Notion/Supabase integrations returning 401, and duplicate agent profiles
  for "Theological Researcher" and "AI Trend Researcher".
- The unrelated uncommitted changes sitting in the worktree (see above) may
  represent other in-progress Config Doctor work from an earlier session —
  investigate before discarding.

## Test status

- api_server: `npx vitest run` — 2403 passed, 1 skipped, 280 files.
- api_server: `npx tsc --noEmit` — clean.
- `npm run doctor` (local, real machine auth.json) — "AI provider (Anthropic
  or OpenAI)" now shows ✅ (previously ❌ despite valid OAuth login).
- CI on PR #901 (run 28722816512): Type-check and build — passed.

## Next step

Manual smoke / review of PR #901, then human merge decision. Separately,
decide whether to pick up the other 4 known doctor findings as follow-up
issues, and reconcile the unrelated uncommitted worktree changes on this
branch (commit, split out, or discard after review).
