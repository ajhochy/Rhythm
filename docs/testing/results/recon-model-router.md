# Model router recon — local mega 894c16f44d30

2026-10-19. Signed local Rhythm 0.18.83, API build identity and live engine both match mega `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. Real-model opt-in explicitly authorized. No global config/account writes.

Observed, without asserting classification quality:

- Settings route `#/tools/agent-settings?settingsSection=model-routing`; Engine & classifier shows Grid / On, Decisions key saved, consent given, classifier `gpt-6-luna`. GET `/agent-decisions/config` and `/agent-decisions/grid` return 200. Missing override file uses valid defaults, thresholds `[0.1,0.35,2.25]`.
- Owned project POST 201 `{id,name,cwd,archivedAt}` and owned session POST 201 with `modelMode:auto,providerId:null,modelId:null`. Project binding avoids the separately documented unassigned-project branch error. Exact-nonce session/project cleanup completed.
- First arithmetic turn: answer `67`. GET `/agent-decisions/grid/last-decision` 200 `{decision:{sessionId,mode:on,status:ok,applied:true,kind:route,classifierSource:decisions,classifierReason:ok,category,tier,tierUsed,model,provider,effortRequested,effortApplied,accountId,accountSource,trace,served}}`.
- First probe: knowledge/tier 2 → Sol 6.1, max requested / xhigh applied. Second probe: knowledge/tier 3 → tier 2 / Sol 6.1 because Haiku account exhausted/no eligible account, tier-3 `openai/gpt-6-sol` unavailable, then tier-2 selected account eligible. This is an actual step-up, not a constant classifier result.
- Read-only `agent_router_grid_attempts` contains two receipts: identical classification, pending `applied:false`, then `applied:true`. Served ledger and `/model-provenance` agree with requested/served `gpt-6.1-sol`; dispatch `requestedSource:auto`, `outcome:accepted`. API `routed:false` is existing summary vocabulary and does not negate the separate Grid receipt.
- Reload then follow-up answer `32`: attempt count remains two. Chat menu → Model → `openai/gpt-6-luna` → Session default PATCH 200; answer `49`, DB `model_mode:fixed`, provider/model Luna, no additional Grid attempts. Historical router timestamp remains present and variant clears; do not assume timestamp must be null on pin.
- Last decision UI shows the same category/tier, step-up when applicable, OpenAI Decisions, requested model/effort, applied effort, served model and automatic account. Refresh is `grid-last-refresh`.
- Recon runs finished in 40.6s and 46.2s. Strict per-test renderer/server log audit had no unexpected errors; expected deleted-own-session 404 excluded. Shutdown stream errors occur after the test audit window.

Separate six-request live classifier audit used the **bundled mega client/questions**, saved key/consent in memory, and the production 1000ms timeout. All six returned `status:ok` with `gpt-6-luna`, 152–336ms. Synthetic inputs only:

| Input class | Raw score | Mapped tier |
|---|---:|---:|
| Lowercase HELLO WORLD | 0.05 | 4 |
| Extract synthetic email address | 0 | 4 |
| Two-number arithmetic | 0.18 | 3 |
| Change one JavaScript greeting literal | 0.85 | 2 |
| Multi-file paginated task feature | 2.01 | 2 |
| Fault-tolerant multi-region replication architecture | 2.97 | 1 |

This shows a separate calibration concern: wording defines single-file edits as tier 3, but the current 0.35 cut-off promotes the routine edit to tier 2. The sample is a diagnostic, not a quality benchmark or proof every real task is over-routed. Persist explicit expectation tests for trivial work and report any failures.

Normal diagnostic attempts/decision audit logs survive session hard deletion by design. Do not delete them with direct SQL or claim every diagnostic row was removed. User-domain sessions/projects and temporary directories are cleaned in `finally`. Raw recon/private transcript payloads remain under `/private/tmp`, excluded from Git.
