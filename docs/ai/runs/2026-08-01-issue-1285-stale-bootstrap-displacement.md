---
date: 2026-08-01
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285, 1287]
status: in-progress
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1285 corrective — stale active-session bootstrap displacement

## Files

- `apps/mobile/providers/opencode-provider.tsx`
- `apps/mobile/providers/opencode-provider-selectors.ts`
- `apps/mobile/tests/session-refresh-pinning.test.ts`
- `docs/ai/contracts/issue-1285.json`
- `.agent-stack/postmortems/2026-08-01-issue-1285-native-bootstrap-displacement.json`

## Checks

- Physical-iPhone smoke on `bbff0c97061c0fb024878d9929bd7c87fcf79d72` — FAIL: transcript rendered, then returned to `Opening chat`.
- Attached Metro + real deep link to live projectless desktop session `ses_045dc…` — reproduced: opener stayed `ready` while `currentSessionId` changed to remembered scoped session `ses_045b…`.
- c15 Jest contract — RED first for missing refresh pinning, then RED again for missing stale-bootstrap commit guard.
- Focused Jest (`session-refresh-pinning` + `agent-chat-detail`) — PASS 3/3.
- Mobile TypeScript typecheck — PASS.
- Attached Metro + the same real iPhone/desktop deep link after both guards — PASS: `opening` → `ready` on `ses_045dc…`, with no `ses_045b…` transition during the 30-second observation window.
- `ai-workflow checks --level issue` — PASS.
- `ai-workflow checks --level pr` — mobile, Flutter, MCP, build, typecheck, fake-server, and web-E2E stages passed on both attempts. The first attempt hit an unrelated API fixture collision (`agent_configs_routes`: 200 vs 201); the second hit a different API route-state collision (`agent_cookbook`: 405 vs 201) plus an OpenCode cancellation timeout. All three failed tests passed when rerun alone.
- Live `/health`, `/opencode/health`, `/agents/capabilities`, and mobile-gateway health probes — PASS.
- GitNexus working-tree detection — LOW risk, zero affected execution flows. The aggregate rollup comparison to `main` remains CRITICAL by design.

## Notes

- The route-level c14 fix correctly removed its own cancel/reopen race, but a provider-level bootstrap that began before the explicit open remained in flight.
- Once its capability/message refresh finished, that bootstrap unconditionally restored the remembered project chat. The route still had a ready opener for the desktop chat, so its rendering guard fell back to `Opening chat`.
- Scoped session refresh also omits projectless chats by design. The provider now pins the exact ready owner-opened record into that scoped snapshot until route cancellation.
- An in-flight bootstrap may commit only if its token remains current and no explicit session became current while it awaited.
- No new backend or engine changes were made in response to the unrelated full-matrix flakes; GitHub Actions is the next clean-environment gate before device handoff.
