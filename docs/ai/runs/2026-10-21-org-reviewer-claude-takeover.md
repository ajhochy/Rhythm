---
date: 2026-10-21
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: blocked-on-budget-decision
tags: [run, rhythm, playwright, org-reviewer]
index: "[[Rhythm]]"
---

# Org Reviewer evaluation: Claude Code takeover of the Codex run

Claude Code resumed the Codex task (Harness²-style pre-review evaluation for all improvement kinds, one whole-run token cap, packaged Playwright verification, actual-config review) from its share transcript and the receipts below. Prior history: `2026-10-21-org-evaluation-implementation.md`.

## Files

- `apps/api_server/src/services/org_evaluation_provider_relay.ts`: each lease records its first failure as a bounded code-owned category. Exported `evaluationRelayFailureCategory`; new `describeLeaseFailure`. Provider/candidate bytes are never echoed.
- `apps/api_server/src/services/org_evaluation_runtime.ts`: the usage error now names the lease reason. The per-arm provider call limit went from 8 to 16 (the relay maximum).
- `apps/api_server/src/services/org_evaluation_review_runner.ts`: wires `describeLeaseFailure`.
- Tests: 4 relay failure-reason cases. Managed and routed live tests use the 100k product default cap (`RUN_TOKEN_CAP`). The routed test records the relay's own categories.

Commits: `f7579c419d`, `1ab737bb58`, `a1c906158a`. Each was locally built with the Codex driver `/private/tmp/rhythm-ai-final-native-build-sign-20261020.sh` (`npm_config_audit=false`), Developer ID signed and deep-strict verified. Nothing was pushed, merged, installed or released.

## Checks

### Unrecorded Codex results on exact `3332856559`

| Check | Result |
|---|---|
| Packaged npm tree/CLI | Passed |
| No-model `tool_install_private_sandbox.live.test.ts` | 1/1 passed. The anonymous-pipe installer repair is confirmed (it was RED on 772). |
| Actual Secretary Playwright | Failed: 20 s `POST /agent-schedules` timeout. The engine stopped answering after `ensureRhythmMcp` persisted config (`engine_unverified` ×3; native MCP registration was still pending at shutdown). Evidence: `/private/tmp/rhythm-org-eval-actual-secretary-evidence-3332856559-20261021`. |
| Managed pair | Failed: the candidate install worked, then the candidate arm hit the opaque "usage unavailable" error. Codex left fixture `IS6MrC` unscrubbed; it is now scrubbed, with source hashes unchanged. |

### This takeover

| Check | Result |
|---|---|
| Actual Secretary rerun, same signed 3332856 | **1/1 passed** (10.9 s body). Both pinned failure messages reached Reviewer context (4,145 B output, 108 B system row 169485). Root `1779dd85…`: 2 batches, 12,181/100,000 settled, 0 outstanding. 0 diagnoses, 0 proposals. Outcome: scan-safety-passed-improvement-unqualified. The first-attempt engine stall did not reproduce, so it stays an open intermittent startup defect. |
| Relay failure-reason tests | RED 4/4 before `handle()` recorded failures (`/private/tmp/rhythm-relay-failure-reason-red-claude-20261021.log`), then GREEN. |
| Managed pair on f7579 | Failed, and the new reason named the cause: `Whole-run evaluation token budget limit reached`. The live test used a 20k cap; reservations are request bytes plus the output ceiling, and the original arm alone settled 6,144. |
| Managed pair on 1ab737 (100k test cap) | **1/1 passed**. First live qualification of the tool-install original/candidate pair: signed list/run, copied approval and install, offline Docker, taint, closed budget. |
| Routed 4 cases on 1ab737 | 4/4 failed with "Private engine did not complete the selected work". Every lease settled exactly 8 calls while the engine issued 12–16. Receipts: `/private/tmp/rhythm-org-eval-routed-1ab737bb58-claude-20261021`. |
| Routed 4 cases on a1c906 (16 calls/arm) | 4/4 failed: whole-run budget. One original arm settles 52–66k **actual** tokens over 11–14 calls, so a pair needs about 120–130k, above the 100k cap. No arm hit 16. The remaining "lease already used" refusals are engine retries of the identical request after the budget refusal. Receipts: `/private/tmp/rhythm-org-eval-routed-a1c906158a-claude-20261021`. |
| Managed pair on final a1c906 | **1/1 passed**. |
| Integrated org-eval checkpoint (`/private/tmp/rhythm-org-eval-integrated-bridge-checkpoint.py`) | 220 passed, 1 explicit legacy-Docker skip, 40 files. MCP 3/3. API, MCP and web tsc passed. Log: `/private/tmp/rhythm-org-eval-integrated-checkpoint-a1c906158a-claude-20261021.log`. |
| GitNexus detect-changes | LOW, 0 indexed symbols (new modules are unindexed; the index is stale). |

Every model fixture is scrubbed, with source hashes unchanged. Approximate spend is about 450k Anthropic Personal subscription tokens, mostly the two routed runs.

## Notes

- **Decision needed:** the routed kinds (create-recipe, refine-recipe, refine-task, webhook-wiring) cannot complete even an original/candidate pair under the 100k default whole-run cap. A full Reviewer cycle also needs alternatives, composition and final validation. Options:
  - raise the default cap;
  - raise only the routed live-test cap and spend about 500k tokens to qualify all four;
  - accept "inconclusive (budget)" for routed kinds at the default.
- The ~50 leftover no-model fixtures in `/private/tmp/rhythm-ai-fixture-*` from Oct 20–21 hold only disposable `.invalid` actor tokens, with no model loans. They were left for an explicit cleanup pass because some are retained failure evidence.
- Superseded generated Dayflow wrapper/layout roots for f7579 and 1ab737 (`/private/tmp/rhythm-dayflow-{tracked-wrapper,package-layout}-20261020-{f7579c419d,1ab737bb58}`) are still on disk; the removal command was permission-denied and was not retried. Keep a1c906 (current) and 3332856 (previous).
