---
date: 2026-08-10
repo: Rhythm
branch: feat/artifact-viewer
pr: 1338
issues: [1338, 1339]
status: manual_smoke_failed_not_ready
smoke_result: failed
verification_claimed: PASS
divergence: true
expected_chain: [intake-change-classification, context-pack, plan-spec-optional, acceptance-contract, implement-slice, conditional-quality-reviews, verification-gate, project-state-update, draft-pr, manual-smoke]
observed_chain: [planning, AV-01-contract-and-implementation, AV-02-contract-and-implementation, AV-03-MCP-tools, AV-04-tabs-picker, AV-05-PCO-capability, AV-06-native-security-runtime-and-evidence-repairs, AV-07-evidence-reconciliation, verification, project-state-update, draft-pr, human-manual-smoke]
skipped_skills: [early-clickable-shipping-app-product-smoke]
overall_score: partial
tags: [retro, adherence, Rhythm, live-artifacts]
---

# Live-artifact workflow retrospective

## Outcome

PR #1338 is draft but **manual smoke failed and it is not ready**. Automated gates eventually passed, but the delivered native artifact was a security/integration harness, not a usable shipping-app workflow. The orchestrator optimized completion of AV-01–AV-07 contract evidence over revalidating the user's job after the first usable Flutter surface. That is an orchestration miss, not a user-testing failure to explain away.

## User impact

The requested jobs were: bring an existing Claude/HTML artifact into Rhythm; pin it; view/edit it; share it; let an agent update/share it; and use PCO capabilities. #1338 supports cloud creation, pin/view/runtime state updates, and constrained PCO reads. It does **not** provide import, a Flutter Share dialog for an existing artifact, collaborator identity management, or an agent sharing tool. Backend collaborator routes and creation-time visibility existed, but the user-facing and agent surfaces for sharing an existing artifact did not. #1339 tracks Share dialog + agent tool; no import issue exists and none was filed here.

## Timeline

- AV-01/02 built schema, storage, authorization, CRUD, CAS, and sharing backend contracts.
- AV-03 added five MCP tools: list/get/create/update-state/update-bundle; sharing was omitted.
- AV-04 built Dashboard tabs and a picker, then accumulated race/focus/persistence and golden/evidence repairs.
- AV-05 hardened the PCO read boundary; its verification repair expanded test/harness work.
- AV-06 built the WKWebView bridge and then repeated native harness, signing/HOME, fixture cleanup, screenshot, composition, and evidence repairs.
- AV-07 reconciled evidence and marked AC1–AC12 pass; stale project state then called the feature complete before human smoke.
- Human visual smoke exposed the missing end-user journey and rejected the result. CI server check also failed but remains untriaged and is not attributed here.

## Per-criterion comparison

| Criterion | Contract status | Observed status | Category |
| --- | --- | --- | --- |
| AC1 create/stable artifact | pass | works, but creation is not import | C2 wrong contract |
| AC2 managed secure storage | pass | works; not a user job | P process |
| AC3 authorization/sharing backend | pass | backend works; existing-artifact sharing absent from UI/agent | C2 wrong contract |
| AC4 CAS/audit | pass | works; not sufficient for usability | P process |
| AC5 picker/tabs/delete behavior | pass | pin/view path exists; import/share journey absent | C2 wrong contract |
| AC6 secure bridge | pass | harness proved containment, not the requested product workflow | C2 wrong contract |
| AC7 PCO read | pass | narrow capability works; usable calendar workflow was not demonstrated | C2 wrong contract |
| AC8 agent create/update + human read | pass | creates/updates only; cannot share existing artifact | C2 wrong contract |
| AC9 Dashboard interaction | pass | polished tab mechanics, no end-user artifact lifecycle management | C2 wrong contract |
| AC10 manual edit/PCO sync | pass | harness fixture evidence, not a complete user-facing calendar path | C2 wrong contract |
| AC11 schema parity | pass | works; infrastructure was over-weighted | P process |
| AC12 runtime/screenshots/evidence | pass | evidence existed but did not validate product usefulness | C3 false green |

## Root causes

1. **Design approval did not contain an end-to-end journey acceptance table.** The plan explicitly made local-file import a V1 non-goal and specified only creation-time collaborators/MCP creation. That scope decision was never re-presented as a clickable shipping-app journey, so a core job silently became excluded.
2. **Thin slices sequenced infrastructure/security before product validation.** AV-01–03 and AV-05 made technically sound foundations, but no human saw a shipping-app prototype after AV-04, before AV-05/06 investment.
3. **Contracts measured implementation claims, not jobs-to-be-done.** AV-07 inherited passing evidence from earlier slices. AC12 accepted screenshots and harness results as final evidence; no criterion required import, existing-artifact Share, human-readable collaborator selection, or agent sharing.
4. **“Keep going until finished” became “close every contract criterion.”** The orchestrator lacked a revalidation checkpoint and treated evidence reconciliation as completion rather than a question of whether the app solved the user problem.
5. **Demo framing was misleading.** A native security/integration harness was described as native demo evidence. A harness is valuable verification, but it is not a shipping-app demo.

## What worked

- The backend authorization, immutable storage, CAS, PCO confinement, sandbox isolation, and native bridge work produced useful foundations.
- The run notes preserved enough chronology to diagnose churn instead of inventing a story.
- Several repairs correctly found real defects: AV-04 async/focus persistence races, AV-05 shared test-storage race, and AV-06 fixture cleanup/harness attribution defects.
- Human smoke happened before merge, preventing a user-rejected result from landing.

## What failed

- Repeated implementation → verification → triage loops were accepted as forward progress even when they produced only evidence/harness repair.
- Contract statuses and project state became load-bearing claims while user-facing gaps were outside the contract. `project-state.md` currently says complete/PASS and must be corrected by its owner.
- Worktree/sandbox discipline consumed effort: wrong/contaminated environment variables, redirected Flutter HOME, sandbox PID/orphan behavior, and dependency-cache corruption repeatedly obscured product signal.
- GitNexus manager/CLI disagreement was recorded but did not yield a single authoritative decision; re-review work expanded around discrepant evidence.
- Screenshot capture/composition churn consumed multiple AV-06 loops to prove chrome/harness behavior, while no early human assessed whether the product could import or share an artifact.
- Evidence-only AV-05/AV-07 repairs repeatedly reopened review without a budget or escalation trigger.

## Session/churn analysis

The reported ~91 specialist sessions cannot be allocated exactly from the run notes, but the notes demonstrate material avoidable churn. Necessary work was the seven planned slices plus one integrated verification/handoff (roughly 8 major units). Avoidable repeat work included at least: AV-04 two repair/re-review cycles; AV-05 two evidence repairs plus shared-storage test-harness repair; AV-06 blocked launch, signing/HOME/cache diagnosis, async-JS harness repair, fixture cleanup repair, screenshot API attempt, composition repair, C3/C4 fixture repair, and final evidence reconciliation; AV-07 inherited-evidence reconciliation and sanitized-environment reruns. These are **at least 10 named repair/evidence loops**, exclusive of their specialist sessions.

The orchestrator should have stopped after AV-04's first clickable Dashboard/picker and requested a human product smoke. It should have collapsed later evidence-only redispatches into one bounded verification owner, reconciled contract statuses mechanically, and escalated after two repairs on the same user journey rather than continuing screenshot/harness work. The CI server failure is a separate pending gate, not proof that the product failure was infrastructure-only.

## Corrective actions

1. For nontrivial user-facing work, plan an acceptance table mapping each named user job to an in-app entry point, success observation, owner, and validation. A stated non-goal that removes a named job requires explicit AJ confirmation.
2. Before backend hardening beyond the first usable vertical slice, run a clickable shipping-app skeleton smoke. For this sequence, it was required immediately after AV-04 and before AV-05/06.
3. Review CRUD surfaces explicitly: create/import, list/pin, view/edit, share/manage collaborators by human-readable identity, agent parity. Missing surface is `UNVERIFIED`, not implied by backend routes.
4. Label native/security fixtures as **harness evidence**, never demo. A demo/PR-readiness claim requires manual smoke of the shipping app; draft PR may be opened only as `manual smoke pending`, never described as product-ready.
5. Cap evidence-only re-review loops: one consolidated reconciliation after implementation; repeated repair for the same journey or a delegation/session budget breach stops for AJ revalidation rather than additional specialist fan-out.

## Skill changes

Small surgical changes are required in `planning-agent`, `acceptance-contract`, `workflow-orchestrator`, and `verification-gate`: require end-user journey mapping for nontrivial UI work, require an early shipping-app smoke checkpoint after the first clickable slice, reject backend-only CRUD parity as UI/agent proof, and reserve ready/done language until manual smoke. These are narrow enforcement additions; no profile changes or broad topology changes are warranted.

## Follow-up

- #1338: retain draft; mark **manual-smoke failed / not ready**. Do not merge, deploy, mutate the PR, or manipulate the running isolated native demo.
- #1339: existing-artifact Share dialog plus agent sharing tool remains the approved follow-up.
- Import is untracked. Recommended issue for AJ approval (do not create here): **“Import existing Claude/HTML artifact into live artifacts”** — accept an existing artifact safely, create/pin it in the shipping Flutter app, and prove import → view/edit → share with a human-readable collaborator.
- Recommended `project-state-updater` change: replace all “complete/final PASS/ready for human smoke” language with “PR #1338 manual-smoke failed/not ready; automated evidence passed but product journey is incomplete; #1339 tracks sharing; import needs AJ-approved follow-up.” Add the untriaged CI server failure as a separate pending risk.
