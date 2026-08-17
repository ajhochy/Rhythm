# Post-M1 Phase 1 — Desktop entry and host trust

The canonical machine-readable contract is `post-m1-phase-1.json`.

| Criterion | Evidence |
| --- | --- |
| c1a–c1c | New fixture/live readiness contracts plus retained invalid-live M1 evidence |
| c2a–c2e | New wide/narrow keyboard contracts, retained M1 accessibility evidence, and a pending packaged keyboard/VoiceOver check |
| c3a–c3e | New reload/persistence/error-redaction contracts and a pending packaged relaunch check |
| c4a–c4e | Retained Slice 5/7 host boundaries, new non-GUI Node policy contracts, and a pending unsigned packaged check |

Regression caught: a desktop shell can look ready while its applicable gate is unresolved, lose keyboard focus after navigation, report saved settings that vanish on reload, disclose raw failure material, or leave native lifecycle inputs and child processes unmanaged.

The non-GUI host-policy command is assertion-level RED (3 failures). The Playwright files compile and list, but this dispatch environment blocked both allowed Chromium launch attempts before assertions; those dispositions remain pending rather than being mislabeled RED.
