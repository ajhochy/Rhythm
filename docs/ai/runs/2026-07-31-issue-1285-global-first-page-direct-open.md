---
date: 2026-07-31
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285]
status: passed
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1285 corrective — global first page and direct chat open

## Files

- `apps/api_server/src/services/mobile_chat_catalog.ts`
- `apps/api_server/src/services/mobile_opencode_proxy.ts`
- `apps/mobile/providers/open-project-session.ts`
- Focused API/mobile contracts and the live gateway test.
- `docs/ai/contracts/issue-1285.json`
- `.agent-stack/postmortems/2026-07-31-issue-1285-native-retry.json`

## Checks

- `cd apps/mobile && node --test tests/contract/msp-004-atomic-open-session.test.mjs` — RED first (`transient-error` instead of `ready`), then PASS 12/12.
- `cd apps/api_server && npm test -- --run src/__tests__/issue_1285_mobile_chat_discovery.test.ts` — RED first (newer project-bound chat omitted), then PASS 4/4.
- `cd apps/mobile && npm test -- --runInBand tests/session-discovery.test.ts` — PASS 2/2.
- `cd apps/mobile && npm run typecheck` — PASS.
- `cd apps/api_server && npm run build` — PASS.
- `tools/dev/sandbox.sh up --foreground` on isolated API `4698`, engine `4697`, and gateway `4699` — fork build/binary smoke and API build PASS.
- `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/issue_1285_mobile_chat_discovery_live.test.ts --no-file-parallelism` with throwaway sandbox approval credentials — PASS 1/1 in 4.58s.
- `tools/dev/sandbox.sh down` — PASS; `/private/tmp/rhythm-sandbox-1285-c12c13` removed.
- `git diff --check` — PASS.

## Notes

- The first owner page now uses the same effective activity timestamp for SQL ordering and the mobile `time.updated` field. It includes exact-owner human chats from active registered projects plus projectless desktop chats, while excluding scheduled/system categories and other owners.
- A project-bound row keeps its actual project ID. Only a projectless row receives the separate registered-project routing ID used to authorize gateway requests.
- The mobile opener performs exact owner-authorized resolution immediately after project registration confirmation. A hit proceeds directly to the bounded transcript page; a miss or unavailable lookup retains the prior scoped-catalog fallback.
- The live test exercised the real fork, API, pairing flow, owner catalog, projectless transcript read, interactive prompt, and cross-owner denial against a copied sandbox database.
- GitNexus impact commands were attempted before editing `listOwnerUnscopedMobileChats`, `MobileOpenCodeProxy.forward`, and `createOpenProjectSessionController`, but the runner attempted to download GitNexus and failed DNS resolution. Source call-site analysis was used as the documented fallback; no HIGH/CRITICAL graph result was available.
- Repair-loop summary: the physical smoke showed an incomplete fast page and a stuck opener; the first live harness attempts then exposed an unavailable models snapshot, restricted Bun temp access, a reaped background server, and missing throwaway approval credentials. Failure triage used the checked-in models fixture, foreground sandbox hold, required permissions, and correctly hashed throwaway credentials. The unchanged product contracts then passed. Existing follow-up issue #1287 was updated rather than duplicated.
