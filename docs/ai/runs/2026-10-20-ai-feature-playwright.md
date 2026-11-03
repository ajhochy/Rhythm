---
date: 2026-10-20
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1598]
status: qualification-failed
tags: [run, rhythm, playwright]
index: "[[Rhythm]]"
---

# Month-wide AI behavior qualification

## Scope and provenance

AJ authorized inventory/testing of all AI features, including Dayflow, Hermes and Bot Crossing, with cheap subagents researching the last month of commits/issues, comparing existing Playwright, and filling gaps. This broadens the prior P1/P2 checkpoint. It does not authorize product repairs, account/server changes, integration grants, real messages/invites, installation, push, PR or merge. Real-model P0 opt-in carries forward via RHYTHM_FEATURE_MODEL=1.

Three gpt-6-luna research agents produced core AI, companion and workflow ledgers, then read-only GitHub primary evidence and merge-provenance follow-ups. Parent integration includes 82 behavior groups (77 active/partial user-feature claims plus five audit/retirement boundaries), 489 commits and 77 primary issue/PR evidence records (73 unique numbers). All 40 merge ambiguities were traced through unique second-parent commits. Subject/path classification is an index, not semantic or runtime proof. See [inventory](../plans/2026-10-20-ai-feature-test-inventory.md), its machine-readable sibling and the complete month commit ledger.

Remote mega remains 894c16f44d30c77dc25d41e7d9a57a644b6ffcfa (read-only git ls-remote checked this run). Product candidate is the locally built/signed 0.18.83 bundle from d7fb554735f93c0d0a76785cbadd583d0f866610, unchanged at original test head 8faf4e2156. No product files change in this run. Source identity, bundled/live engine and unchanged product diff are required by the new runner; an older installed app cannot substitute. The existing local artifact is reused rather than rebuilding identical product sources for test-only changes.

## Files

- AI feature inventory, month-wide commit ledger, primary GitHub issue/PR evidence.
- `apps/web/tests/packaged/ai-surfaces.ts` and new packaged AI catalog, tools, schedules, cookbook and companion specs.
- `packaged-ai-playwright.config.ts`: one worker/no retries, includes existing session/conversation/primary/Coordinator/approval/router tests and explicit inventory gaps.
- `packaged-zz-ai-coverage-gaps.spec.ts`: unverified claims fail explicitly; they are not product-regression red evidence.
- `tools/testing/run_packaged_ai.mjs`: exact local artifact/source guard and repeatable suite command.
- Sanitized recon records in `docs/testing/results/recon-ai-*`; no private memory/chat/task bodies or credentials.

## Checks

Strict packaged TypeScript and runner syntax checks return zero. Initial discovery lists 155 cases in 13 spec files: 34 new live behavior checks, 41 existing AI cases, and 80 explicit coverage failures. This is a coverage accounting total, not a passing result.

Read-only Recon command used a temporary, uncommitted packaged observation spec with the exact bundle/revision. It was removed after sanitized observations were recorded. The focused Recon also created one inert nonce-owned cookbook recipe through UI (201), read it back, deleted it (204), and observed 404. No model prompt was sent during Recon.

Initial 32-case run (the two schedule cases were added afterward) returned 21 passed / 11 failed in 12.4 minutes, no skips/retries/flaky results. Four failures involved the observed codify mistakes (Skills wait, Hermes assumed page cap, and the two Colony search-role cases); actual data/packaging/error-audit failures remain visible. Raw output: `/private/tmp/rhythm-ai-new-tests.log`; JSON destination: `/private/tmp/rhythm-ai-new-tests.json`. These are private; final receipts follow below.

## Full-run receipt and triage

At committed test snapshot `8ca697e58f606b9001be4a9c39d9bac00026a6d7`:

```sh
RHYTHM_FEATURE_MODEL=1 node tools/testing/run_packaged_ai.mjs
# exit 1; 46 passed / 109 failed / 0 skipped / 0 flaky; 17.4 minutes
```

Of 109 failures, 80 are intentional inventory coverage markers, 12 are missing prerequisites, 16 expose runtime/data/build failures and one was a test-authoring error. The 75 non-inventory cases were 46 pass / 29 fail; 34 of those were new tests. All 17 router checks passed. Hermes actual history/draft/overlay checks all passed; cookbook owned inert CRUD and cancelled draft, schedule history/cancel, memory inspection/filter/search and shared-agent readiness also passed. A catalog pass does not qualify that feature's execution/privacy boundaries.

The Bot Crossing retention assertion was wrong: route departure intentionally suspends rather than destroys the child. Fresh observation confirmed the original page stays open; source suspend/resume handlers agree. Corrected test requires same child plus real inventory after return. Focused command `node tools/testing/run_packaged_ai.mjs packaged-ai-companions.spec.ts --grep 'Bot Crossing' --output /private/tmp/rhythm-ai-colony-confirm --reporter=list,json` → exit 1, **0 passed / 2 failed / no skips/flaky**, 91.7 seconds. Host IPC reproduces `Colony document revoked`; after tab restoration the actual child returns `[colony:revoked] Colony channel unavailable`. The service/attachment failure remains uncorrected and its deeper root cause is not proven.

A source follow-up resolved three G2 rows as historical after d03bf90e08: finite admission, callback/capacity and checked-result/next-ordinal contracts are removed; remaining fork schema-2 guard has no current non-test enrollment producer. Current generic Coordinator goals and status-only capability disclosure remain separate active claims. Final gap-only command `node tools/testing/run_packaged_ai.mjs packaged-zz-ai-coverage-gaps.spec.ts --output /private/tmp/rhythm-ai-gaps-final --reporter=list,json` → exit 1, **77 explicit UNVERIFIED failures**, 43.2 seconds. No app fixture launches for these markers. The final inventory change is not evidence that those missing flows ran.

Concrete findings, follow-up contracts and sanitized per-case counts: [findings](../../testing/results/2026-10-20-ai-findings.md), [JSON summary](../../testing/results/2026-10-20-ai-behavior-summary.json). Local skills content 404, blank Report Card labels, missing Gallery thumbnail and seven empty-project branch errors are retained. Native Dayflow payload is absent from the exact local bundle. Separately, installed 2.7.2/136 is validly signed but rejected by the 2.6.0/133 exact pin, intentionally shadowing bundled fallback. Accepted native source/stage/manifests are missing at documented locations; no signature bypass, installed-app replacement or reconstructed manifest was attempted.

Using failure-triage: current product repairs are OUT OF SCOPE for this testing request; local follow-up contracts are in the findings report. Qualification remains failed. Source-only/fixture-only tests and unresolved markers are not a release pass.

## Safety and completion boundary

Only nonce-owned inert cookbook records are written by new checks; no recipe execution. Existing schedules/history, memories, shared agent definitions and companion stores are read-only. Hermes new drafts remain unsent and are cleared only if they still match the exact test nonce. No real task is archived/opened across external harnesses. Original checkout dirt remains unrelated and preserved.

Every unresolved feature claim remains a failing UNVERIFIED case describing missing assertions or prerequisites. Some narrower CRUD/read-only/transport checks can run without provider/device fixtures; broader execution, ownership and native boundaries cannot inherit those successes. Many need an isolated signed-in primary/journal, sanitized harness/Dayflow sources, owner identities, safe tool receivers, or physical/mobile/native permission fixtures. Catalog/UI success never qualifies those boundaries. Overall AI qualification cannot be called green while these fail.

Corrected codify errors before the canonical full run: searchbox role from actual pinned markup; history identity equality before/after overlay instead of an unsupported page cap; 60-second reload discovery bound matching the live catalog timing. Companion guest pageerrors are audited in addition to host renderer errors. No product code or log allowlist changed.

## Additional safe gaps closed after full-run triage

Added `packaged-ai-settings.spec.ts`: real MCP rail/selected status/tool count, actual model visibility plus no-match/clear, and profile rail/selected editor agreement after fresh API reload. Temporary read-only Settings recon initially timed out due incorrect/cached-readiness assumptions; corrected recon returned GET 200 with 27 MCP rows/404 catalog rows and observed Profiles controls. No record bodies, private labels/prompts or credentials are committed.

First three-case confirm: exit 1, 1 passed / 2 test-authoring failures (Configured capitalization and an ambiguous selected-role locator). Fresh observations support explicit status mapping and choosing a known API profile before editor comparison. Second command `node tools/testing/run_packaged_ai.mjs packaged-ai-settings.spec.ts --output /private/tmp/rhythm-ai-settings-confirm-2 --reporter=list,json` → exit 0, **3 passed / 0 failed/skipped/flaky**, 41.7 seconds. Tests perform no saves or account changes. Source guard additionally covers packaged plugins, seed/vendor/resources, native sources and dependency locks.

Final discovery is **155 cases in 14 files**: 37 new live checks, 41 existing cases (including explicit P0 gaps), and 77 current inventory coverage markers. This differs from the original full 155-case/13-file receipt: three historical G2 markers were replaced by three actual Settings/Profile checks. Do not relabel that old run as a new final full-suite run.

## Final static/source and safety checks

- `cd apps/web && ./node_modules/.bin/tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2022 --skipLibCheck --types node tests/packaged/*.ts` → exit 0 after final test edits.
- `node --check tools/testing/run_packaged_ai.mjs` → exit 0. `node tools/testing/run_packaged_ai.mjs --list` → exit 0, 155 cases / 14 files. Expanded product-input guard accepts unchanged d7 product sources, plugins/config seeds/vendor/resources/native inputs and dependency locks.
- `codesign --verify --deep --strict apps/electron/dist/Rhythm.app` → exit 0. Existing locally built artifact retained; no new package or signing operation in this phase.
- Current app health during final focused test: API /health 200, engine /global/health 200 with exact d7 version. These probes prove runtime readiness, not the missing feature outcomes.
- `git diff --check` and `git diff --cached --check` → exit 0. GitNexus staged detection reported 14 files / 4 symbols / low risk / 0 processes; its index is stale and wrong-path symbol labels are not reliable scope proof. Manual staged review is tests, runner and docs only. New helper/productPaths impact returned UNKNOWN/not found; no product symbol was edited.
- Inventory validation: 82 groups, 187 unique referenced commit IDs all resolve; every new-test path exists. Complete 489-SHA month ledger exactly equals git log for the pinned window/source.
- Read-only local SQLite audit observed zero smoke-labelled cookbook, session and project rows. New Settings tests perform no writes. Original checkout retains only its three pre-existing dirty/untracked paths; no installed app replacement.
- Prior aggregate PR gate has no clean one-shot receipt after its earlier scoped repairs; it was not rerun in this test-only phase. No overall verification/release PASS is emitted. Product failures and missing behavior coverage remain explicit.

## Final MCP reliability failure (retained)

After replacing inferred label formatting with explicit observed `configured: Configured` mapping, the targeted final command `node tools/testing/run_packaged_ai.mjs packaged-ai-settings.spec.ts --grep 'selected MCP inspector' --output /private/tmp/rhythm-ai-settings-confirm-mcp-final --reporter=list` returned **exit 1 / one 120-second timeout**. Trace shows reload completed in 181 ms, then the correct status-text assertion consumed about 71.5 seconds despite its 10-second expectation bound; later rail completeness checks were unfinished at test timeout. API/engine health remained 200 (22ms/6ms). This is an intermittent renderer/automation responsiveness finding, deeper root cause unproven. No navigation assertion was weakened, timeout increased or blind rerun performed. Earlier3/3 receipt remains scoped historical evidence; current MCP coverage is not reliable/green. Model/profile bodies are unchanged from that three-case run.

Final teardown audit: ports 4001/4096/4002 and 4098/4097/4099 all free. Read-only SQLite audit again reports zero smoke-labelled cookbook/session/project rows. No test app/backend remains running; no raw log/trace/screenshot is staged.
