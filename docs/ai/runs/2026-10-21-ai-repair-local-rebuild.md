---
date: 2026-10-21
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, rhythm, playwright, local-build]
---

# AI repair and fresh local qualification

## Files

- The MCP renderer now waits for authenticated setup before its first catalog read; both Settings and Profiles cancel reads when leaving the screen.
- Background tier routing now consults the live permitted model catalog instead of choosing an unauthenticated static Claude route. Explicit model overrides retain precedence. The managed title model is reconciled again after the engine starts, because the initial pre-spawn pass cannot inspect a live catalog.
- Catalog/schedule/research reload observers identify the new document's requests and consume their bodies before navigating again. The strict UI/backend assertions remain.
- New checked private tests cover Hermes OpenAI/Luna, two concurrent Coordinator jobs, and automatic conversation names; private account-fallback coverage exercises the actual bundled Claude plugin against local HTTP servers.

## Checks

- Exact signed b7d5 router/main Auto/MCP selection: 19/19, 108.468 seconds, no skipped/flaky/unexpected cases; run and fixture scrub exit 0. Report `/private/tmp/rhythm-b7d5-qualification-launch-20261020/router19-AWpXpR/report.json`.
- Exact signed b7d5 checked Hermes: 1/1, 68.602 seconds total, CLI 0. Report `/private/tmp/rhythm-hermes-one-turn-checked-BCRn0K/turn-report.json`. Whole fixture scrubbed, source hashes unchanged, dynamic Hermes port free and secret file absent.
- Fresh b7d5 Coordinator: 1 failed, 108.896 seconds, CLI 1. Both actual jobs, separate commits, overlap, exact wake counts and completed post-wake reports passed. Unexpected-error audit caught a separate background skill-extraction run selecting unavailable `anthropic/claude-haiku-4-5` and failing `ProviderModelNotFoundError`. Report `/private/tmp/rhythm-coordinator-two-goal-checked-20261020/output-qazWVl/report.json`; brGZYQ scrubbed with unchanged source hashes. The audit was not relaxed.
- Improved b7d5 auto-name diagnostic: 1/1, 42.2 seconds total, CLI 0, following the earlier checked placeholder-title failure. In the successful run no managed small_model was configured; a private field-only engine-log projection observed the title call using OpenAI/gpt-6-luna. This does not establish the cause of the previous intermittent failure or erase it.
- MCP controlled browser contract: original 2 failed/1 passed, expanded 4 failed/1 passed before source change; 5/5 after. Nearby Settings/Profiles 7/7 and gateway source assertions 13/13. See `2026-10-21-mcp-readiness.md`; these are browser/source checks, not fresh packaged proof.
- Claude plugin local-server coverage initially exposed test-fixture notification cross-talk: fire-and-forget spillover events from one case arrived during the next case using the same SDK ID. Unique per-case identities and event correlation preserve the behavior checks. Final command `npm run build:guard -- bash -c 'cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/anthropic_plugin_routing.test.ts --reporter=verbose'`: 15/15, exit 0, 1.38 seconds. Log `/private/tmp/rhythm-anthropic-failover-final-20261021.log`. This is bundled-plugin transport proof, not a paid Claude account run.
- Expanded synthetic packaged selection: 86 cases discovered across 32 files, no UNVERIFIED markers. Includes the previous broad60 plus catalogs18, navigation3 and tasks5. Discovery is not execution. Private launcher `/private/tmp/rhythm-updated-final-qualification-20261021/launch-final.mjs` uses the guarded synthetic fixture runner and rejects any result other than exactly 86 expected cases with zero failures/skips/flakes/errors.
- New exact-source local build/sign, sandbox canonical-tool gate, expanded packaged selection and paid reruns: pending.

## Notes

GitNexus is 321 commits stale; low/unknown indexed impacts are supplemented by manual review. Background model selection and post-ready managed configuration have a HIGH shared runtime blast radius, reported to the user before edits. Authenticated MCP startup has moderate shared renderer scope. The new behavior remains a candidate until rebuilt local-app and live-backend qualification.

The original mega checkout and its three pre-existing dirty paths remain untouched. Only one active task worktree exists. No push, PR, merge, installation or release. Coverage remains incomplete: 78 active markers across 83 inventoried behavior groups are not cleared by these scoped checks.

## Exact 825c local qualification follow-up

- Committed local candidate `825c53bc9f1b4d3081de8a6a5a5c38de129a93d9`, built locally and Developer ID signed. Deep strict codesign passed; no notarization, installation or GitHub build. Build/sign logs `/private/tmp/rhythm-ai-native-825c53bc9f-{driver,wrapper,layout,build,sign}.log`; Hermes remains pinned to `2ad39a4cdb`, native Dayflow inventory has 281 files.
- Expanded packaged selection executed **80 passed / 6 failed / 0 skipped / 0 flaky**, 345.158 seconds, CLI 1. Report `/private/tmp/rhythm-updated-final-qualification-20261021/run-LnNDlX/report.json`. All six formerly failing b7d5 broad cases now pass, including authenticated MCP startup reads. This is still a failed aggregate.
- New failures: Dayflow standalone status unavailable; empty Tasks account observer wrongly selected a missing filter; three task cases failed strict runtime audit on intentional owned post-delete GET404s; real Tasks retry defect saves the row but leaves the server-error surface covering it. Test-only empty-state and exact owned-delete audit corrections are ready; explicit deletion404 assertions remain. Tasks product patch is prepared outside the frozen checkout.
- Fresh825c checked Coordinator failed early after15.7 seconds on a completed MCP `describe` step. OpenCode marks tool-cycle assistant messages completed before the overall turn ends; the test incorrectly treated this as a terminal no-delegation answer. Correct terminal/idle observation is in progress; no current Coordinator or background-model success is claimed. Whole paid fixture scrubbed, source hashes unchanged. Report `/private/tmp/rhythm-825c53bc9f-checked-private-20261021/coordinator/confirm-Yjy2Ys/report.json`.
- First canonical live sandbox attempt failed before prompt execution: synthetic credential restoration restarted the engine after test session creation. Absolute sandbox shutdown succeeded; corrected private setup waits for the replacement healthy boot before creating the session. Fresh confirmation pending.
- First private skill-extraction observer failed during discovery because Playwright cleared its output root. No model behavior was exercised; whole paid fixture scrubbed with unchanged source hashes. Output root and test-results directory are now distinct; fresh observation is running.

All78 active markers remain incomplete. No scoped result is added to another run to manufacture an aggregate.

### Positive825c follow-up and next repair batch

- Private background extraction observation passed1/1 (2.4min total), run0/scrub0 and unchanged source hashes. Two actualUI/SDKOpenAI/Luna turns triggered exactlyone source-attributed system extractor, completedonLuna withzero tools. A thirdGAMMA turn provedno duplicatequeue; bothowneddeletes204/restoresclean. `/private/tmp/rhythm-skill-extract-recon-20261021/output-0T2ZJA/observation.json`. This is a private observation; checkedCodify/independentConfirm pending.
- Canonical MCP private live boot-barrier Recon passed1/1 in4.75s; sandboxshutdown0/ports4097–4099free. `/private/tmp/rhythm-mcp-canonical-boot-barrier-20261021/live-recon.log`. RealAPI/engine/stdio, scriptedloopbackprovider; no paidmodelclaim. Correctedsetup patch applied to checkedgatedtest.
- Dayflowprivateprobe failed1/1: nativeviewreadyattached, standaloneARTIFACT_INVALID before/during/after. `/Users/ajhochhalter/Applications/Dayflow.app` is now2.7.3/build137, while currentinstalledexceptionrecognizes2.7.2/136only. Exactdesignatedrequirement/deepstrictcodesign0 andGatekeeper acceptedNotarizedDeveloperID0. Operatorappwas neitherchanged norlaunched. Narrowreviewedversionadditionunderway.
- Tasksready-state repair applied; testterminalCoordinatorobservernowrequiresfinishstop+twofreshidle samples. FullserialAPIgate started aftercanonicaltestpatch: `npm run build:guard -- env RHYTHM_LIVE_E2E=0 RHYTHM_SHARED_AGENTS_AUTH_OUTAGE_LIVE=0 npm --prefix apps/api_server test --silent -- --fileParallelism=false --reporter=default --reporter=json --outputFile=/private/tmp/rhythm-api-final-20261021.json`; stdout `/private/tmp/rhythm-api-final-20261021.log`. Resultpending.

### Owned build hygiene

Retired exact owned5dff generated wrapper/layout after preserving root JSON build/signing/composition metadata and SHA256 records in `/private/tmp/rhythm-retired-5dff-build-metadata-20261021`. Removed trees were193088KiB bydu; uniquephysicalAPFSreclaim was not measured. Current825c and previousb7d5 payloads retained. `git worktree list --porcelain` still shows originalmega checkout plus exactlyone active taskworktree.

### Dayflow and added Org Reviewer design

- Dayflow narrowcandidate acceptsreviewedinstalled2.7.2/136 and2.7.3/137 only; packaging remains2.6.0/133. RED installed137 versioncheck1failed/1passed; GREENartifact+host13/13. Commands/results andrealread-onlysignedinstalledmetadata are transcribed in `/private/tmp/rhythm-dayflow-273-validation-20261021/receipt.json`; originalinteractive stdoutlogs were notsaved. Installed137 executableSHA256 `c9ab349a794221cd8396fe3608ecfddb67f5bdffbae562d6b58c06cb6944a800`. No installedappchange/launch.
- Webtypecheck `npm run build:guard -- npm --prefix apps/web run typecheck` exit0, log `/private/tmp/rhythm-web-final-20261021.log`.
- UseraddedfullOrgOptimizerjourney design. Source-backedplan `docs/ai/plans/2026-10-21-org-reviewer-end-to-end-playwright.md` separatescurrentOrgReviewer fromretiredoptimizer, proposed/apply frommeasuredoutcome, existing-skillrefinement fromunsupportednewskill/testgeneration. RealUIscanentry is AgentSchedules/OrgReviewer/Triggernow. ReactQueue lacks evidence/change/rollback/verificationdetailrendering andexperiment/revisecontrols; these remainexplicitgaps.
- Focusedrealrepository/managedfile stale-approvalRED: unchangedpreimage1passed; interveningDB+managedfilehumanedit1failed becauseapprovaloverwrotebothnewerbodies andadvancedtomeasuring. NoAPI/native/modelran; finalization/measurementwereinjectednoops, soapplierboundaryonly. ImmutableRED `/private/tmp/rhythm-org-optimizer-refine-skill-recon-20261021/red-test.log` and`red-observation.json`. Narrowpatchoutsidecheckoutunderreview; liveAPI/engineobserverpreparationpending.

### Pre-Org aggregate and stale-approval source qualification

- FullserialAPIgateat825cproductionbackendpluscanonicalsetup-testpatch passed:8839passed/0failed/392gatedskips;1204.54s;CLI0; JSONsuccess:true. `/private/tmp/rhythm-api-final-20261021.json` and`.log`. This run finished BEFOREthe new skillguard andisnot afinalguardaggregate.
- Appliednarrowsemanticpreimageguardin`validateRefineSkill` and`refineSkillApplier`: compareproposalpriorBodywithcurrentmanagedbody(DBfallbackonlywhenfileabsent), recheckimmediatelybeforethesynchronousapply. GitNexusLOW0/322commitsstale; manualHIGHsharedapprovalscopewarneduserbeforeapply. NotuniversalDB/frontmatter/cross-processCAS; currentmanaged-fileauthoritypreserved.
- Newcheckedsource-boundaryregression5/5 onactualcheckout,then5/5againafterpre-importprivateXDG/env isolationrefinement. Measurement/finalizationareexplicitnoops; notengine/HTTPproof. `/private/tmp/rhythm-org-skill-guard-checked-isolated-20261021.log`.
- Relatedclusterfirst234passed/6failedin8files: six#1082fixturesconstructedpriorBodyfromstaleDBwhilefilewasalreadycurrent, a proposalcurrentReviewersubmissionwouldreject. Test-onlyfixturecorrectioncreatesfilebeforeproposal/capturesactualsemanticpreimage; alloriginalbyte-exactrollbackandunsafecontentassertionsremain; addsobsoleteDB-preimagerefusalcase. Finalninefilecluster246/246,43.84s,CLI0: `/private/tmp/rhythm-org-skill-guard-focused-corrected-20261021.log`.
- APItsc`npm run build:guard -- apps/api_server/node_modules/.bin/tsc --noEmit -p apps/api_server/tsconfig.json` exit0; `/private/tmp/rhythm-api-skill-guard-tsc-correct-20261021.log`. Firstverificationcommandusednonexistentnpmtypecheckscriptandfailedbeforecompilation; notaproductfailure.
- Post-fixstale-onlysignedReviewer/API/engineobserverpreparedoutsidecheckout; unchangedpositiveHTTPapprovalexcludeduntilbackgroundscorerroutingisprovenloopbacksafe. Exactnewcommit/localbuild, liveguardproof, finalbackendrefreshandnativeConfirmremainpending.
