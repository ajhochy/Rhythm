# Current plan — recovery and delivery

The [recovered delivery plan](plans/2026-10-01-delivery-recovery-baseline.md) is the durable scope and dependency record for A1 attachments, M1 mobile continuation, C1/C3 manual Run Now/provider failure, E1 approvals, W6 isolated Start, integration, same-source Electron/iOS distribution, and model-only operational checks. It is a sanitized historical baseline; [the combined recovery receipt](runs/2026-10-01-memory-recovery-integration.md) and [project state](project-state.md) hold the current evidence.

As of 2026-10-01, the real sandbox has passed memory #1603, A1 10/10, C1 core/auth and controlled provider failure, live browser reconnect, E1 queue-read, and W6 dirty-Git Start within their stated scopes. M1 source and mobile adapter are integrated, with physical-device validation pending. Earlier failing receipts remain historical rather than current blockers where replacement gates ran.

Next: repair and retest the mobile selected-older draft-target case, rerun the full API suite after focused fingerprint synchronization, finish affected web compatibility and same-source CI, then freeze one reviewed source SHA. Attribute literal installed actions, qualify signed Electron and internal TestFlight, and perform model-only readback/harmless served-model checks. Native approval signing remains human-only. No production deployment, branch merge, or acceptance claim follows from synthetic sandbox checks.

The prior unrelated [cloud live-artifacts plan](plans/2026-08-10-live-artifacts-history.md) and its linked mobile/Electron/Colony plans are preserved as historical scope; this recovery does not change their acceptance or authorization.
