# Project State

## Current focus

Two independent slices landed on `main` this session:

1. Scheduled agent tasks can now bind to canonical Rhythm agent profiles
   through the MCP create tool. Rhythm's projected workflow-orchestrator
   instructions are self-safe and grant file creation.
2. `rhythm doctor`'s "AI provider (Anthropic or OpenAI)" check no longer
   false-positives for users authenticated via opencode OAuth instead of
   a raw API-key env var.

## Active branch / PR

- Both slices merged into `main` via PR #901 (`feature/config-doctor-agent`).

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

- MCP server: typecheck; 68/68 tests passed.
- api_server: `npx vitest run` — 2403 passed, 1 skipped, 280 files.
- api_server: `npx tsc --noEmit` — clean.
- `ai-workflow checks --level issue` and `--level pr`: passed.
- `npm run doctor` (local) — "AI provider (Anthropic or OpenAI)" now shows
  ✅ (previously ❌ despite valid OAuth login).
- Smoke: isolated create → trigger-now → list retained
  `AI-Trend-Researcher`; live `/health`, `/opencode/health`, and
  `/agents/capabilities` returned healthy after runtime restoration.
- GitNexus `detect_changes --scope all`: LOW risk, 0 affected processes.
- CI on PR #901 (run 28722816512): Type-check and build — passed.

## Next step

Pick up the 4 remaining `rhythm doctor` findings as follow-up issues if
desired. A macOS desktop release is being triggered to ship both slices.
