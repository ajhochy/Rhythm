# Astra review: canonical mobile notification

2026-10-06. Sol's `rhythm-mobile-canonical-notification-plan.md` is accepted for narrow implementation on frozen owner source.

The event is an identity-only, lossy invalidation hint through the existing hub and project stream. It is emitted after successful canonical commits and never represents a permission, dispatch, result verification, transcript clock, SDK session event or newly constructed transcript. The current owner/project/primary-root/conversation must be re-proven before delivery; reserved custom events from raw engine/fallback ingress are rejected. Do not introduce a timer, server, queue, migration or orchestration layer.

Mobile C4 worker is closed and collected; C4 independent Sol verification precedes mobile C3 writes. The same persisted exact Sonnet session can implement the consumer against this reviewed contract while the disjoint backend owner completes, retaining healthy-idle C3 acceptance as pending until the actual composed producer is tested. Do not require an SDK catalog row. Preserve current-client/generation fences, local root/conversation matching, trailing coalesced revalidation, draft and mode isolation.

Core90808 remains the sole backend writer until its turn closes and packet freezes. Afterwards a narrow Sonnet follow-on may add commit notifications and guarded forwarding, preserving permission patches. The frozen source determines exact commit boundaries; publication errors must not convert a committed command to a retry or roll back it. Notification bursts are bounded through existing queue/controller behavior; no new durable event history.

Verify changed behavior and known C3/C4 failures only. Existing working OpenDesign integration is closed on real user-use evidence and is unrelated. No generic stress or repeated baseline smoke gate.
