---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-1282-mobile-session-scoping
pr: null
issues: [1282]
status: verified
tags: [run, Rhythm]
---

# Issue #1282 — mobile session-create profile scoping

## Files

- `apps/mobile/providers/opencode-provider.tsx` — sends the selected Rhythm
  `profileId` atomically with the mobile engine-session create request.
- `apps/api_server/src/services/mobile_opencode_proxy.ts` — validates that
  profile, resolves its scope through `resolveProfileScope`, applies the same
  MCP expansion/deferral/provider-cap and skill expansion as desktop creation,
  strips gateway-only/caller-supplied scope fields, and forwards the derived
  allowlists to OpenCode.
- `apps/api_server/src/contract/issue_1282_mobile_session_scope_parity.test.ts`
  — executable parity contract covering exact desktop/mobile scope equality,
  atomic client profile selection, and fail-closed unknown profiles.
- `apps/api_server/src/__tests__/issue_1282_mobile_session_scope_live.test.ts`
  — env-gated real API + fork assertion against the resulting engine session.
- `docs/ai/contracts/issue-1282.json` — three passing acceptance criteria.

## Checks

- Contract red:
  `npx vitest run src/contract/issue_1282_mobile_session_scope_parity.test.ts --no-file-parallelism`
  — expected FAIL, 0 passed / 3 failed.
- Contract green: same command — PASS, 3/3.
- Focused proxy bundle — PASS, 15 passed / 1 env-gated live test skipped.
- Mobile gateway security/profile regressions — PASS, 29/29 across six files.
- `npx tsc -p tsconfig.json --noEmit` in `apps/api_server` — PASS.
- `npm run typecheck` in `apps/mobile` — PASS.
- `npm run build` in `apps/api_server` — PASS as part of sandbox startup.
- `bun run build --single` for the unchanged fork — PASS as part of sandbox
  startup.
- Isolated live sandbox (`API :4398`, engine `:4397`, gateway `:4399`) —
  PASS; both listeners were sandbox-owned.
- Live:
  `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/issue_1282_mobile_session_scope_live.test.ts --no-file-parallelism`
  — PASS, 1/1; the real engine session stored `rhythm` MCP and `smoke-test`
  skill allowlists derived from the selected throwaway profile.
- Sandbox cleanup — PASS;
  `/private/tmp/rhythm-dev-sandbox-issue-1282` removed.
- `ai-workflow checks --level issue` — PASS: Flutter analyze, Dart format,
  api_server TypeScript, and mcp_server TypeScript.
- `git diff --check` and contract JSON parse — PASS.
- GitNexus `detect_changes` against
  `origin/codex/fix-session-isolation-runtime-performance` — LOW risk,
  2 production files / 7 symbols / 0 affected processes.

## Notes

- Root cause: mobile persisted `profileId` only in a follow-up state PATCH
  after the engine session had already been created, so the engine create
  request could not receive profile-derived allowlists.
- Pre-edit GitNexus impact was CRITICAL for `resolveProfileScope`,
  `OpencodeClientService.createSession`, and `MobileOpenCodeProxy.forward`.
  The change therefore leaves both shared desktop symbols untouched and calls
  the existing resolver/expansion helpers only at the mobile proxy boundary.
- Missing `profileId` preserves legacy-client create behavior; current mobile
  sends it for the selected profile. Invalid or unknown supplied identifiers
  fail before any engine request.
- Caller-supplied `mcpAllowlist` and `skillAllowlist` are discarded in favor of
  server-derived profile scope, and `profileId` never reaches OpenCode.
- The first focused proxy run was environment-blocked by a restricted loopback
  bind (`EPERM`); its approved rerun passed 15/15 non-live tests. The first
  issue-gate run was likewise environment-blocked by Flutter SDK cache
  permissions and missing local mcp_server dependencies; an ignored temporary
  dependency link plus approved SDK access produced the clean passing gate,
  and the link was removed afterward.
- No production port, production database mutation, push, PR, merge, or
  worktree removal was used.
