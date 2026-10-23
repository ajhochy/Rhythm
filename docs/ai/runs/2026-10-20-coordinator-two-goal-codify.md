---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pending
tags: [run, rhythm, packaged, coordinator]
---

# Coordinator two-goal Codify from private Recon

## Files

- `apps/web/tests/packaged/packaged-ai-private-coordinator-two-goal.spec.ts` codifies the observed full packaged UI → Coordinator → async SDK children → Git effects → one marked wake per child → post-wake SDK reports path. It derives expected revision from the package/fixture, uses the reviewed synthetic actor and bounded model loan, writes its sanitized receipt under `testInfo.outputPath`, and imports only checked-in helpers. No b7d5 or old private fixture path is hardcoded in the test.
- `docs/testing/results/recon-ai-coordinator-two-goal.md` records the observation and its limits. Private checked config/launcher instructions are in `/private/tmp/rhythm-coordinator-two-goal-checked-20261020/README.md`.

## Checks

- Pre-edit GitNexus impact was stale (index 321 commits behind this worktree): `startCodingWorkflow` unindexed/UNKNOWN; `CoordinatorConversationCard` ambiguous with max LOW/0. Manual scope is one newly added packaged test and private config; no production symbol changed.
- Targeted strict TypeScript noEmit passed; Playwright discovery listed exactly one test. **Native checked Confirm is UNRUN.** No build, app, API, engine, MCP, model, loan, or sandbox was started for this Codify.

## Existing-test triage and boundaries

- Existing `packaged-coordinator-multi-run.spec.ts` read-only Runs-row case is KEEP for mapping an already present server run to UI status. It requires a preexisting run and does not create or qualify two goals.
- Its explicit `UNVERIFIED two simultaneous repo goals` gap remains until this new checked test passes on a fresh fixture. The adjacent needs-you/Stop and restart gaps remain; no assertion was weakened or removed.
- The checked test requires actual finished/reported rows **and** one-file commit, successful 15-second verification output, owned worktree/Git common-directory association, exact parent/delegation/model provenance, overlapping persisted SDK assistant intervals, UI run rows, and one marked input wake followed by completed Secretary output per child. A returned `finished` status alone is insufficient.
- The test can cancel only exact nonce-owned active goals if it fails. The canonical primary and model loan are durable fixture state; the external loan runner must stop the app, preserve bounded sanitized failure metadata, verify ports 4001/4096/4002 free, and scrub the **whole fresh credential-bearing fixture after PASS or FAIL**. It must not delete an operator or prior fixture.

The first fresh checked Confirm on exact b7d5 failed late after both owned goals were `finished` and `reported`, their separate commits and 15-second verification outputs were proven, and the SDK intervals overlapped. The test took one root-message snapshot immediately after the async wake was enqueued and found no completed post-wake Secretary report for goal 2. It did not establish whether the callback was still pending or omitted. Preserve this RED result: `/private/tmp/rhythm-private-b7d5-coordinator-checked-confirm-20261020.log` and `/private/tmp/rhythm-coordinator-two-goal-checked-20261020/output-5XUJx3/`.

The checked test now polls only fresh persisted messages for that exact primary root, at most 90 seconds and never beyond the existing model-loan hard stop. It still requires one marked wake per child and separate completed OpenAI/Luna output naming the exact branch and worktree. Before the final assertion, its receipt records bounded metadata for each later message: role, SDK ID, completion flag, model match, and branch/worktree match, without raw text. A missing report can thus be distinguished from a pending callback in the next run. No extra model send or retry was added. Default registration without both the private manifest and explicit model opt-in now uses a raw Playwright test that fails `UNVERIFIED` without launching the packaged fixture; this no-fixture branch was exercised and failed as designed.

GitNexus could not index the newly added test path or callback in its 321-commit-stale graph (UNKNOWN). Manual blast is this one checked test's registration and post-wake observation only. The next independent native Confirm and any wider inventory claim remain pending the parent's exclusive run. A scripted or source-level check cannot replace real Luna SDK/UI confirmation.
