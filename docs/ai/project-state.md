# Project State

## Current focus

**Semantic memory retrieval upgrade — implemented, E2E green, merging + releasing per AJ's instruction (2026-07-23).**
Fixes the "irrelevant memories injected into agent prompts" complaint: multi-token
FTS ranking with junk suppression, hybrid (Engraph) retrieval as the default mode,
and a 500ms prompt-path latency budget.

## Active branch / PR

- Branch: `claude/agent-skill-injection-semantic-0s6iv4` (api_server only, +smoke/E2E tests).
- Merging to `main` and triggering `desktop_release.yml` (next version `0.18.48`) — explicitly authorized by AJ in-session.
- Also on this branch: parked design doc `docs/ai/decisions/2026-07-23-semantic-scope-injection.md` (capability scoping stays config-level).

## Test status (2026-07-23)

- api_server: `tsc` clean; `vitest` **3106 passed / 40 skipped, 0 failures** (full suite, remote Linux container).
- New E2E (`memory_semantic_e2e.test.ts`): real SQLite + fake Engraph HTTP server — default-hybrid injection, junk suppression, 3s-hang bounded by 200ms budget all verified.
- Not verifiable remotely: real `engraph` binary + macOS app — release `0.18.48` is the first real-world validation.

## Risks / known issues

- Hybrid default is fail-closed (no Engraph → pure FTS), but real-Engraph behavior (result quality, sourceId mapping against the real vault) is unvalidated until AJ runs it.
- Junk suppression can shrink the preface to 1–2 memories where it used to have 5 — intended, but watch for recall complaints.
- Prior mega-PR `mega/opencode-utilization-1042-1108` (see 2026-07-17 state) still awaits human manual smoke + merge — unaffected by this branch, but expect a merge-order decision if it lands after this.

## Next step

AJ: install release `0.18.48`, enable Engraph in Settings (Homebrew binary required), and confirm memory prefaces are relevant + first-prompt latency feels unchanged. `AGENT_MEMORY_RETRIEVAL_MODE=fts` is the escape hatch.
