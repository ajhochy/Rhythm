---
date: 2026-08-02
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1286, 1287]
status: device-smoke-pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# PR #1284 mobile regression rollup — profile binding, chat stability, performance

## Diagnosis (six-lane research fleet + orchestrator trace, all VERIFIED)

Until the expo/fetch SSE fix (623a59a05), no engine event had ever reached a
physical device; the event-driven client code ran for the first time at real
desktop volume and six latent defects became user-visible:

1. **Profile loss + DB corruption** (#1286): owner-unscoped discovery
   (mobile_chat_catalog.ts) returned no profile fields and the proxy's
   discovery path bypassed `attachSafeSessionState`; the normal attach path
   also required an exact projectId match that projectless sessions can never
   satisfy. The phone fell back to the last global profile, PATCHed it back
   (canUpdateMobileSessionState allowed the projectless WRITE while the READ
   never returned truth), and passed it as an explicit `agent:` override —
   user-confirmed as "Coding Workflow" executing "Theological Researcher".
2. **Event-storm amplification**: session.created/updated/deleted each fired
   refreshSessions + full archived-list pagination per event, uncoalesced;
   est. 40–100+ gateway req/min.
3. **Client identity churn**: catalog mapping fabricated fresh `time` values
   per refresh → serverProjects always new → scoped client rebuilt → SSE
   stream aborted/restarted (+5 refreshes per restart).
4. **Ready-chat eviction race**: preserveReadySessionDuringRefresh compared
   against a stale currentSessionId during React batching; refresh dropped
   the open session → reconcile evicted → route re-opened in a loop
   ("Opening chat…" flapping/looping).
5. **Transcript overwrites**: refreshMessages replaced the transcript with
   the newest-20 fetch unconditionally; stale/partial responses shrank
   hydrated transcripts to 1/0 messages; no older-page loading existed.
6. **Route render coupling**: any transient openState/selection wobble
   dropped a rendered chat back to the spinner.

## Fixes

Server (Codex lane, apps/api_server): shared
`mobile_session_state_scope.canUpdateMobileSessionState` predicate now gates
`rhythm` attachment on all read surfaces — owner-unscoped discovery items,
session.list/create/update responses — exact owner + same-or-projectless.

Mobile (Codex lane + orchestrator, apps/mobile):
- `buildPromptExecutionPlan`: unknown session state ⇒ no persist, no
  agent/model/system overrides (engine session config wins).
- Selector pinning on `openState.sessionId` ground truth; reconcile returns
  the ready target unconditionally.
- Route keeps rendering a once-ready chat while selection matches.
- `lib/opencode/messages.ts`: merge-by-id transcripts, monotonic per-session
  fetch tokens, explicit prune (message.removed) and replace
  (revert/compaction) escape hatches.
- Load-older pagination via engine `limit`+`before` (verified implemented in
  the fork's MessagesQuery), "Load earlier messages" affordance.
- `lib/coalesce.ts`: 750ms session-list coalescer, archived sweep only on
  delete/archive/restore, 1s idle-ancillary coalescer; stale-guarded list
  commits.
- Catalog referential stability (`sameGatewayProjectList`) ends SSE restarts.
- **Cache-first switching**: `openFromCache` transport fast path commits a
  hydrated chat synchronously (zero network before render) and revalidates in
  the background.
- Harness: Playwright `retries: 2` (CI) + explicit expect timeout; Mobile CI
  `concurrency` keyed on head SHA collapses the duplicate push/PR run pair.

## Checks run

- api_server: issue_1286 suite red on HEAD (3 fail) → 4/4; realtime/security
  16 pass; `npm run build` PASS.
- mobile: typecheck PASS; lint 0 errors; jest 39/39 (incl. new
  prompt-execution-plan, session-message-merge, coalesce,
  open-session-cache-first suites); fake-server self-test PASS; Playwright
  71/71 PASS.
- GitNexus: impact run per edited symbol (attachSafeSessionState reported
  CRITICAL but fan-out is cross-app name collisions; true direct radius = 1
  caller); detect_changes LOW, 21 files, 0 affected processes.
- Live behavioral gate: attested isolated sandbox (API 4098 / engine 4097,
  fresh api_server build, staged fork binary) —
  issue_1283_mobile_desktop_live_stream 1/1 PASS. Desktop app on 4001/4096
  verified healthy after teardown.

## Human validation required

- `tests/fake-opencode/server.mjs` + `self-test.mjs` changed (adds the
  `limit`/`before` message paging the real engine already implements).
- Physical-device smoke checklist in PR/summary; issue-1286-c12 pending.

## Round 2 — live device iteration (2026-08-02, PASS)

The first device pass failed for reasons the automated gates could not see;
each was probed live on the phone, diagnosed, and fixed:

1. Stale desktop server (process predated the fixes) — relaunched via
   tools/dev/launch_desktop_current.sh; profile fix inert until then.
2. Cross-project chat opens flipped the provider scope and destroyed all
   cached transcripts → transcripts/diffs/todos now survive scope switches;
   cross-scope cache-first via openedSessionRecordCacheRef.
3. Chats-list churn ("no sessions yet" flashes, unprompted reloads): the
   discovery sweep re-ran on every scope flip and SSE reconnect →
   identity-stable refresh, stale-while-revalidate, never-shrink progress
   commits, 15s sweep throttle (agent-chat-provider.tsx).
4. Unhandled 404 overlays: scheduled per-session refresh timers fired after
   scope switches → out-of-scope skip + catch in the executor.
5. "Unassigned" despite a bound profile — three stacked causes: (a) rhythm
   attach previously fabricated all-null states (now attach requires a real
   binding; opencodeAgentId excluded — it is backfilled from agent_kind);
   (b) cache-first hydrated from pre-fix record snapshots with no
   re-hydration (record cache refreshes + rehydrate effect added);
   (c) ROOT CAUSE of the final symptom: the profile catalog is cleared on
   every scope switch and only the Chat-tab bootstrap refetched it — the
   detail route left catalog=0 (probe evidence), so the sheet could not
   label any profile. Capabilities now follow the active scope.

Device probes captured the full evidence chain (open-from-cache HIT/miss
reasons, sheet-open draftProfile/catalog counts). Final state user-confirmed:
"success. it works now." — profile shows correctly, cached switches instant,
no error overlays.

Residual follow-ups (tracker #1287): desktop should persist its selected
profile binding onto agent_sessions rows (mobile can only display what is
stored); rows corrupted by the pre-fix PATCH still hold Theological-Researcher
(user to reassign, or approve a one-time cleanup); cold-start first-open
latency budget unchanged.
