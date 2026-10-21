---
date: 2026-10-21
repo: Rhythm
branch: test/feature-playwright-2026-10-19
status: research-only
tags: [plan, rhythm]
---

# Harness² research for pre-review improvement testing

User direction: research Harness² before building anything. Candidate evaluation should cover all improvement types, including tools and permissions. User raised a token-spend limit; a numerical limit has not been chosen. This checkpoint contains research and proposed acceptance behavior, not an implementation or runtime qualification. No Harness² installation, demo, model execution, app test or rebuild was performed.

## Primary sources and pin

Reviewed Google Research's release at `1cfe254e8d25b15f37048c3730134686abe60335` (GitHub API main SHA, commit dated2026-10-14), alongside [paper v1, October9](https://arxiv.org/html/2610.14224v1). Source retrieval used read-only GitHub API calls and small temporary files, not a checkout or dependency installation. The Exa search backend was unavailable without its API key; built-in web search and the official GitHub API supplied the primary sources.

- [README](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/README.md): Apache2.0 release, OpenCode and Codex executors; eight editable component families include prompts, guardrails, memory, tool guidance, subagents, skills, scripts and plugins.
- [Recursion implementation](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/recursion.py): proposes general and domain-specific variants, executes them, composes supported edits from execution evidence, then executes the compositions. A composer may retain the original tree. Invalid proposals have bounded retries/fallbacks.
- [Selection implementation](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/selection.py#L93-L108): the released final selection pool explicitly excludes reference runs and contains the composed finals. At k=1 it delivers the single final without a selector session. Do not infer a required final-versus-original superiority test from anonymous selection or from the paper's more general selector prompt.
- [Ledger](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/ledger.py) and [experiment guide](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/docs/EXPERIMENTS.md): k controls work counts, not a shared token ceiling. Per mode/task the core ledger expects4k solver executions and3k improvement stages; selector/reflection are outside that count, and retries can add calls. k=1 already means four solver executions plus three improvement stages before reflection/evaluation.
- [Setup](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/docs/SETUP.md) and experiment guide: benchmark setup targets Linux/Python and has substantial optional dependencies. The shipped Codex executor disables its sandbox, and executor network access is unrestricted. It must not be pointed at Rhythm's live configuration or credentials as-is.

The paper's central limitation matters here: behavioral contrasts and model judgments can guide edits without proving correctness or transfer to another task. Its library retains evidence-supported experience for later tasks; adoption alone does not establish a reusable improvement. These are useful design ideas, not current Rhythm proof.

## Proposed Rhythm acceptance behavior

Adapt the candidate/probe/composition method to Rhythm's existing runner, signed authority, outcome evidence, local isolation and human queue. Decide whether to reuse the Python core through an adapter or implement its narrow orchestration pattern only after checking runtime fit; this research does not settle that choice.

1. Capture an immutable original version and failure evidence. Freeze observable task checks and separate final-validation cases before candidate authors see results.
2. Generate two or three distinct candidate repairs. Store them as internal evaluation work; do not add untested recommendations to the human approval queue.
3. Run the original and each candidate through the same tasks/model/environment using separate disposable configurations and attributable child sessions. Preserve outputs, actual tool effects, failures, latency and token use. A model's opinion of the written instructions is supporting evidence only.
4. Compose a final candidate from changes that earned support. Record which portions were retained or dropped and the test evidence for each decision.
5. Execute that exact final version against the original again, including reserved unseen validation cases. Require improvement and no failed guardrail. Keeping the original is a supported outcome; missing, exhausted or conflicting evidence is inconclusive.
6. Only a qualified final version enters human review, with visible diff, baseline/candidate/final results, risks, rollback and spend. Approval applies exactly the tested version and rechecks target freshness. Tests do not grant permission to change live configuration.

All requested types remain in scope. Each needs a real effect adapter: skill bytes/catalog; agent instructions; tool bindings and schemas; permission allow/deny cases; delegation graph; task/schedule behavior. Editing a `guardrails.md` file is not equivalent to exercising Rhythm's actual permission enforcement. A type without isolated testable effects stays explicitly unsupported/inconclusive rather than being shown as verified.

Proposed token control: one durable budget for the entire evaluation, shared by generation, baseline, all child probes, synthesis, final validation, judges, retries and reflection. Reserve capacity for final validation before exploration; admission checks must include concurrent reservations and provider output limits. Show input/output/cache/reasoning usage where available. If usage cannot be accounted for, or the remainder cannot fund validation, stop with an incomplete result and retain the original. A concrete numeric cap and provider accounting policy remain open; no new paid evaluation was launched.

## Existing Rhythm pieces and gaps

The accepted September7 Reviewer is proposal-only and deliberately cannot shell, delegate arbitrarily, install or apply. Keep that authority boundary; a trusted evaluation service can create narrowly scoped experimental children rather than giving the Reviewer general execution rights.

Current skill measurement applies managed bytes and then scores/reverts; it does not supply pre-review isolation. Existing controlled experiments offer useful receipts, evidence hashes and two-arm runtime treatment for a narrow system-prompt adapter, behind an opt-in flag. The introductory experiment-service comment saying no per-run treatment exists is stale relative to its later treatment-v2 implementation and live treatment tests. Neither path supplies this complete multi-candidate workflow.

Next deliverable: a reviewed implementation plan and failing behavioral contracts for the flow above, followed by focused tests of changed paths and the relevant packaged end-to-end journey. Full backend suites remain final-integration checks, not per-build work. Implementation is held at this research checkpoint.
