---
date: 2026-08-07
repo: Rhythm
branch: feat/delegation-model-override
pr: null
issues: []
status: passed
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- `apps/api_server/src/routes/agents_models_routes.ts`
- `apps/api_server/src/__tests__/agents_models_catalog.test.ts`
- `apps/api_server/src/__tests__/agent_delegation_auth.test.ts`

## Checks run

- The pre-repair catalog contract failed because unauthenticated built-in Zen was
  reported as authorized.
- The focused catalog/delegation suite passed after repair. Final integrated and
  live verification is recorded in
  `2026-08-07-delegation-model-override.md` and passed C1–C9.

## Notes

- Custom catalog providers are authorized only when authenticated, keyless, or
  explicitly configured in `opencode.json`. Unauthenticated Zen now produces a
  clear 400 with no child; the #1143 config-defined custom-provider behavior is
  preserved.
- This note records the repair only; final command counts and environment cleanup
  are kept in the primary delegation run note to avoid duplicated history.
- No GitHub issue was supplied; the local `docs/ai/contracts/issue-001.json` is a
  workflow contract only.
