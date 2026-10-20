---
date: 2026-10-20
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1598]
status: in-progress
tags: [run, rhythm, playwright, repair]
index: "[[Rhythm]]"
---

# Repair AI qualification failures and rebuild local mega

## Authorized scope and acceptance

AJ now authorizes fixing the discovered failures, starting with Bot Crossing and empty-project session requests, rebuilding the mega app locally and rerunning Playwright while continuing safe coverage. Previous local-only/no push/PR/merge/install and owned-data boundaries remain. Real-model opt-in carries forward.

Using workflow-orchestrator, failure-triage and coding-agent lanes. Acceptance-contract intake reviewed: this is a direct user repair request with no new GitHub issue body/number; no issue-N contract is fabricated. Existing executable failing packaged cases are the acceptance contract before product changes: actual Bot inventory agreement, retained scene usable inventory, and named unassigned session persistence/cleanup with strict error audit. Additional focused source regressions must fail before fixes and preserve valid-project behavior and exact native document authority. Original failing records remain in the October 20 qualification report.

## Sequence

1. Repeat exact locally built d7 candidate RED for Bot Crossing and owned session.
2. Independent targeted source repairs (Colony runtime/view and session branch loading), with GitNexus impact and focused red/green.
3. Resolve additional observed skill/Report Card/Gallery failures where root cause can be established safely; restore Dayflow inputs only if reviewed provenance is recoverable.
4. Commit source candidate locally, rebuild fork/web/API/MCP/Electron with 10 GiB guard, sign locally and verify exact identity/signature.
5. Rerun focused acceptance, additional recon/coverage and broad AI suite; classify remaining product failures vs unverified prerequisites.
6. Record clean owned-data and runtime teardown. No release/overall qualification claim while required cases remain failed.

## Initial state

Test head d8dba691a6ba9b15078ad212ff4cee6388f70dce; existing signed product source d7fb554735f93c0d0a76785cbadd583d0f866610; current worktree initially clean. Original checkout dirt is unrelated and preserved. Prior full run was 46 pass / 109 fail, with explicit gap/prerequisite/test-authoring categories. Native Dayflow inputs were not found at prior recorded locations; validation must not be bypassed.

## Checks

In progress. Private repair RED command: `node tools/testing/run_packaged_ai.mjs --grep 'Bot Crossing|named session persists' --output /private/tmp/rhythm-ai-repair-red --reporter=list,json`.
