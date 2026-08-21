# Engine session live lifecycle contract

The canonical machine-readable contract is `engine-session-live-lifecycle.json`.

| Criterion | Test |
| --- | --- |
| c1–c3, c10 | `apps/web/tests/gateway/sessions-gateway.spec.ts` |
| c4–c9 | `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts` |
| c11 | `apps/web/tests/sessions.spec.ts`, `apps/web/tests/conversation.spec.ts` |

Regression caught: a requested live renderer silently showing deterministic fixture state or accepting an engine/session ID mix-up after a failed live call.
