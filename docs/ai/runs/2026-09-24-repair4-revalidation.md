---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1468, 1491, 1565, 1569, 1572, 1574, 1582]
status: partial
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Repair 4 revalidation and integration record

This is a factual work record, not an overall acceptance PASS. Integration currently contains four repair commits: #1565 `3c1e493c`, PR #1578 `5908bf6f` (its inherited test filenames say issue 1577), #1491 `8c0cecd4`, and #1582 `a28bcbb4`. The final `ai-workflow checks --level pr` completed all 16 stages, exit 0, on the source state committed as `9bd0dc320f9fa96610b726929075b6535d9010ce`. No merge, deployment, installed-app, or release claim follows from these commits.

## Integrated checks

- #1565: `cd apps/web && node --test tests/contract/issue-1565*.test.mjs` passed 15/15. Integrated `npx playwright test tests/timestamp-1565.spec.ts --workers=1` passed 2/2, including Kolkata; evidence `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/1565-integrated-browser.log`. The earlier candidate RED and GREEN, fixture screenshots, and source scope are in [the #1565 run](2026-09-24-issue-1565-repair4.md).
- PR #1578 and #1491: focused API run passed 22/22 across five files (`/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/integrated-api-focused.log`); focused MCP/security run passed 13/13 across three files (`integrated-mcp-focused.log`). Fresh isolated synthetic API/engine sandbox :6598/:6597/:6599 passed both env-gated prompt and webhook live files, 2/2 (`integrated-backend-live.log`), then was torn down. The [PR #1578 run](2026-09-24-pr1578-repair4.md) records its separate 13/13 focused command and 1/1 real fork/API/MCP synthetic-provider sandbox run. The [#1491 run](2026-09-24-issue-1491-repair4.md) records Flutter watcher 18/18, the occupied-composer RED/GREEN, and the one-line callback fix.
- Flutter integrated watcher suite passed 18/18 (`integrated-flutter-watchers.log`); whole-project Dart format check reported 525 files, zero changes (`integrated-flutter-format.log`); `flutter analyze --no-fatal-infos` exited 0 with 319 infos (`integrated-flutter-analyze.log`).
- #1582: `cd apps/web && npm exec -- playwright test --config tests/contract/issue-1582-playwright.config.ts` passed 3/3 on the candidate; the integrated StrictMode browser replay also passed 3/3 (`integrated-transcript-browser.log`). Transcript unit contracts passed 34/34 (`integrated-transcript-unit.log`). The [#1582 run](2026-09-24-issue-1582-repair4.md) and its independent review limit this to synthetic transport and exercised event orderings.
- Integrated web build passed (`integrated-web-build.log`); notification browser checks passed 5/5 (`integrated-notifications-final.log`). The separate 16-stage repository gate also passed.

## Deferred and separate work

- #1574 is **deferred**. The final candidate and integration files matched, but integrated `issue-1574-c2` still failed: after index shutdown the child exited and `serve.owner` remained. The replay was 58/59 (`integrated-engraph-final.log`). See `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/1574-final-review.md`; the preserved candidate is `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/1574-final-deferred.patch`. No real Engraph, machine-process cleanup, or full issue PASS is claimed.
- #1572 is **deferred** despite 59/59 focused API tests and both synthetic live sandbox phases passing. The second live phase needed a bounded test retry across the documented five-second empty-inventory cache; see `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/1572-independent-review.md` and `1572-live-review.md`. Connected direct-cloud model availability remains `unknown` without account entitlement proof, so actual OpenAI/Anthropic/Gemini picker usability is unverified. The full API suite and installed behavior are not qualified by those focused results.
- #1468 received **no product source change**. `npx vitest run src/services/__tests__/gemini_tool_cap.test.ts` passed 12/12; fork allowlist tests passed 8/8; an oversized synthetic 605-tool fork capture passed 2/2 and offered 12 declarations with dispatch to the final synthetic tool. `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/1468-verification.md` records commands and limits. No Google-account request or full end-to-end session was run.
- #1569 S0 is frozen at `50b8a46d`. S1 and S5 remain in `/private/tmp/rhythm-1569-s1` and `/private/tmp/rhythm-1569-s5` at `50b8a46d`; S3 remains in `/private/tmp/hermes-1569-s3` at `8ea642db`. The independent S0 review passed the 28-criterion **documentation** contract only (`/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-repair4/1569-independent-review.md`). No implementation or credential-runtime acceptance is inferred.
- #1565 real-data timestamp browser qualification remains open. The final live run failed 2/2 at its no-external-origin guard because page requests targeted `https://timestamp-test.invalid`; neither test reached timestamp assertions (`integrated-timestamp-live-2.log`). Only the live harness URL was modified during triage, no timestamp product code; synthetic fixtures were cleaned. Fixture-browser success does not establish hosted, installed, or native timestamp behavior.

Production PostgreSQL and credentialed-provider checks, installed/native desktop behavior, and issue-wide manual smoke remain separate from this focused integration record. The configured repository gate passed; pushed-head CI remains pending. This is not overall native or release qualification.

## Preservation and scope

The failed Engraph candidate was removed from integration and preserved as a patch and in its original worktree. Existing dirty documents were not staged or reset. The separate Bot Crossing candidate remains untouched. The timestamp probe config-only correction is `9bd0dc32`. The sandbox was torn down through `tools/dev/sandbox.sh down`; sanitized diagnostics were preserved.
