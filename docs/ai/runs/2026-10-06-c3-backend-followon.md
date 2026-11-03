---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-mobile-canonical-backend-20261006
pr: none
issues: []
status: source-complete-unverified-composed
tags: [run, rhythm]
---

# C3 backend follow-on: E1 / E2 / E3 (source only)

Authority: `docs/ai/review/2026-10-06-c3-backend-followon-astra-review.md` and `docs/ai/plans/2026-10-06-c3-backend-corrections-reviewed.md` (read in full, including the host-provenance addendum). Preserved: frozen core follow-on `65c150c6…c273`, original C3 packet, all prior logs. No commit. No server/engine/model/UI/device/import/consent operation. Mobile, web, fork, native Dayflow, auth/profile/grants and `decidePermission` untouched. No relay client/protocol change and no serialized addition. No core classifier/outcome/automatic-memory/callback/admission edits.

## Files (pre/post sha256 in `2026-10-06-c3-backend-followon.sha256`)

Source: `repositories/coordinator_conversations_repository.ts`, `services/coordinator_conversation_service.ts`, `services/opencode_stream_bridge.ts`, `repositories/agent_session_messages_repository.ts`, `repositories/relay_outbox_repository.ts`, `services/opencode_event_hub.ts`, `services/mobile_sse_proxy.ts`, `services/mobile_opencode_security.ts`, `routes/relay_gateway_routes.ts`, `services/relay_uplink_server.ts`.
Tests: new `c3_backend_followon.test.ts`, new `c3_relay_notification.test.ts`; `mobile_canonical_notification.test.ts` unchanged by me (Sol's missing-seams patch was already applied; its assertions run and pass).

## Implemented

**E1.** `notifyCanonicalOutput` is called immediately after the successful root error `messagesRepo.append`, before `setErrorStatus`/indexing. Failed append, ordinary and child stay silent.

**E3.**
- Publication moved from four service call sites into the repository, where the commit is known: `saveCurrent` (every goal/delegation/foreground/finite-authority/terminal-continuation write) and primary designation. A write is "changed" only when the CAS `UPDATE` changed a row. Inside this repository's own outer transactions (`outer()` around designate, create-root, addGoalFromMessage, status) hints are collected and published only after the OUTERMOST transaction returned successfully (cleared on rollback); a standalone write publishes after its own commit. Inside a caller-owned transaction nothing is recorded (commit unprovable) — silent, never early. Publish failure is swallowed and cannot undo, repeat or misreport the write. The four service-level hooks were removed to avoid double publication; all core follow-on hunks are intact.
- Same-transaction outbox: `saveCurrent` runs CAS + `appendRelayUpsert(agent_sessions)` in one transaction. New `appendRelayPrimaryRootUpsert` (existing outbox module) dirties the root's EXISTING agent_sessions record only for a current nonarchived nonchild nonsystem coordinator primary root. The messages repository calls it inside the same transaction for `append`, `upsertStructured`, `upsertMessageInfo`, `upsertPart`, and `applyPartDelta` (now wrapped in a transaction; no-op deltas dirty nothing). Reuses full-row replication and per-pk coalescing; no table/queue/protocol.

**E2.**
- Uplink server: `handleFrame(frame, connection)`; the authenticated connection carries an internal `Symbol` generation. The SAME envelope object is bound to `{hostId, userId, generation}` in a relay-instance `WeakMap` before `hub.publish`. A mirror-origin index is set only after `applyReplicationRow` returned true for an `agent_sessions` upsert whose row is a current primary root owned by the connection's user; it is bounded (256), cleared on delete/disqualification, on every new hello (host switch/reconnect) and on active disconnect, and never attributes persisted rows or resync markers. After a qualifying applied row (including a fresh seq with unchanged identity) it mints a fresh body-free hint (no Mac directory) with that origin, published after the apply transaction returned. Duplicate/failed/disqualified applies are silent.
- Relay-only qualifier `shapeRelayCoordinatorChanged` (security module), injected per stream by the relay route as `relayHintQualifier`; the LAN filesystem qualifier is unchanged and still used when no relay qualifier is injected. It reauthenticates the current device id/token/user/host against the attached device, requires event origin == mirror origin == current connection origin == device host/user (the online predicate is only an extra conjunct), and the exact mirrored primary root's owner/project/conversation/local id; it emits only the opaque `{directory: projectId, payload{type,id,properties}}`. Hub-only and project-feed-only (per-SDK and raw fallback still cannot mint it). Mirror state is eventual and advisory; the Mac canonical read stays final. No synchronous Mac archive/directory freshness is claimed.
- `findMirroredPrimaryRoot` (repository) is the relay replica read: no projects join, no filesystem.

## Commands and results (repo root)

- `npm --prefix apps/api_server run build` → pass (after the final edit).
- `... c3_backend_followon.test.ts` → 10/10 (first run).
- `... c3_relay_notification.test.ts` → 8/8 after two fixture fixes (Mac-side scratch DB FK pragma; a nonexistent `preview` column; one over-broad regex matching `localSessionId`). Weak-qualifier falsification: with the origin comparison temporarily removed, the H1/H2 test FAILED (H2 event reached the H1 device with online true); restored → passes.
- `... mobile_canonical_notification.test.ts` → 16/16 (includes the four Sol assertions; the root-error one was red before E1).
- Regression groups: relay (`relay_uplink_server_contract`, `relay_repl_contract`, `relay_role`, `relay_mirror_reads_contract`, `relay_uplink_client_contract`) 60/60; coordinator/bridge/fanout (`mobile_canonical_notification`, `c3_backend_followon`, `coordinator_core_followon`, `coordinator_conversation_{navigation,service,repository}`, `opencode_stream_bridge`, `issue_1379_bridge_hub_publish`, `issue_1379_mobile_event_fanout`, `issue_1170_mobile_realtime_proxy`) 138/138; messages-repository consumers (`opencode_parts_persistence`, `issue_1123_contract`, `issue_830/857/1482_contract`, `opc_m4_2_session_fork`, `skill_usage_tracker`, `workflow_failure_signal_extractor`) 136/136.
- `git diff --check` → clean. Memory suites NOT run (Sol classified the four baseline failures); no OpenDesign check.

## Coverage map to the required proof

Actual SQLite commit → singleton hub → proxy and revoke-before-drain retained (existing Sol cases). Root error successful append → hint; failed append/ordinary/child → none. One actual terminal continuation reservation (`reserveContinuationTurn`) → exactly one hint; replay/hold/no-write silent. Authenticated existing uplink → relay hub → opaque-project SSE with `projects` count 0. Event-before-row (dropped, one recovery hint on apply, later event accepted) and row-before-event. Fresh / duplicate / failed apply; archive and delete. H1/H2 same user + identical IDs with online TRUE for both; matching / mixed / foreign; real one-active supersession; same-host reconnect generation; queued-before-switch drop; missing origin; rebound/revoked device; wrong project/conversation/local row; missing/ordinary/child/system/malformed rows; per-SDK feed and raw hub spoof. Wire has no Mac directory, body, token, grant or SDK selector.

## Known limits and remaining proof (separated)

- **Source/test, not done here:** the real engine→bridge→SQLite→outbox→uplink-client→relay chain end to end (client flush/replication was not driven; the Mac side of the uplink is a fake WebSocket and the outbox dirtiness is asserted in SQLite). `onCoordinatorTerminal` itself (jobs/workstream/native) was not executed; its committed repository mutation was.
- **Production topology:** exactly one active uplink per relay instance; the two-host cases use real supersession plus real captured origins with only the weak predicate forced true. No simultaneous multi-host support is claimed.
- **Per-token cost:** each primary-root delta now also dirties/coalesces one agent_sessions outbox record (one extra `json_extract` read per delta, replication-gated) in addition to the existing hub hint.
- **Caller-owned transactions:** a repository write issued inside a transaction this repository does not own publishes nothing (silent by design).
- **Eventual replica:** relay hint qualification trusts the mirrored row; archive/directory changes are not synchronously proven.
- **Composition/install/paired-live:** not run (no packaging, install, restart, relay deployment, paired device, TestFlight). GitNexus not available in this session; manual caller review: `handleFrame` (single call site), `applyPartDelta` (bridge only), `appendRelayUpsert` consumers unchanged, `saveCurrent` (all repository writers), `streamEvents` route (sole relay SSE entry), `shapeMobileCoordinatorChanged` (LAN path unchanged).
- **Not touched, per instruction:** `c2_goal_callback` colon-validator mismatch and qualified callback Dayflow/decoded generic admission are the next turn.
