# Plan — Mobile regressions repair: slow project-targeted new chat + non-streaming transcripts

**Date:** 2026-09-28 · **Worktree:** `/private/tmp/rhythm-mobile-list-polish` · **Branch:** `mobile/chat-list-compact-project-create` (draft PR #1585) · **Status:** NC-1/NC-2 approved by AJ, implemented, and awaiting verification. NC-3/ST-1 remain unapproved and out of scope.

## Goal

Make project-targeted new-chat creation feel instant and make assistant replies stream live on mobile, by removing serialized awaits from the create path and consuming `message.part.delta` client-side, without changing list consistency, error handling, or project/profile semantics.

## Constraints

- Mandatory isolated sandbox at `:4098` (`tools/dev/sandbox.sh up|status|down`; engine `:4097`, gateway `:4099`, relay `:4100` opt-in). Never hand-start servers.
- Performance protocol: baseline → one change → identical remeasurement; revert/no-adopt if neutral or worse.
- Preserve: chat-list consistency after create, existing error surfaces, exact project/profile scoping semantics, prepend detection and auto-scroll behavior in `ChatContent` (branch `d2048dda` is committed; worktree clean).
- No real AI providers in any measurement — fake-opencode server + Playwright/Jest only; sandbox for live-ish confirmation.
- Remote relay frames are lossy and never replayed (`relay_uplink_protocol.ts:13-14`) → authoritative reconciliation on `session.idle` is non-negotiable.
- Base-red issue-1387 failures stay out of scope.

## Verified root causes (explorer evidence, exact refs)

**R1 — new chat slow** (all under `apps/mobile/`):

1. `components/chat/chat-list-controller.ts:56` — `openCreateSheet` awaits `loadSessionProfiles(targetProject)` (network) before the sheet shows.
2. `providers/agent-chat-provider.tsx:319` — `createChat` awaits `afterMutation(projectId)` (full cross-project `refresh()` sweep + AsyncStorage, `:174-239`) before returning; caller (`chat-list.tsx:817-820`) can't navigate until it finishes.
3. `providers/opencode-provider.tsx:1517` — `persistSessionPreferences` re-fetches the same profile catalog for non-active projects (second `listMobileGatewayProfiles` in one flow).
4. `providers/opencode-provider.tsx:995` — `openFromCache` misses for a brand-new empty session → cold open runs exact-session GET (`:1072-1077`) + messages GET (`:1110`) serially before composer commit (`open-project-session.ts:270-452`).

**R2 — streaming** :

5. `providers/opencode-provider.tsx:3831-3832` — `message.part.delta` has no case; silently dropped (client-side; local proxy and remote relay both forward deltas — `mobile_sse_proxy.ts:628` filters only owner/project/session, `relay_uplink_client.ts:684-692` forwards all hub envelopes).
6. `providers/opencode-provider.tsx:3736-3739` → `:1313-1359` — `message.part.updated` arms a per-session **resettable** 150ms trailing debounce (`:1319-1322` clears the timer per event) → continuous token streams starve the refetch until a ≥150ms gap.
7. `providers/opencode-provider.tsx:815-856` — the refetch is a full latest-page GET committed as whole-list replacement (`setMessagesBySession` + `mergeSessionMessages`, `lib/opencode/messages.ts:3-33`).
8. `session.idle` today: `:3689-3699` — 50ms-delayed full refresh (keep as the reconciliation anchor).

## User journeys

| Job | Entry point | Visible success | Slice |
|---|---|---|---|
| Start a new chat in a specific project | Project group header "New chat in {label}" (`chat-list.tsx:562`) | Sheet appears promptly; after Create, composer is interactive without a multi-second stall; session appears once in list | NC-1/NC-2 (NC-3 gated) |
| Watch the assistant reply stream | Any open chat while agent works | Text grows token-by-token during generation, settles to authoritative transcript at idle | ST-1 |

## Design

### R1 approaches

- **A1 — unblock create only:** `createChat` returns the created record immediately; `afterMutation` runs in background with preserved error surfacing; `persistSessionPreferences` reuses the catalog already fetched this flow instead of re-fetching. Smallest diff; cold-open GETs still block composer.
- **A2 — A1 + seed fast-open (recommended):** additionally seed the just-created session record and an empty message list into provider state so `openFromCache` (`:984-997`) hits; `loadSessionState` still runs in background to reconcile. Kills both blocking cold-open GETs; ~3 functions touched.
- **A3 — A2 + instant sheet:** also show the create sheet immediately with an in-sheet profile loading state (`openCreateSheet` stops awaiting). Touches sheet UI + its 58-test contract surface; adopt only if the tap→sheet metric still dominates after A2 (measurement-gated NC-3).

### R2 approaches

- **B1 — client stream reducer (recommended, root cause):** add `message.part.delta` / `message.part.updated` / `message.updated` cases in `handleEvent` that patch `messagesBySession` via a new pure reducer (template: `apps/web/src/gateway/transcript-reducer.ts:108`; append-by-`partId` semantics like desktop `agents_controller.dart:3697-3740`, including create-placeholder-part-on-missing-part). Buffer patches; flush one batched state commit per 50–100ms window. During an active stream, `message.part.updated` no longer arms the refetch debounce (the reducer applies the part snapshot directly); `session.idle` keeps the existing authoritative full refetch. Works identically over local SSE proxy and lossy remote relay.
- **B2 — bounded throttle fallback:** convert `scheduleSessionRefresh` to leading-edge + maxWait so continuous events can't starve it. One-function diff, but still one full-page GET + whole-list replacement per 150ms per streaming session — RTT-bound (worse over relay) and keeps the expensive render path. Fallback only if B1's measurement is neutral/worse.
- **B3 — desktop-style per-frame apply (rejected):** one commit per delta frame = unbatched provider-context re-renders at token rate on mobile; jank by construction.

**Error handling / consistency invariants (both repairs):**
- Background `afterMutation` failures surface through the existing error path (no unhandled rejections); the created session is optimistically present in list state exactly once and the later sweep merge must not duplicate or drop it.
- Reducer patches preserve `mergeSessionMessages` ordering (`time.created`) and message identity; `firstId` never changes during streaming appends, so `ChatContent` prepend detection (`chat-content.tsx:107,125-131`) and `maintainVisibleContentPosition` stay valid.
- Reducer tolerates missing deltas/parts (lossy relay): part snapshots from `part.updated` overwrite accumulated text; `session.idle` refetch is final authority.

### Doubt review (high-risk: core provider + streaming path)

Wrong if: (a) relay envelope loss/reorder corrupts transcripts between idles — probe: withheld-delta test (drop 20% of deltas synthetically) asserting post-idle deep-equality; (b) 10–20 batched commits/sec still jank because consumers subscribe to the whole provider context — probe: baseline step records commit→frame cost before adopting the window size (50–100ms tunable); (c) optimistic list insert races the background sweep into duplicates — probe: contract test asserting single occurrence after sweep completes. Primary sources checked: in-repo web reducer, desktop delta consumer, stream bridge/relay code, real SDK delta fixture (`apps/api_server/src/__tests__/fixtures/opencode_v1_14_49/message_part_delta.json`).

## File structure map

| File | Change |
|---|---|
| `apps/mobile/providers/agent-chat-provider.tsx` | `createChat` returns after `createSession`; `afterMutation` backgrounded with error surfacing + optimistic single-insert (NC-1) |
| `apps/mobile/providers/opencode-provider.tsx` | `persistSessionPreferences` catalog reuse (NC-1); seed created session/messages for `openFromCache` hit (NC-2); `handleEvent` delta/updated cases + batched flush wiring (ST-1) |
| `apps/mobile/providers/open-project-session.ts` | Fast-open path serves seeded record; `loadSessionState` reconciles in background (NC-2) |
| `apps/mobile/lib/opencode/stream-reducer.ts` (new) | Pure reducer: apply delta/part-snapshot/message-update patches; ordering + identity invariants (ST-1) |
| `apps/mobile/components/chat/chat-list-controller.ts` | Only if NC-3 adopted: `openCreateSheet` stops awaiting profiles |
| `apps/mobile/tests/fake-opencode/server.mjs`, `tests/fake-opencode/session-helpers.mjs` | `__control` delta-burst route + request logging for GET/profile-fetch counts (M-0) |
| `apps/mobile/tests/e2e/perf-regressions.spec.ts` (new) | Playwright measurement spec: M1–M7 metrics (M-0) |
| `apps/mobile/tests/chat/stream-reducer.test.ts` (new) | Pure reducer unit tests incl. withheld-delta reconciliation (ST-1) |
| `apps/mobile/tests/chat/create-chat-fast-path.test.tsx` (new) | Create-flow contract: single profile fetch, non-blocking sweep, no dup insert (NC-1/NC-2) |

## Measurements (M-0 harness; no real providers)

Fake-opencode server (`tests/fake-opencode/server.mjs`, real `/global/event` SSE + `__control`) driven by Playwright against Expo web (config: `playwright.config.mjs:67-88`); sandbox `:4098` only for a final live-ish confirmation pass.

| # | Metric | Baseline expectation → target |
|---|---|---|
| M1 | Tap → create-sheet visible (ms) | 1 profile RTT → unchanged (A2) or ~0 RTT (NC-3) |
| M2 | Create tap → composer interactive (ms), with 500ms injected sweep delay | > sweep delay → independent of sweep delay |
| M3 | Profile-catalog GETs per non-active-project create flow | ≥2 → exactly 1 |
| M4 | Blocking GETs (exact-session + messages) before composer on a just-created session | 2 → 0 (background reconcile still fires) |
| M5 | First delta emitted → first rendered token (ms), 100-delta burst @30ms | ~burst end + 150ms + RTT → ≤200ms |
| M6 | State commits + messages GETs during the burst, pre-idle | 1 commit post-gap + ≥1 GET → ≤ burst/50ms + 2 commits, 0 GETs |
| M7 | Post-`session.idle` transcript deep-equals authoritative messages payload (incl. 20% withheld deltas) | must hold before and after |

Protocol per slice: record baseline with the identical script, land the one change, remeasure identically, adopt only on improvement; otherwise revert.

## Issue table

| ID | Issue | Likely files | Acceptance criteria (falsifiable) | Deps | Required validation |
|---|---|---|---|---|---|
| M-0 | Measurement harness: fake-server delta bursts + request log + perf spec, record baselines | `tests/fake-opencode/server.mjs`, `session-helpers.mjs`, `tests/e2e/perf-regressions.spec.ts` (new) | `__control` route emits N `message.part.delta` at configurable spacing; request log counts profile/session/messages GETs; baseline M1–M7 numbers recorded in run log | none | `cd apps/mobile && npx playwright test tests/e2e/perf-regressions.spec.ts`; `npm run lint && npm run typecheck` |
| NC-1 | Unblock `createChat` + dedupe profile fetch | `providers/agent-chat-provider.tsx`, `providers/opencode-provider.tsx`, `tests/chat/create-chat-fast-path.test.tsx` (new) | M2 independent of injected sweep delay; M3 = 1; forced sweep 500 → existing error surface fires, zero unhandled rejections; session appears exactly once in list after sweep completes | M-0 | new contract test + `npx jest tests/chat/chat-list.test.tsx tests/chat/session-configuration-sheet.test.tsx tests/chat/chat-content-scroll.test.tsx --runInBand`; M2/M3 remeasure |
| NC-2 | Seed created session for fast open | `providers/opencode-provider.tsx`, `providers/open-project-session.ts`, same new test file | M4 = 0 blocking GETs before composer; background `loadSessionState` observed ≥1 within 5s; profile/project scoping unchanged (non-active-project create still lands in target project) | NC-1 | same jest set + M2/M4 remeasure |
| NC-3 | (Gated) Instant sheet with async profile load | `components/chat/chat-list-controller.ts`, sheet component + its tests | Only if post-NC-2 M1 still ≥1 RTT and AJ approves: sheet visible <100ms after tap; profile picker shows loading then catalog; create disabled until catalog resolves | NC-2 + measurement + AJ | 58-test combined contract set + M1 remeasure |
| ST-1 | Mobile stream reducer with batched commits + idle reconciliation | `providers/opencode-provider.tsx`, `lib/opencode/stream-reducer.ts` (new), `tests/chat/stream-reducer.test.ts` (new), perf spec | M5 ≤200ms; M6 ≤ burst/50ms+2 commits and 0 pre-idle messages GETs; M7 deep-equality holds incl. withheld-delta case; auto-scroll 8/8 and combined 58/58 pass unchanged; `firstId` stable during streaming appends | M-0 (NC independent, but sequential — shared file) | reducer unit tests + `npx jest tests/chat/chat-content-scroll.test.tsx --runInBand` + full combined set + M5–M7 remeasure + one sandbox `:4098` live-ish pass (`tools/dev/sandbox.sh up/status/down`) |

No two slices have disjoint file ownership (`opencode-provider.tsx` is shared) — run strictly sequentially: M-0 → NC-1 → NC-2 → ST-1 (→ NC-3 only if gated in).

## Same PR or separate?

**Recommendation:** NC-1/NC-2 belong in **draft PR #1585** — the project-targeted create action is a feature this branch introduces (`cf4718f7`); it should not ship slow. ST-1 is a **separate follow-up PR stacked on the branch** — the debounce/refetch architecture predates this branch, the change is riskier, and a separate PR gives a clean revert boundary the perf protocol requires. NC-3 (if adopted) joins #1585. Alternative (single new repair PR with both) is acceptable if AJ prefers not to grow #1585; the slice order and evidence protocol are identical.

## Coverage matrix

| Stated requirement | Slice | AC / validation |
|---|---|---|
| Return created record before background `afterMutation` | NC-1 | M2/M3 + contract test |
| Preserve list consistency + error handling + project/profile semantics | NC-1/NC-2 | single-occurrence + error-surface tests; scoping assertion |
| Seed/fast-open consideration | NC-2 | M4 = 0 + background reconcile |
| Reducer for `message.updated`/`part.updated`/`part.delta`, 50–100ms batching | ST-1 | M5/M6 + reducer unit tests |
| Authoritative reconciliation on `session.idle` | ST-1 | M7 incl. withheld-delta |
| Debounce starvation fixed | ST-1 | M5 with gap-free stream |
| Bounded-throttle fallback documented | Design B2 | adopted only if B1 remeasure is neutral/worse |
| Prepend detection stable | ST-1 | auto-scroll 8/8 + `firstId` assertion |
| Sandbox `:4098` + baseline→change→remeasure protocol | M-0 + every slice | perf spec, identical scripts, revert rule |

## Deferred approval questions

1. NC-1/NC-2 are approved for draft PR #1585. ST-1 still requires a separate approval and PR-scope decision.
2. NC-3 (instant sheet) remains held pending post-NC-2 M1 evidence and explicit AJ approval.
3. ST-1's proposed 75ms batch window remains undecided until that slice is approved.

## Correction to prior findings

The "remote relay intentionally does not mirror token deltas" premise is wrong: the bridge publishes every engine event to the hub (`opencode_stream_bridge.ts:1284`), the mobile SSE proxy filters only by owner/project/session (`mobile_sse_proxy.ts:628`), and the relay forwards all hub envelopes (`relay_uplink_client.ts:684-692`). The drop is exclusively the missing client case. Relay frames remain lossy/never-replayed, so idle reconciliation stays in the design.

Note: `docs/ai/project-state.md` says auto-scroll changes are uncommitted — the worktree is clean and `d2048dda` contains them; update project-state during implementation.
