---
date: 2026-10-10
repo: Rhythm
branch: mega/2026-09-29-consolidation
pr: null
issues: []
status: fail
tags: [run, rhythm, verification]
---

# Three-deliverable running-build verification

## Files

Full report, exact commands/API results, runtime bindings, live test receipts and all three original transcript exports:
[report.md](/Users/ajhochhalter/Documents/Codex/2026-10-10/rhythm-running-build-verification/report.md).

Only this new run note is written in the repository. Existing dirty source/project-state files are preserved. No product implementation, install, build, unit suite, PR, source-consent change or protected-evaluator execution.

## Checks

- Actual desktop /Applications/Rhythm-Test.app, signed/notarized Electron 0.18.66, PID 3062 unchanged. Codesign deep/strict and Gatekeeper exit 0. Installed selected archive entries match; identity is not behavior proof.
- Final API PID 18298, ports 4001/4002; engine PID 18330, port 4096, boot 93e57348-09a4-4284-b0c7-2c33be86c32a, source b2fce6894aaf4ab107b36fee5f789703183ff1fb. API/engine health 200 and event bridge Live. API commit dev alone does not bind source.
- User subsequently authorized runtime restarts, bounded live-model test chats and routing activation. Three app-owned runtime restarts, no app quit or hand-started backend. Two test-owned projectless chats, fourteen live user turns, thirteen completed and one cancelled. No coding worker/evaluator ran.
- PUT /agent-decisions/config with features.model_routing on and routing.engine grid: 200; native settings show On. Existing backend/key/consent/exclusions and other Shadow features retained. Routing remains On/grid/first_prompt.
- Configured workflow Auto routes Haiku 5.5/max/Personal with applied grid receipts and matching actual engine model/variant. Fixed Sol/default/pinned control remains fixed during routing-on and survives restart. Post-restart Auto turn uses saved Haiku/max without new classification.
- FAIL: profile-less Auto chat serves Sonnet 5 despite saved Sol 6.1, no grid/dispatch receipt. This is distinct from the successful configured-profile path.
- FAIL reproduced: keep Details open, deliberately switch only owned control to Auto, routed Haiku turn completes, API lists Sol+Haiku while UI still shows only Sol. Refresh served models updates to both. Control restored to fixed Sol/default/pinned afterward; no new model turn after restoration.
- PASS scoped Review checks: all six rules loaded; fresh missing-criteria and impossible-feasibility refusal, nearest durable receipt retrieval and refusal of unconfirmed reuse, single intake owner/no competing worker, actual 1000-ms bash timeout and honest partial. General engine watchdog/delegation/writer guarantees not established.
- PASS scoped cancellation: actual harmless 20-second sleep cancelled once through API, tool User aborted/engine MessageAbortedError/API Aborted. Empty 204 parsing failed in capture; no mutation retry, readback proves outcome.
- Memory direct and minimal continuation PASS with independently read relevant canonical facts, budgets and body-free provenance. FAIL qualified short follow-up: receipt 242 selects unrelated Hermex context, relevant facts absent, response falsely recants prior legitimate sources. Root cause unresolved.
- Coordinator BLOCKED: Workstreams Off/404/unavailable; protected evaluator platform-held. No real coding proposal, human same-chat approval, manager/worker/evaluator, coding delivery, completed-before-delivery or duplicate-event injection.
- Dayflow SOURCE_MISSING/UI unavailable. Ordinary unenrolled questions proceed. 401/foreign-Origin403 pass only auth/origin boundaries. Full consent/revocation/changed receiver/retained-history and targeted zero-SDK-after-refusal checks NOT RUN without supported current-host fixtures. No live routing storage was corrupted.
- Original three transcripts fully retrieved and reviewed. Historical delivery-only, source/unit, isolated r30 and CI proofs not promoted to current-host acceptance.

Exact capture commands are in report.md and private evidence JSONs. Key executed commands (all exit 0): current_host_live_checks.py before/after/final; capture_test_chat.py before-restart/after-restart; capture_routing_live.py pre-pin/before-restart/after-restart/after-followup/final. Restart comparison fields are identical except expected runtime boot/process identities; no added SDK/model-dispatch records observed in the recorded restart window.

## Notes

Verdicts: Coordinator **BLOCKED**; Review **PASS for loaded instructions and bounded observed compliance**; Router/Memory/Dayflow **FAIL with bounded routing/persistence passes and remaining BLOCKED/NOT RUN checks**. This is not all-three completion.

Smallest remaining actions: supported protected-evaluator resolution and real same-chat proposal approval with Coordinator enabled; future repairs/retests for profile-less routing, served-model UI refresh and qualified Memory follow-ups; supported same-host synthetic source/receiver/quota/corrupt-state fixture with independent dispatch observation. No repair or substitute execution was performed.

Unsupported/unproved: Free public coding, S3 schedule resume-existing-session, real-provider quality and private/cross-user Memory quality.

### 13:53 PDT — hold cleared; actual missing Coordinator runtime identified

User cleared the instruction-based evaluator hold. No platform rejection observed. Enabled manual Workstreams via signed desktop preference and fourth supported Restart local runtime. Desktop PID3062 retained; API19633/engine19667 healthy, boot b00af5c8-c5d3-4069-8494-e707f0243ae6, same b2fce689 revision, signature/installed bytes unchanged. Authenticated original-chat panel exposes READ-ONLY COORDINATOR; packaged capability only selected_reference_summary_v1. Four later coding verifier/grant/terminal/delivery repair modules are absent. Full coding workflow FAIL capability / BLOCKED execution, not a continued cybersecurity hold.

Read-only capture commands remaining_host_checks.py remaining-before/remaining-final and remaining_capture_routing.py remaining-final exit0; 21 persistence/identity comparisons true, no added model wake observed. One new empty inspection chat soft-closed204 after API/SDK/dispatch counts0; active rows[]. No coding worker, evaluator, new model prompt, source fix, install or second backend. Other fixture/quality/enforcement gaps remain unrun. Updated private report and postmortem preserve pre-clearance versions.
