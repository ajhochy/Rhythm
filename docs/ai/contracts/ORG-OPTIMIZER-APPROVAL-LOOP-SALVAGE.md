# Org-optimizer approval-loop — salvage manifest (GH #971)

Preserves the base-independent artifacts (design doc + acceptance contracts) of
the unfinished org-optimizer approval-loop work. Tracking epic: **#971**.

## Why the CODE isn't in this branch

The implementation commits (issues 1–4) were written on top of the
`codex/mega-open-prs-2026-07-07` mega-merge, which carried **#937's** version of
the workflow-signal code. That same code was **reworked in #956**
(`issues-933-936-workflow-signals`). A cherry-pick of the code commits onto
either `main` (files absent) or `#956` (content conflicts in
`workflow_signal_generator.ts` + `workflow_failure_signal_extractor.ts`) does
NOT apply cleanly — it requires a manual rebase that merges the org-optimizer
additions into #956's reworked signal code. That rebase is the future run's
first task and is exactly the "start after #956 merges" sequencing in #971.

So this branch intentionally carries ONLY what is clean and base-independent:
the design doc and the four contracts. The draft code stays on the local
`codex/mega-open-prs-2026-07-07` branch for reference until the future run
re-applies it on top of #956.

## Salvageable commits (on local branch `codex/mega-open-prs-2026-07-07`)

| Commit | Unit | State |
|---|---|---|
| `42fe2e066` | Issue 1 — structured configPatch/scopePatch on diagnosis | committed |
| `bb7a41d93`, `99edce448` | Issue 2 — direct-apply appliers/validators (refine-config/scope) | committed |
| `98cd02760`, `fa05174de` | Issue 3 — behavioral measurement + measuring-row sweep | committed |
| `ac1e36df4` | Issue 4 — workflow-prompt-fix applier | contract + RED test only (no impl) |

Foundation commits below issue 1 (`4c55f4211` queue-proposals, `a0e8bef23`
ensureReady, `7517c75ae` group-by-signature) are also needed but conflict with
#956; `ff77347fe` (Gemini tool-cap) is SUPERSEDED by #952 — drop it. Several
commits are mis-tagged `fix(#929)`; they are org-optimizer work, not skill
self-regulation.

## Future-run recipe

1. Wait for #952 and #956 to merge to main.
2. Branch off the updated main; re-apply issues 1–3 (rewriting the signal-file
   touchpoints against #956's version), then implement issue 4's applier to make
   `prompt_fix_applier.test.ts` pass, then issues 5 (re-diagnosis feedback) and
   6 (live E2E gate).
3. Follow the reuse map + acceptance criteria in
   `current-plan-org-optimizer-approval-loop.md` (this dir) and the
   `issue-0{1,2,3,4}.json` contracts.
