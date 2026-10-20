# AI repair qualification — local mega candidate, 2026-10-20

Product source `92af064652a6f44155d09470af48a7b566994baf`, descendant of mega `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. Fork, web, API, MCP and Electron were rebuilt locally; the runner checks exact packaged API and bundled/live engine identity. Developer ID sign-only and strict deep signature verification succeeded. This local 0.18.83 app is unnotarized; installed/hosted/release qualification is separate. No GitHub build, push, PR, merge or installation occurred.

The original [d7 findings](2026-10-20-ai-findings.md) remain historical evidence. Full command `RHYTHM_FEATURE_MODEL=1 node tools/testing/run_packaged_ai.mjs --output /private/tmp/rhythm-ai-repair-full --reporter=list,json` exited 1: **67 passed / 92 failed / 0 skipped / 0 flaky**, 601.02s. Failures: 77 explicit inventory gaps, 12 prerequisites, missing embedded Dayflow, a late Hermes timeout and one test sequencing error. [Sanitized per-case receipt](2026-10-20-ai-repair-behavior-summary.json). Overall qualification is not green.

## Confirmed repair boundaries

| Area | Change and observed outcome |
|---|---|
| Unassigned sessions | Guard absent project IDs before branch lookup. Named session persists correct name/cwd/profile, reloads, and deletes from API, SQLite and actual engine without invalid `/projects//branches` or unexpected errors. Four real conversation cases also pass in the new full run. |
| Bot Crossing | Coalesce repeated valid same-frame ready messages only during initial loading before committed-document port transfer. Independent native readers receive distinct cancellable generations, preserving the worker's two-generation cap. Actual host/scene pages agree, continuation does not duplicate IDs, same child survives tab return, and no-match search clears to the same populated project digest. Source real-worker cancellation regression is RED/GREEN with byte-identical synthetic source; hostile native frame fixture passes separately. |
| Built-in Skills | Listed compiled built-in content is fetched from the exact engine representation; missing actual filesystem skills retain defensive errors. All catalog/recovery checks pass against the real package. |
| Report Card | Historical blank/null identity resolves to trimmed kind or `Unknown agent` while retaining run grouping/counts. Real empty-kind packaged row, inspector counts and unchanged API readback pass. |
| Gallery | Missing/outside/nonregular local files are not advertised as usable URLs; historical records remain inspectable with a disabled `Deliverable unavailable` action. Real catalog identity remains unchanged after selection. Valid available-media playback/folder behavior needs separate evidence. |
| Standalone Dayflow | Accept exactly reviewed signed 2.7.2/build136 in the installed-app runtime path while preserving bundled/staging 2.6.0/build133, exact identity/team/arm64/designated requirement and Gatekeeper checks. Readiness passes without launch or recording permission. |

Focused exact-build confirmation: seven tests passed, zero failed/skipped/flaky, 69.91s. Command and private receipt are in [repair run](../../ai/runs/2026-10-20-mega-ai-repairs.md). This is a scoped result, not overall feature qualification.

## Remaining concrete failures and prerequisites

- **Embedded Dayflow absent.** Standalone readiness does not provide the native viewport/helper/addon. Accepted immutable source/layout/signing manifests are missing at recorded paths; installed/current/previous bundles do not contain them. Backup contents remain unverified/inaccessible. Do not reconstruct accepted manifests or bypass validators.
- **Hermes late IPC timeout.** The full run's Bot paging assertions completed, but strict audit caught a pending retained Hermes child request timing out after 15s. The preceding three Hermes checks passed. Trace lacks the request route/backend health at timeout; do not attribute this to Bot inventory or claim an established cause. The later retained-child CROSS regression passed beyond 16.5s with unchanged real history; this does not retroactively resolve the full-run timeout.
- **MCP test response lifetime.** The real endpoint returned 200, but a test reload destroyed the response before `response.json()`. This is a test sequencing error, distinct from the earlier unresolved MCP responsiveness receipt. The no-reload entry/readback correction passed in the separate six-pass/two-fail follow-up.
- **Primary/Coordinator/approval isolation.** Existing permanent primary cwd is missing; refuse to rewrite the journal. Exact-build fixture bearer is not ordinary signed-in authentication. Full lifecycle/owner/expiry/concurrency coverage needs supported disposable state and appropriate real provider authentication.
- **Local integration configuration.** A follow-up Bot case completed behavior but strict audit caught background Google Calendar/Gmail/Planning Center sync errors because local OAuth application configuration is absent. No account/configuration changes or error allowlist were applied.
- **Coverage gaps remain explicit.** Month inventory covers 489 commits in 82 groups, including 77 active/partial claims. Narrow catalog/data/navigation successes do not qualify raw-run provenance, owners, privacy, tools, paid execution, failover, devices or native permission workflows.

## Source and infrastructure gates

Issue gate, built-web smoke, focused source regressions, real native frame fixture and three live sandbox API+fork repairs passed. The full PR aggregate remains failed: 21/22 batches, with five Engraph ownership spawn assertions. Exact ownership file 19/19 and related serial cluster 99/99 pass separately; cause remains unproven. See [Engraph triage](../../ai/runs/2026-10-20-repair-engraph-gate-triage.md). No source/fixture guard was weakened to force a pass.

Raw traces/logs may include signed-in local data and remain private. Sanitized per-case totals distinguish product errors, test authoring, prerequisites and explicit inventory markers. Every owned write is checked through the suite's API/DB/engine cleanup; foreign records and settings are preserved.

Follow-up command selected three Hermes cases, CROSS, three Bot cases and MCP: 6 pass/ 2 fail, 172.22s. This is separate from the 159-case full result. Final observer acquisition correction passed the separate three-case Bot confirmation; strict audits remain enabled. Current discovery is 160 cases/15 files; the whole suite was not rerun after these test-only follow-ups. No product change followed 92af.

Final Bot confirmation: **3/3 passed**, 55.70s, zero skips/flakies. All commands and separate follow-up statistics are retained in the sanitized JSON; they are not merged into a fictional whole-suite pass.
