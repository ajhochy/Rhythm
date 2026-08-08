---
date: 2026-08-07
repo: Rhythm
branch: test/free-model-delegation-build
pr: null
issues: []
status: blocked
tags: [retro, adherence, integration-build, api_server]
smoke_result: not_run
verification_claimed: blocked_before_release_gate
divergence: false
overall_score: partial
---

# Retrospective: free-model integration verification

## Outcome

Focused checks were green, but the release gate was correctly blocked before
dispatch. The attempted fresh-install sandbox set
`RHYTHM_SANDBOX_COPY_OPENCODE_AUTH=0`; verification nevertheless found copied
six-provider credentials and a copied database whose `rhythm-setup` profile was
`openai/gpt-5.6-terra`. This is a contaminated harness, not a product failure.

## Per-criterion comparison

| Criterion | Contract status | Observed integration status | Category |
| --- | --- | --- | --- |
| c1 | pass | Not revalidated; blocked before release gate | C4 environment/harness |
| c2 | pass | Not revalidated; blocked before release gate | C4 environment/harness |
| c3 | pass | Fresh/no-auth precondition disproved; live release check not run | C4 environment/harness |
| c4 | pass | Not revalidated; blocked before release gate | C4 environment/harness |
| c5 | pass | Not revalidated; blocked before release gate | C4 environment/harness |
| c6 | pass | Not revalidated; blocked before release gate | C4 environment/harness |
| c7 | pass | Not revalidated; blocked before release gate | C4 environment/harness |
| c8 | pass | Not revalidated; blocked before release gate | C4 environment/harness |
| c9 | pass | Not revalidated; blocked before release gate | C4 environment/harness |
| c10 | pass | Fresh/no-auth precondition disproved; live release check not run | C4 environment/harness |
| c11 | pass | Not revalidated; blocked before release gate | C4 environment/harness |
| c12 | pass | Not revalidated; blocked before release gate | C4 environment/harness |

## Chain and issue

- **Expected chain:** orchestrate → validate fresh sandbox preconditions → live/release gate → dispatch.
- **Observed chain:** orchestrator attempted the sandbox → verification detected copied auth and seeded DB state → release was blocked before dispatch.
- **Skipped skills:** none; downstream dispatch was intentionally not entered.
- **Issue:** `C4 environment/harness` — the documented auth-copy knob did not establish the claimed no-auth condition, and the database source was also non-fresh. Detected by the six copied provider credentials and `rhythm-setup=openai/gpt-5.6-terra` in the sandbox copy.

## Learning

Before expensive live or release gates, verify the documented environment knob
names and assert both clean-auth and fresh-seed database preconditions. Do not
treat the focused green checks as release verification when those preconditions
fail.

## Follow-up

No product code, global skills, sandbox state, workflow, commit, or PR state was changed. A possible **broad** workflow-orchestrator skill proposal is a mandatory pre-dispatch fresh-sandbox preflight that asserts no copied auth and the expected seed profile; route it to `prompt-evolver` for review rather than editing globally.
