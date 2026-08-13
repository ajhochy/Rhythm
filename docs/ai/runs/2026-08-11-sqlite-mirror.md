---
date: 2026-08-11
repo: Rhythm
branch: mobile/sqlite-mirror
pr: https://github.com/ajhochy/Rhythm/pull/1384
issues: [1378, 1379]
status: implemented — Phase 0 + Phase 1 landed, Phase 2 deliberately deferred
tags: [run, Rhythm]
---

# Mobile smart-client: read sessions/transcripts from the SQLite mirror

Implements `docs/ai/plan-mobile-smart-client.md` Phase 0 (#1378) and Phase 1
(#1379a). Phase 2 was assessed and deferred — see "Phase 2: why it is not in
this PR".

The reframing, in one line: the phone stops being a thin client of the raw
OpenCode engine on `:4096` and becomes a client of api_server's smart server,
reading from the SQLite mirror the desktop has always read from. Writes and
live streams still go to the engine.

## Files

### Phase 0 — fail soft (#1378) · commit `20bd16a8`

| File | Change |
|---|---|
| `apps/api_server/src/services/mobile_upstream_failure.ts` | **New.** Shared classifier for pre-check failures: transient upstream status (408/425/429/502/503/504) or abort/timeout → `504 OPENCODE_TIMEOUT`; connection failure → `502 OPENCODE_UNAVAILABLE`; definite non-OK answer → `502 OPENCODE_SCOPE_CHECK_FAILED`. Never echoes the raw upstream message (it can carry a project path, prompt, or credential). |
| `apps/api_server/src/services/mobile_opencode_proxy.ts` | `fetchJson` pre-check routes its non-OK status through the classifier instead of hard-coding 502. |
| `apps/api_server/src/services/mobile_sse_proxy.ts` | Its pre-check had **no timeout at all** and let thrown fetch errors escape as a generic 500. Now bounded (30s, `scopeCheckTimeoutMs`) with every outcome classified. |
| `apps/mobile/lib/opencode/cold-start-retry.ts` | **New.** Cold-start retry budget: idempotent gateway GETs retry on 502/503/504 with 400/1200/3000 ms backoff (≈4.6s added worst case). |
| `apps/mobile/lib/opencode/client.ts` | `createMobileGatewayFetch` routes through the budget. Writes get exactly one attempt; the event stream is excluded (its consumer owns reconnection). |

### Phase 1 — mirror-served reads (#1379a)

| File | Change |
|---|---|
| `apps/api_server/src/database/migrations.ts` | Adds `agent_session_messages.info_json`. SQLite-only, additive, idempotent. |
| `apps/api_server/src/repositories/agent_session_messages_repository.ts` | `upsertMessageInfo` persists `info_json` (COALESCE, so a later info-less event cannot blank it). New `listEngineShapedPage()` returns `[{info, parts}]` with a `complete` flag. |
| `apps/api_server/src/services/opencode_stream_bridge.ts` | `message.updated` stores the engine's `info` verbatim. |
| `apps/api_server/src/services/mobile_chat_catalog.ts` | Adds `listProjectScopedMobileChats` and `listMobileChatChildren` alongside the existing owner-unscoped reader; the brittle `%LIMIT%`/`%OFFSET%` string-replacement param juggling is replaced by a small binder. Timestamps now zone-normalize via `toUtcIsoInstant` before `Date.parse`. |
| `apps/api_server/src/services/mobile_mirror_reads.ts` | **New.** `readMirrorSessionList` / `readMirrorSessionChildren` / `readMirrorTranscript`. Each returns `null` when the mirror cannot answer authoritatively. |
| `apps/api_server/src/services/mobile_opencode_proxy.ts` | `serveFromMirror()` short-circuits `experimental.session.list`, `session.children`, and `session.messages` before the engine fetch; `null` means the unchanged live forward runs. |

### Tests

| File | Cases |
|---|---|
| `src/__tests__/issue_1378_scope_check_classification.test.ts` | 6 — every classification branch, plus "never leaks the raw message". |
| `src/__tests__/issue_1378_proxy_scope_check_status.test.ts` | 5 — end-to-end through the real proxy. |
| `src/__tests__/issue_1378_sse_scope_check_status.test.ts` | 5 — including "bounds a hung pre-check" and "still 404s an unaddressable session". |
| `src/__tests__/issue_1379_mirror_reads.test.ts` | 19 — engine contacted **zero** times on mirror hits; cross-user and cross-project isolation; archived list; `x-next-cursor` pagination; `{info, parts}` shape; host-path scrubbing; and six distinct fall-through-to-live cases. |
| `src/__tests__/issue_1379_info_json_mirror.test.ts` | 9 — migration idempotence, cursor paging, incomplete detection. |
| `src/__tests__/issue_1379_bridge_info_json.test.ts` | 2 — driven through the real bridge with the v1.14.49 event fixture. |
| `src/__tests__/issue_1379_mirror_reads_http.test.ts` | 7 — the behavioral proof. Drives the real `/mobile-gateway/opencode/*` route through real `Device` auth and project-scope middleware against a real SQLite DB **with the engine unreachable**. Opens with a negative control asserting a live-only read (`file.list`) *fails*, so the engine is provably down before the mirror reads are asserted to succeed. |
| `apps/mobile/tests/issue-1378-cold-start-retry.test.mjs` | 7 — retry budget, bounded, writes never replayed. Wired into `test:ci:static`. |

## Checks

`python3 scripts/run_ai_workflow.py checks --level pr` → **exit 0** on
`cc0303a1`. All 16 checks green: flutter analyze · dart format · api_server tsc ·
mcp_server tsc · flutter test · api_server lint · api_server vitest (serial) ·
api_server build · mcp_server vitest · mcp_server build · opencode fork
typecheck · opencode fork session tests · mobile static suite · mobile contract ·
mobile fake-server self-test · mobile web e2e.

Confirming full serial api_server run on the final tree (the PR-level run started
before the HTTP behavioral test was committed): **529 test files / 4349 tests
passed, exit 0**.

Totals: **60 new cases across 8 files** — 53 api_server + 7 mobile.

**One pre-existing flake observed once, then cleared.** `dashboard_summary.test.ts
> done tasks are excluded from pastDeadlineCount` failed in one early full serial
run and passes in isolation both with and without this branch's changes; it did
not recur in either of the two later full runs. Nothing here touches the
dashboard or task path. This is the shared-state ordering class the repo already
documents on `PR_CHECKS` (#755/#1088), not a regression from this work.

## The four open decisions — resolved

The plan flagged four. All were taken conservatively, without asking.

### 1. Mirror authority vs. live backfill

**Decision: mirror-first with a live fall-through on every ambiguity, and the
mirror never serves a partial answer.**

The plan proposed "mirror-first + live backfill on cache-miss". For a *list*, a
cache miss is unobservable — an empty result is a legitimate answer and is
indistinguishable from "the ingest has never seen this project". So the rule is
narrower than the plan's:

- **Session list.** Serve from the mirror when it holds ≥1 chat row for this
  (owner, project). A completely empty result falls through live, whose existing
  `reconcileCatalogSession` write-through then populates the mirror for next
  time. An exact-session lookup (`search=<id>`) that misses **always** falls
  through — #1379's acceptance requires exact-session pinning to survive, and a
  false negative there would break it.
- **Transcript.** Serve only when *every* row in the window carries `info_json`.
  Any legacy row, any unparseable row, or a cursor the mirror does not hold →
  fall through live. This is also what keeps child sessions correct: the bridge
  mirrors child *rows* but not child message *parts* (a known Phase 3 gap), so a
  child transcript automatically fails the completeness check and goes live
  rather than rendering as empty.
- **Children.** Serve when the *parent* is a mirror row this caller owns. When
  it is, an empty child list is authoritative — the same always-on ingest that
  recorded the parent records every `session.created` child edge, so "no
  children" is an answer, not a miss. Trusting it is what keeps the common leaf
  case engine-free.

### 2. Native-DTO versioning

**Decision: do not add a mobile-native contract version in this PR.**

Adding a second version field to the handshake is a protocol change, and the
handshake's three pinned fields (`gatewayVersion`, `opencodeVersion`,
`contractFingerprint`) are exact-equality gated — any drift flips every paired
phone to `incompatible`. This PR does not need it: every mirror read is served
behind an **existing engine-shaped operationId**, so it sits inside the
already-fingerprinted surface and introduces no new DTO. Zero fingerprint
change, zero re-pair. A native-DTO version is only worth designing when a
genuinely new mobile-native DTO ships, and it should be its own issue.

### 3. "Never mirror" policy for working-tree reads

**Decision: written down as an explicit allowlist, enforced structurally.**

`serveFromMirror` matches an explicit allowlist of exactly three operationIds.
Everything else — every write, plus `file.*`, `session.diff`, `vcs.*`,
`find.*`, `session.shell`, `session.command`, `pty.*`, `worktree.*`, and the
MCP/provider auth surface — reaches the engine unchanged, because it reflects
the working tree or live engine state **at request time** and a stale answer
would be wrong rather than just old. A default-deny allowlist means the next
operation added to the manifest is live unless someone deliberately opts it in.
`session.list` (the non-experimental one) is also left live: its
archived-inclusion semantics are not pinned by anything the mirror schema
records, and guessing them would risk a silent behavior mismatch. The phone's
first paint does not depend on it — the cross-project catalog already comes from
the owner-unscoped mirror path.

### 4. Optimistic send

**Decision: not in this PR.**

Optimistic outgoing-bubble rendering belongs with Phase 2. Its whole value is
that the reply then streams from the smart server's state; shipping the
optimistic bubble while the stream is still a per-device engine SSE would make
the UI claim a send succeeded on the exact transport that is still the fragile
one. Deferred to the Phase 2 issue, unchanged from the plan's recommendation.

## Two defects found while implementing

Both were pre-existing and are fixed here because the mirror path would have
inherited them.

1. **`Number(query.get('limit'))` is `0`, not `NaN`, when absent** — so an
   absent `limit` passed `Number.isSafeInteger` and clamped the page to a single
   item. Invisible in production only because the phone always sends an explicit
   limit. Fixed once in a shared `pageLimit`/`pageCursor` helper used by both
   the owner-unscoped path and the new mirror path.
2. **Session-list timestamps were not zone-normalized.** `agent_sessions`
   timestamps written by SQLite's `datetime('now')` default carry no zone
   designator and `Date.parse` reads them as local time — the same defect that
   scrambled transcript ordering by the reader's UTC offset (documented on
   `toUtcIsoInstant`). The catalog now normalizes before parsing.

## Phase 2: why it is not in this PR

Assessed against the plan's "Phase 2 if it's clean" bar. It is not clean:

- `ws_gateway.broadcast()` only fans out to the loopback `/ws/agents` client
  set, so mobile receives none of the bridge's already-persisted frames today.
  Reaching phones means a new fan-out path, not a flag.
- The per-device engine SSE in `mobile_sse_proxy` carries per-owner/per-project/
  per-session filtering, dedupe, and 1s device-revocation checks that all have
  to be preserved on the new path.
- Reconnect replay by `sdk_message_id` is new cursor logic on the stream.
- RN cannot stream via XHR `fetch`, so the `expo/fetch` SSE consumer (#1287)
  must stay — a constraint that needs on-device verification to confirm.

That is a second PR's worth of surface, and it wants device evidence. Phase 1
is independently valuable and independently shippable, which is exactly how the
plan scoped it ("each phase ships independently").

## Notes

- **What actually gets faster.** Opening and browsing sessions, the archived
  list, and paging a transcript no longer block on engine liveness at all. On a
  mirror hit the engine is contacted zero times — pinned by test, not assumed.
- **Security invariants held.** Ownership is re-applied on every mirror read
  from the mirror's own `owner_user_id`/`project_id` columns; a NULL `project_id`
  is treated as unresolved and falls through live rather than being assumed to
  match. Session-list items are built from named safe columns (no host path can
  reach the phone by construction), and transcript parts — which *do* embed host
  paths in tool state — are run through the live path's own
  `shapeMobileOpenCodeResponse` scrubbing, with a fetcher that throws if the
  shaping ever tries to contact the engine.
- **#1379's remaining acceptance is device-only.** Its criteria ask for measured
  cold-start timings and physical-device evidence over a remote gateway. That
  cannot be produced in this environment. The structural fix (reads no longer
  touch the engine) plus Phase 0's transparent retry are what should make the
  measurement pass; the numbers still need to be recorded on-device before #1379
  is closed. The PR marks #1379 as partially addressed for this reason and does
  not auto-close it.
- **One known residual cost.** Paging back past the mirror's earliest row for a
  session always costs one live engine call: "no rows older than this cursor" and
  "older rows were never mirrored" are indistinguishable from the mirror alone,
  so the completeness rule treats it as the latter. That is one call at the end
  of a scrollback, not on open, and erring the other way would silently truncate
  history.
- **Mirror unavailability is not request failure.** If the local catalog cannot
  be consulted at all, the mirror read is caught and the request forwards live —
  the same fail-closed posture `attachSafeSessionState` already takes. This was
  found by test: before the guard, an uninitialized DB turned into a raw
  non-`AppError` escaping the request.
- **Follow-ups worth filing** (Phase 3 in the plan): mirror child message parts;
  mirror pending permissions/questions; dispatch queue; mirror-first title/archive
  writes.
