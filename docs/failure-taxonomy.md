# Failure Taxonomy (C-series / P-series / W-series)

Canonical definitions for classifying pipeline failures. This is the single
source of truth — `failure-postmortem` (SKILL.md), the AgentFlow
`post-merge-smoke.aflow` postmortem agent, and `mine-patterns.py` all consume
these categories. Edit here, never inline copies.

Every postmortem classifies divergences with exactly these categories. Do not
invent new C/P/W codes; do not force-fit (see the P-series note below).

## Correctness Failures (C-series) — captured when smoke fails

Assign exactly one category per failing criterion (or for the run overall if
the failure is undifferentiated):

| Category | Symptom | When to use |
|---|---|---|
| **C1: Missing contract** | Manual found a regression in a criterion that had no test | Criterion was never in `contract.json`, or contract file was missing entirely |
| **C2: Wrong contract** | Contract test passed, but manual smoke found the same criterion broken | The test existed but tested the wrong thing — false negative |
| **C3: Wrong implementation** | Contract test failed for a clear code reason | Test was correct; code didn't satisfy it; failure-triage loop should have caught this |
| **C4: Spec ambiguity** | Two reasonable readings of the criterion; implementer chose A, user expected B | Manual failure maps to a criterion that is genuinely vague |
| **C5: Environment issue** | Works locally, fails in CI or real environment | Infrastructure, config, or dependency mismatch |
| **C6: Dependency failure** | Failure is in adjacent feature or upstream code, not this PR's changes | `git diff` doesn't touch the failing area |
| **C7: Regression (flaky or prior)** | Feature was working before this PR; this PR broke it | Regression in behavior not targeted by this issue |

**C1 and C2 are the highest-value signals for self-improvement.** A C1 means
acceptance-contract missed a criterion. A C2 means acceptance-contract wrote a
test that didn't actually verify the criterion. Both feed directly to the
prompt-evolver.

## Process Health Failures (P-series) — captured even when tests pass

P-category failures are process-level problems that occur before or
independent of test execution. They are captured in `process_issues` on every
run, regardless of `smoke_result`. A P-category with `smoke_result: pass` is
still a signal — it means the pipeline got lucky, not that it worked
correctly.

| Category | Symptom | How to detect |
|---|---|---|
| **P1: CI gate skipped** | Agent pushed a commit without waiting for CI to pass | Check whether `gh run watch` was called after push; look for back-to-back commits on the same branch with no CI wait between them |
| **P2: Test infrastructure conflict** | vitest/playwright/jest globs overlap, causing one runner to pick up another's test files | Check test runner config (`vitest.config.ts`, `jest.config.js`, `playwright.config.ts`) for overlapping `include`/`testMatch` globs before first run |
| **P3: Scope expansion** | Agent satisfied acceptance criteria tests via unintended implementation (added unrequested features, refactored outside issue scope) | Diff size disproportionate to issue scope; tests passing via structural workaround; new files or exports not mentioned in the issue |
| **P4: Async timing assumption** | Test asserts on async result immediately after triggering async operation — passes locally (fast machine), fails in CI (different timing) | Tests that check counts or state right after a POST/event trigger with no explicit `await`, `waitFor`, or polling |

**P-categories fire even on PASS runs.** Record any P-issue you observe
regardless of whether tests passed. Pattern-mining uses a threshold of 1 for
P-categories — a single occurrence is actionable.

**Do NOT force-fit a process issue into P1–P4.** Each P-category is specific —
`P1` means *exactly* "an agent pushed without blocking on `gh run watch`",
nothing else. A real process issue that matches none of P1–P4 (e.g. a
release/signing/notarization/credential/config snag, or a
remote-script-reinstall requirement) MUST use a descriptive non-P
`process_category` (e.g. `"release-deploy"`). `mine-patterns.py` only counts
exact `P1`–`P4`, so a descriptive label keeps the narrative without inflating
a P-pattern. Mis-tagging such issues as `P1` manufactures a phantom "CI gate
skipped" trend that misdirects `prompt-evolver` — observed and corrected in
the 2026-06-06 retro.

## Workflow Adherence Failures (W-series) — captured on every run

W-category failures capture **how closely the run followed the workflow
itself** — independent of whether the code worked. A run can pass tests and
still be a W-failure if the agent skipped required skills, bypassed
orchestrator routing, or claimed completion without evidence. These are the
signals that drive self-improvement of the skills themselves.

Evaluate W-categories against the **transcript of the run** (orchestrator
dispatch log, subagent reports, tool-call sequence). If the postmortem is
being written retroactively from conversation history (e.g., via
`episodic-memory:search-conversations`), reconstruct the sequence from
messages and tool calls.

| Category | Symptom | How to detect |
|---|---|---|
| **W1: Required skill skipped** | A skill required by the workflow chain was not invoked (e.g., coding-agent ran without prior acceptance-contract; PR opened without verification-gate; smoke completed without failure-postmortem) | Walk the canonical chain in CLAUDE.md: orchestrator → planning-agent → issue-writer → acceptance-contract → coding-agent → verification-gate → failure-triage (if fail) → project-state-updater → failure-postmortem. Any skip of a required-for-context step is W1. |
| **W2: Bypassed orchestrator routing** | Agent jumped directly to implementation or edits without going through `workflow-orchestrator` despite the repo having `AGENTS.md` + `docs/ai/*` | Check transcript: was the first non-trivial action gated by an orchestrator dispatch? Direct Edit/Write/Bash on source code without orchestrator entry is W2. |
| **W3: TodoWrite checklist not expanded** | Skill's Completion Checklist explicitly says "expand into TodoWrite items at start" and the agent never created the todos | Check for a TodoWrite call near the start of each skill invocation. Absence when the SKILL.md requires it is W3. |
| **W4: Source-of-truth violation** | Agent edited `~/.claude/skills/`, `~/.codex/skills/`, or `~/.config/opencode/skills/` directly (those are sync targets); OR re-fetched content already inlined into the prompt (token waste); OR operated on the wrong repo (target project when skill required agent-stack, or vice versa) | Check Edit/Write paths against canonical source (`$AGENT_STACK_PATH/claude/skills/`). Check for redundant `gh issue view`, `cat`, or re-read calls when content was supplied in the dispatch prompt. |
| **W5: Premature completion claim** | Agent declared work "done", "fixed", "ready", "passing", or opened a PR without verification-gate evidence captured in transcript | Search transcript for completion language and confirm a verification-gate evidence block precedes it. Any completion claim without prior captured check output is W5. |
| **W6: Wrong-repo/branch operation** | Skill targeted the agent-stack repo but commits/PRs landed in the target project repo (or vice versa); OR branch was not confirmed before a destructive/visible operation (push, PR open, browser smoke against deployed env) | Check `git remote get-url origin` against the skill's intended target. Check that branch confirmation happened before push/PR/smoke. |
| **W7: Sync step skipped after canonical edit** | A canonical skill in `$AGENT_STACK_PATH/{claude,codex}/skills/` was edited but `ai-workflow sync-globals` was not run afterward, so install targets remain stale | Check for `ai-workflow sync-globals` invocation after any commit that touched `claude/skills/` or `codex/skills/` in agent-stack. |

**W-categories fire on every run, even PASS, even when no manual smoke
happened.** They are the primary self-improvement signal because skill drift
compounds silently. Pattern-mining threshold is 1 — a single W-occurrence
means the workflow is structurally leaking and the affected skill needs
sharpening.

## P vs. W boundary

When in doubt between P and W: P is about the **system the workflow runs on**
(CI, test runners, async timing). W is about **the workflow itself being
followed**. CI gate skipped is P1 (about the CI system); required skill
skipped is W1 (about the workflow chain).
