# AI behavior findings — local mega candidate, 2026-10-20

Product source: `d7fb554735f93c0d0a76785cbadd583d0f866610`, locally built/signed Rhythm 0.18.83, descendant of mega `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`. Source, packaged engine and live engine are checked by the runner. Test snapshot for the full run: `8ca697e58f606b9001be4a9c39d9bac00026a6d7`. No product repair or new package build occurred in this test-only phase.

Full command: `RHYTHM_FEATURE_MODEL=1 node tools/testing/run_packaged_ai.mjs` → exit 1, **46 passed / 109 failed / 0 skipped / 0 flaky**, 17.4 minutes. Of 109 failures, 80 are deliberate inventory coverage failures, 12 are unmet prerequisites, 16 expose current runtime/data/build failures, and one was a Bot Crossing test-authoring error. The corrected Bot Crossing rerun fails both real inventory checks. Three historical G2 rows were subsequently removed from active coverage accounting; the final gap-only run has 77 explicit failures. Do not combine these separate receipts into a fictional one-shot final suite result.

[Sanitized per-case results](2026-10-20-ai-behavior-summary.json) distinguish these categories. Raw traces, JSON and screenshots stay private; they may contain signed-in local data. These observations are local candidate evidence, not hosted or release qualification.

## Findings and follow-up contracts

| Priority / finding | Expected | Actual / evidence | Required repair and regression boundary |
|---|---|---|---|
| P1 — empty-project branch request | Opening/using an unassigned Advanced chat makes valid scoped requests without backend errors. | Seven session/conversation cases log `GET /projects//branches — Project not found`; strict error audit fails them. | Guard the absent project before branch lookup; retain owned unassigned create/send/cancel/delete coverage plus a valid project case. Do not allowlist this error. |
| P1 — Bot Crossing data channel | Actual pinned native scene can page inventory; retained scene regains the same service after tab switch. | Full run direct host IPC: `Colony document revoked`. Focused rerun reproduces host failure and child `[colony:revoked] Colony channel unavailable` after retention. | Diagnose service/attachment lifetime; preserve actual native child and real inventory readback assertions. Visible scene or available/enabled status alone is insufficient. Root cause remains unproven. |
| P1 — embedded Dayflow absent | Advertised workspace attaches its native module and owns a visible viewport. | `dayflowView.getStatus()` is unavailable; the exact local bundle lacks `Contents/Resources/native-dayflow`. | Restore the reviewed source/stage/manifests and compose the native payload through guarded builders. Packaging skips it when RHYTHM_NATIVE_DAYFLOW_LAYOUT is unset. Available tracked wrapper code alone cannot reconstruct the accepted payload. |
| P1 qualification blocker — Dayflow app version | Open action has a validated supported app artifact. | Installed-first validation rejects installed 2.7.2/136 against exact 2.6.0/133 pin. Both inspected app signatures are valid; invalid installed candidates intentionally do not fall through. | Resolve supported version/artifact compatibility with reviewed inputs; do not weaken signature checks or silently replace installed Dayflow. The signed-app action and embedded native module are separate. |
| P2 — listed skill has no readable content | Selecting a listed skill loads matching SKILL.md content. | Catalog auto-selects customize-opencode; content returns 404, failing two catalog/error checks and the explicit skill-content check. | Repair local skill discovery/content consistency or its unavailable presentation. The missing local file may be environmental; defensive 404 alone is not a proven code regression. Keep the first-row test failure visible. |
| P2 — blank Report Card identity | Every authoritative run-quality row has a visible useful label. | First API row has empty agentKind/agentLabel and renders blank, in normal and recovery checks. | Normalize invalid identity or render a deliberate fallback while preserving run evidence; test empty strings as well as null. |
| P2 — Gallery missing thumbnail | Visible deliverable references resolve or present a deliberate unavailable state. | Recovery case logs AgentDesign thumbnail not found, captured by unexpected-error audit. | Diagnose persisted row/file consistency and unavailable UI. This is a missing local artifact observation, not evidence every Gallery deliverable fails. |

To reproduce without changing product sources: `node tools/testing/run_packaged_ai.mjs --grep 'AI Bot Crossing'`, or select `packaged-ai-catalogs.spec.ts`, `packaged-ai-tools.spec.ts`, `packaged-conversation.spec.ts` or `packaged-sessions.spec.ts` with the runner. Real-model conversation requires RHYTHM_FEATURE_MODEL=1. A focused subset never establishes full AI coverage.

## Coverage and test-authoring boundaries

The retained scene after departure is intentional (`colony-view.mjs` suspend/resume and detach), so the original expectation that it closes was incorrect. Recon observed retention; the corrected test keeps that expectation and requires live inventory afterward. Earlier first-pass corrections used the actual searchbox role, compared Hermes history identities instead of assuming limit=1 caps results, and allowed the measured Skills catalog latency. No product assertion or unexpected-error allowlist was weakened.

Current primary/Coordinator prequalification is blocked by an existing canonical primary project cwd that no longer exists. Tests refuse to rewrite that permanent journal. Approval expiry/signed stale denial, first-use primary and concurrent Coordinator execution need disposable app-matched state and native authority. Current memory/profile/tool privacy, owner-switch, account exhaustion/failover, run execution, relay/device and permission cases remain explicitly unqualified. Some narrower CRUD/transport checks need no paid provider or physical phone; the inventory must not imply otherwise. AI webhook UI currently advertises unavailable functionality; recipe workflow acceptance is only partial infrastructure, not a passing authoring-to-PR feature.

All 17 router checks passed in the full run, including actual cheap routing, the routine inline edit, continuation/pin behavior and classifier examples. This does not qualify the entire account-exhaustion/failover matrix or held-out classifier quality. Hermes history, unsent draft retention and notification-overlay restoration passed against its actual pinned child/gateway.

The final suite includes executable runtime checks plus explicit failing coverage markers. A marker records missing assertions/prerequisites; it does not execute the missing feature or prove it is broken. This campaign has not found every possible defect and cannot certify all AI features green.

## Claim provenance for the failures

These are the grouped claim sources, not a claim that the first listed commit caused the observed failure. Full intended outcomes, edge cases, primary issue wording and existing-test limits are in the inventory.

| Inventory group | Source commits | Issue/PR references |
|---|---|---|
| sessions-crud | `58409f4f46`, `10e52a88d3`, `2a9855d4c2` | #1556, #1558 |
| agent-skill-allowlists-and-discovery | `6f78fe6850`, `e7da8cfa0d`, `959b017802`, `431435c074`, `2f0f66d8b3` | Run/source claim; see inventory |
| run-quality-report-card | `3214ff8519` | #1513 (unified Agent Tools list-inspector acceptance) |
| creative-gallery-media | `c4f8c0f0cd`, `2b432f90ef`, `c1c0b3b328` | Run/source claim; see inventory |
| COLONY-01 | `83a34785f0`, `93e75a4c53`, `edc78ef45c`, `8fe332b5d4`, `f5b7ef9c4f`, `3e5fa1448d`, `6fdcf7e2a1`, `b2e57439fd` | #1525, #1526, #1527, #1528, #1529, #1530, #1531, #1532, #1533, #1534, #1535, #1536, #1537 |
| COLONY-02 | `83a34785f0`, `6546f95a4b`, `b612d670a8`, `9c12554fed`, `e5825b35a7`, `3e5fa1448d` | #1533, #1534, #1535, #1536, #1537, #1525, #1528 |
| DAYFLOW-01 | `5a69f1ea9a`, `adf89d68cc`, `49c2e5a01f`, `65fe0338ae`, `06f0a99f20`, `1fce2cf36f` | Run/source claim; see inventory |
| DAYFLOW-02 | `54888e924c`, `49c2e5a01f`, `5c36667493`, `adf89d68cc` | #1605 |

## Disposable-fixture seam audit

The mega already includes an exact-build/private-root `RHYTHM_QUALIFICATION_FIXTURE_MANIFEST` seam. It isolates API SQLite, XDG engine/config/data/state, local logs, skills, commands, memory/artifacts/router and account-file paths. It seeds public identity and synthetic profiles into that temporary store; fixture routes use an explicit hash-bound bearer/AuthContext. This is not real OAuth/provider authentication and must not be reported as such. Current service modes specialize in Dayflow/router; bootstrap refuses a nonempty session store. There is no reusable generic manifest launcher/CRUD seed/cleanup adapter in this suite yet. Building that adapter is feasible missing test infrastructure, so broader local-state coverage is not inherently blocked on a physical device or a user manually editing the permanent journal. Real-model dispatch in isolated engine state needs proper fresh provider auth. OS broker/Keychain and companion paths must be observed separately before claiming full-process isolation. No fixture manifest was created or synthetic-auth run performed in this campaign.

## Added Settings/Profile evidence

Three additional no-write packaged checks passed together after recon/codify corrections: selected MCP status/tool counts against actual service data, model-catalog visibility/search recovery, and live profile rail/editor agreement after API reload. First confirm had two test-authoring mistakes (status capitalization and a broad selected-role locator), preserved separately. These checks do not qualify saving provider/model settings, credentials, permission edits, MCP stdio invocation or model failover. Final discovery is 155 cases/14 files, including 37 new live checks and 77 current inventory gap markers; this is not a final whole-suite passing receipt.

## Intermittent MCP inspector responsiveness — unresolved

The final MCP-only test, after explicit observed status mapping, timed out at 120 seconds. Reload finished in 181 ms; the status-text assertion matched Configured but took about 71.5 seconds, and later rail count assertions were unfinished. API/engine health stayed 200 (22ms/6ms). This does not identify a backend startup failure or prove a stable product regression; renderer/automation responsiveness and its underlying cause need diagnosis. Keep this failed receipt alongside the preceding 3/3 pass, and do not claim reliable MCP qualification. No timeout increase or blind retry was used.
