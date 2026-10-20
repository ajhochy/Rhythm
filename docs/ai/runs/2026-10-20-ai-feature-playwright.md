---
date: 2026-10-20
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1598]
status: qualification-in-progress
tags: [run, rhythm, playwright]
index: "[[Rhythm]]"
---

# Month-wide AI behavior qualification

## Scope and provenance

AJ authorized inventory/testing of all AI features, including Dayflow, Hermes and Bot Crossing, with cheap subagents researching the last month of commits/issues, comparing existing Playwright, and filling gaps. This broadens the prior P1/P2 checkpoint. It does not authorize product repairs, account/server changes, integration grants, real messages/invites, installation, push, PR or merge. Real-model P0 opt-in carries forward via RHYTHM_FEATURE_MODEL=1.

Three gpt-6-luna research agents produced core AI, companion and workflow ledgers, then read-only GitHub primary evidence and merge-provenance follow-ups. Parent integration includes 82 behavior groups (80 active/partial user-feature claims plus two audit/retirement boundaries), 489 commits and 77 primary issue/PR evidence records (73 unique numbers). All 40 merge ambiguities were traced through unique second-parent commits. Subject/path classification is an index, not semantic or runtime proof. See [inventory](../plans/2026-10-20-ai-feature-test-inventory.md), its machine-readable sibling and the complete month commit ledger.

Remote mega remains 894c16f44d30c77dc25d41e7d9a57a644b6ffcfa (read-only git ls-remote checked this run). Product candidate is the locally built/signed 0.18.83 bundle from d7fb554735f93c0d0a76785cbadd583d0f866610, unchanged at original test head 8faf4e2156. No product files change in this run. Source identity, bundled/live engine and unchanged product diff are required by the new runner; an older installed app cannot substitute. The existing local artifact is reused rather than rebuilding identical product sources for test-only changes.

## Files

- AI feature inventory, month-wide commit ledger, primary GitHub issue/PR evidence.
- `apps/web/tests/packaged/ai-surfaces.ts` and new packaged AI catalog, tools, schedules, cookbook and companion specs.
- `packaged-ai-playwright.config.ts`: one worker/no retries, includes existing session/conversation/primary/Coordinator/approval/router tests and explicit inventory gaps.
- `packaged-zz-ai-coverage-gaps.spec.ts`: unverified claims fail explicitly; they are not product-regression red evidence.
- `tools/testing/run_packaged_ai.mjs`: exact local artifact/source guard and repeatable suite command.
- Sanitized recon records in `docs/testing/results/recon-ai-*`; no private memory/chat/task bodies or credentials.

## Checks (in progress)

Strict packaged TypeScript and runner syntax checks return zero. Initial discovery lists 155 cases in 13 spec files: 34 new live behavior checks, 41 existing AI cases, and 80 explicit coverage failures. This is a coverage accounting total, not a passing result.

Read-only Recon command used a temporary, uncommitted packaged observation spec with the exact bundle/revision. It was removed after sanitized observations were recorded. The focused Recon also created one inert nonce-owned cookbook recipe through UI (201), read it back, deleted it (204), and observed 404. No model prompt was sent during Recon.

Initial 32-case run (the two schedule cases were added afterward) returned 21 passed / 11 failed in 12.4 minutes, no skips/retries/flaky results. Four failures involved the observed codify mistakes (Skills wait, Hermes assumed page cap, and the two Colony search-role cases); actual data/packaging/error-audit failures remain visible. Raw output: `/private/tmp/rhythm-ai-new-tests.log`; JSON destination: `/private/tmp/rhythm-ai-new-tests.json`. These are private. Commands and final counts will be finalized below after completion.

## Findings so far

- Product/data/UI: Report Card receives and renders a blank identity/label row. Both normal and recovery paths fail the nonblank-row contract.
- Candidate packaging: native Dayflow view reports unavailable; original app validator reports ARTIFACT_INVALID. No recording permission or launch was attempted.
- Environment/configuration: unexpected Google/PCO sync OAuth server-configuration errors are preserved as strict audit failures. No allowlist/settings workaround.
- Performance observation: actual Skills GET took 20,916 ms in Playwright's network trace while health stayed responsive. Initial reload response wait inherited 15 seconds and was too short for observed behavior.
- Test authorship: Bot Crossing input is type=search (searchbox), while initial test selected textbox. Hermes gateway returned six sessions despite limit=1; initial test assumed a cap without recon evidence. These are separated from product findings and require corrected recon/codify, not weakening behavior checks.

## Safety and completion boundary

Only nonce-owned inert cookbook records are written by new checks; no recipe execution. Existing schedules/history, memories, shared agent definitions and companion stores are read-only. Hermes new drafts remain unsent and are cleared only if they still match the exact test nonce. No real task is archived/opened across external harnesses. Original checkout dirt remains unrelated and preserved.

Every unresolved feature claim remains a failing UNVERIFIED case with explicit fixture needs. Many need an isolated signed-in primary/journal, sanitized harness/Dayflow sources, owner identities, safe tool receivers, or physical/mobile/native permission fixtures. Catalog/UI success never qualifies those boundaries. Overall AI qualification cannot be called green while these fail.

Corrected codify errors before the canonical full run: searchbox role from actual pinned markup; history identity equality before/after overlay instead of an unsupported page cap; 60-second reload discovery bound matching the live catalog timing. Companion guest pageerrors are audited in addition to host renderer errors. No product code or log allowlist changed.
