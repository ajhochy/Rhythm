# Astra review — existing C3 notification corrections

Decision: APPROVED for the existing builder-owned Sonnet session `5a65716e-eac3-49a4-99b0-8d708b2d9993`, after collection and freezing of core follow-on `65c150c6f946bdfe87319ae8f8ad8b8a76c87ce9741f1c0f7deabba2cf98c273`. This is source implementation authorization for the three concrete C3 omissions, not runtime acceptance.

Plan authority: Sol's `c3-sol-verification.md`, including its host-provenance precision addendum. Preserve the original C3 packet `a4090136fbe155a7e537199f905c327c6b6eaf1086f64ce5111aa13ebab02c8e`, its tests, the core frozen checkpoint, and all A/P/D permission/auth boundaries. Apply the saved Sol test-only patch if not already present. No new writer in this checkout.

## Approved changes

1. E1: after a successful root error canonical message append, invoke the existing best-effort qualified notification before later preview/status work can fail. Failed append, ordinary chat and child produce no canonical hint.
2. E3: inventory actual committed canonical metadata mutations, including dispatch/foreground settlements, finite authority and terminal continuation reservation. Publish only after the actual outer transaction commits and only when state changed. Reads/replays/no-write holds are silent. Publishing failure does not undo or misreport a committed command. Preserve current rereads and finite authority checks.
3. E2: use the existing authenticated uplink, replicated `agent_sessions`, event hub and mobile proxy with a narrowly injected relay qualifier. Keep the direct LAN filesystem qualifier unchanged. No project-table replication, new transport/schema/protocol, queue, timer or retry system.

For E2, the reserved hint contains only exact project/conversation/local-root identities and a fresh advisory event ID. It never grants read or execution authority. The relay may use its current eventual mirror for this body-free invalidation; the subsequent canonical Mac API read remains final authority. Do not claim synchronous Mac archive/directory freshness or full remote completion from LAN tests.

Bind origin to the authenticated connection rather than supplied payload fields: pass that connection through the existing frame handler; associate the same envelope object with validated host, authenticated user and an internal unforgeable connection generation (for example the reviewed WeakMap). Track root-row origin only after a successful authenticated `agent_sessions` apply. No retroactive attribution of persisted rows. Clear/invalidate origin on connection generation changes and row deletion, archival or disqualification. At delivery, reread current device id/token/user/host, active connection, exact mirrored primary nonchild/nonsystem/nonarchived root and conversation. Event origin and mirror origin must match the device host/user and current generation. A weak host-online predicate alone is insufficient.

Canonical producers must dirty the existing root `agent_sessions` outbox record in the same durable transaction before their event can forward, including output-only bridge writes. Reuse the existing outbox coalescing and full-row replication. An event before its row safely drops. After a successful qualifying row apply transaction returns, emit a fresh body-free recovery hint with that authenticated apply origin. This includes a genuinely applied fresh sequence for a still-qualifying unchanged-identity row needed for output-only recovery. Duplicate/non-applied sequences, failed writes and disqualified rows are silent. Do not publish inside the transaction. No stored event backlog or speculative resync attribution.

## Exclusive file boundary

Existing API files only: coordinator conversation repository/service, stream bridge, mobile SSE proxy/security, relay gateway/uplink server, and a narrowly required existing outbox/replication integration point. Test the same features in their existing API suites. The relay client/protocol should remain unchanged unless the existing seam demonstrably requires a minimal internal call signature adjustment; no serialized protocol additions are approved. Do not modify mobile, web, engine, native Dayflow, credentials, policy grants, `decidePermission`, or installed runtime. No unrelated cleanup/refactor.

## Bounded proof

Keep the actual SQLite commit → hub → SSE and revoked-before-drain cases. Prove root error and one terminal continuation mutation publish after commit; replay/no-write/failure do not. Exercise existing authenticated uplink → relay hub → opaque project proxy without a relay projects row. Test both event/row orderings and applied/duplicate/failed upserts. Test matching and foreign/mixed host origins with identical user and row identities and online predicate true for both; separately exercise real single-active-uplink supersession and same-host reconnect. Keep current-device rebound/revocation, project/conversation mismatch, missing/archived/child/ordinary rows, raw engine spoof and per-SDK feed negatives. Assert absence of content/grants in wire hints. Run only affected tests plus the API build; no broad stress or completed-baseline reruns.

Freeze exact files, patch and hashes, state implemented/tested separately from composed/installed/live, and collect the CLI handle before ending ownership. Send the packet to Astra/Sol. Core admission and qualified Dayflow callback review proceeds independently on the frozen preimage; incorporate any approved follow-on only in a subsequent turn of this same writer.

## Release sequencing

A coherent verified coordinator increment may package and activate separately from full native Dayflow parity. The full original Dayflow build remains an explicit required deliverable, but is not an unrelated gate on otherwise coherent coordinator repairs. Builder alone owns composition, package, signing and coordinated activation. OpenDesign baseline is closed and must not be rerun.
