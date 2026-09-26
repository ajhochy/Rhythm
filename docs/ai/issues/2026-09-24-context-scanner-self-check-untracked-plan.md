---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
status: open
priority: P3
tags: [issue, rhythm, testing]
---

## Failure

`ai-workflow checks --level pr` stage `api_server vitest (serial shared-state gate)` fails locally in
the mega worktree on one test while CI (clean checkout) is unaffected.

## Repro Command

```bash
cd apps/api_server && npx vitest run src/security/context_scanner.test.ts
```

## Expected

`scanContextContent (#873) › repo self-check — no false positives on real files › every markdown file
directly under docs/ai/ loads clean` passes (19/19), as it does in a worktree without the untracked
planning docs.

## Actual

18 passed / 1 failed: `current-plan-1569.md: secrets-dotenv, secrets-credentials-file`.

## Relevant Output

```text
[WARN] [context_scanner] BLOCKED "current-plan-1569.md" — pattern "secrets-dotenv" (secrets-reference): reference to a .env file
[WARN] [context_scanner] BLOCKED "current-plan-1569.md" — pattern "secrets-credentials-file" (secrets-reference): reference to a credentials file
```

## Likely Cause

The self-check reads the working tree (`docs/ai/*.md`), not the index. `docs/ai/current-plan-1569.md`
is an untracked, deliberately preserved planning document for #1569 (Hermes credential sharing) that
legitimately discusses Hermes `.env` and credential files, so the secrets-reference patterns match it.
Pre-existing before the 2026-09-24 swarm resume; not caused by any integrated slice.

## Likely Files

- `docs/ai/current-plan-1569.md` (untracked, AJ-owned)
- `apps/api_server/src/security/context_scanner.test.ts` (repo self-check)

## Required Fix

When #1569's plan is committed, either reword the two references (e.g. "the Hermes environment file")
or extend the self-check's allowlist for planning docs that discuss credential handling by design.
Do not weaken the scanner itself.

## Required Tests / Evaluation

`npx vitest run src/security/context_scanner.test.ts` → 19/19 in the mega worktree with the plan doc
present.
