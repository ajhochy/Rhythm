---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-1279-unscoped-session-visibility
pr: null
issues: [1279]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1279 — unscoped desktop session visibility

## Files

- `apps/api_server/src/repositories/mobile_opencode_ownership_repository.ts`
  preserves the exact desktop-session owner match while treating `NULL` and
  empty project IDs as unrestricted.
- `apps/api_server/src/contract/issue_1279_desktop_session_visibility.test.ts`
  covers unscoped visibility plus owner and project isolation invariants.
- `apps/api_server/src/__tests__/issue_1279_mobile_gateway_live.test.ts`
  exercises scoped and unscoped engine sessions through the real mobile
  gateway.
- `docs/ai/contracts/issue-1279.json` records acceptance criteria c7-c11.

## Checks

- Acceptance red:
  `npx vitest run src/contract/issue_1279_desktop_session_visibility.test.ts --no-file-parallelism`
  — 9 passed, 2 failed (the new `NULL` and empty-project cases).
- Acceptance green: the same command — 11 passed.
- Related mobile security set — 7 files passed, 52 tests passed.
- `npx tsc -p tsconfig.json --noEmit` — pass.
- `npm run build` in `apps/api_server` — pass.
- `ai-workflow checks --level issue` — 4/4 checks passed.
- GitNexus `detect-changes --scope compare` against
  `codex/fix-session-isolation-runtime-performance` — 5 tracked files,
  6 symbols, 0 affected processes, LOW risk.
- Isolated live sandbox (API 4298, engine 4297, gateway 4299):
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_BASE_URL=http://127.0.0.1:4298 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4297 RHYTHM_LIVE_GATEWAY_URL=http://127.0.0.1:4299 npx vitest run src/__tests__/issue_1279_mobile_gateway_live.test.ts --no-file-parallelism`
  — 1 file passed, 1 test passed; sandbox cleanup confirmed.
- `ai-workflow checks --level pr` — every stage through the mobile contract
  and fake-server self-test passed, including the full api_server test suite.
  The unrelated mobile web E2E stage reproduced the already-tracked
  `issue-1237-c5` recovery failure: the `Ask anything...` prompt did not
  appear within 30 seconds. The buffered runner was interrupted after it
  captured the Playwright failure; its orphaned test servers were stopped.

## Notes

- GitNexus upstream impact for
  `MobileOpenCodeOwnershipRepository.isSessionOwnedByDesktopCatalog` reported
  LOW risk. The central `resourceOwnedByCaller` path reported CRITICAL reach
  (4 direct callers, 16 impacted symbols, 80 processes, 20 modules), so the
  change remained isolated to the repository fallback.
- The root cause was strict `desktopOwner.project_id === projectId`
  comparison. Desktop sessions created from All Sessions have a durable exact
  owner but no project, so the fallback rejected the correct owner.
- No ownership rule was relaxed: a different owner remains denied even when
  the session project is `NULL`; non-empty project IDs still require an exact
  match.
- Production data and production ports were untouched. The live test used a
  copied SQLite database and the repository sandbox launcher.
- Failure triage found no #1279 path in the PR-gate failure. Issue #1237 is
  already listed as an active repair in project state, and this branch does
  not modify `apps/mobile`.
