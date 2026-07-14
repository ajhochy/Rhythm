---
date: 2026-07-11
repo: Rhythm
branch: ocu-27-sdk-adoption
status: ready-for-coding
issues: [1068]
order: 27
depends_on: [OCU-26]
tags: [issue, Rhythm, opencode-utilization, m6-platform]
---

# OCU-27 — Adopt regenerated SDK types in api_server; delete hand-written d.ts drift

## Summary
With OCU-26 the fork's generated SDK is authoritative. api_server's 764-line hand-written @types/opencode-ai-sdk.d.ts (past source of false-green bugs) and its four direct-fetch shims + `(client as any)` pty casts can be replaced by real types. The npm dep is @opencode-ai/sdk@1.14.49; decide (in-issue) between pointing the dep at the fork's packages/sdk/js (file: or workspace ref — matches how the binary is already vendored) vs. copying generated d.ts — prefer the file dependency for zero-drift.

## Scope (in)
- Wire apps/api_server to the fork-generated SDK types
- Delete/shrink the hand-written d.ts to at most a re-export shim
- Replace direct-fetch implementations of updateSessionAllowlist/updateSessionSkillAllowlist, listSkills/listSkillsWithContent/reloadSkills, reloadConfig, replyToQuestion/rejectQuestion/listQuestions with typed SDK calls where the regenerated client covers them
- Type the pty namespace (drop `as any`)
- Keep runtime behavior identical (same endpoints, same payloads)

## Non-goals (out)
- No new features
- No engine changes
- Keep the ESM/CJS dynamic-import bridge pattern as-is

## Likely files
- apps/api_server/src/@types/opencode-ai-sdk.d.ts
- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/package.json
- apps/api_server/tsconfig.json (types wiring only)

## Acceptance criteria
- tsc clean with the hand-written union gone
- Zero `(client as any)` remaining in opencode_client_service.ts
- All existing api_server tests green (2650+)
- Live smoke: allowlist PATCH, skill reload, question reply still work against the built engine (unit-green ≠ live-green rule)

## Required tests
- Full api_server suite
- Targeted contract tests for each replaced shim asserting identical wire payloads

## Dependencies
OCU-26
