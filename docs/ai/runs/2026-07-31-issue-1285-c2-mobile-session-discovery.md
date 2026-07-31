---
date: 2026-07-31
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285]
status: passed
tags: [run, Rhythm]
---

# Issue #1285 c2 — mobile session discovery

## Files

- `apps/mobile/providers/agent-chat-provider.tsx`
- `apps/mobile/providers/services/agent-chat-service.ts`
- `apps/mobile/providers/services/session-service.ts`
- `apps/api_server/src/repositories/mobile_opencode_ownership_repository.ts`
- `apps/api_server/src/routes/mobile_gateway_routes.ts`
- `apps/api_server/src/services/mobile_opencode_proxy.ts`
- `apps/api_server/src/services/mobile_opencode_security.ts`
- Focused API, mobile, and live c2 tests.

## Checks

- `cd apps/mobile && node --test ./tests/contract/issue-1285-device-parity.test.mjs` — PASS, 6/6.
- `cd apps/mobile && npm test -- --runInBand tests/session-discovery.test.ts` — PASS, 1/1.
- `cd apps/mobile && npm run typecheck` — PASS.
- `cd apps/api_server && npx vitest run src/__tests__/issue_1285_mobile_chat_discovery.test.ts` — PASS, 2/2.
- `cd apps/api_server && npm run build` — PASS.
- `tools/dev/sandbox.sh up --foreground` on API `4198`, engine `4197`, and gateway `4199` — fork build and binary smoke PASS; API build PASS; both listeners healthy.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4198 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4197 RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-sandbox-1285-c2/rhythm.db RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-sandbox-1285-c2 RHYTHM_LIVE_HUMAN_CAPABILITY=issue-1285-isolated-human-approval-capability npx vitest run src/__tests__/issue_1285_mobile_chat_discovery_live.test.ts --no-file-parallelism` — PASS, 1/1.
- `tools/dev/sandbox.sh down` — PASS; `/private/tmp/rhythm-sandbox-1285-c2` removed.
- `git diff --check` — PASS.

## Notes

- The live test used the real fork and API with a copied sandbox database. It verified exact-owner isolation, project-scoped chat discovery, NULL-project desktop chat discovery, scheduled/optimizer exclusion, safe read-only projection without filesystem paths, and denied ID-addressed transcript access.
- Owner-unscoped discovery is deliberately accepted only for `experimental.session.list`; all other operations remain project-scoped.
- GitNexus rated the directly edited authorization method LOW risk. A `main` comparison is CRITICAL/noisy because this rollup is stacked and includes 1,160 inherited files; it is not the c2 review scope.
