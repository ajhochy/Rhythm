---
date: 2026-10-19
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1598]
status: router-unqualified
tags: [run, rhythm, playwright, model-router]
---

## Files

- `apps/web/tests/packaged/packaged-model-router.spec.ts`: eight focused tests. Four UI/API/engine cases cover saved Grid/Luna settings, cheap trivial Auto work plus follow-up reuse after reload, routine arithmetic cheap-route qualification, and explicit model pin bypass. Four live classifier cases cover formatting, extraction, a literal edit and difficult architecture, using the client and questions embedded in the exact mega bundle.
- `docs/testing/results/recon-model-router.md`: sanitized live recon, six-prompt classifier sample, API/DB/UI shape and account/model step-up evidence.
- Inventory promotes `router-first-prompt` to P0 at the user's explicit request: eight P0 families, 52 P1 and seven P2. Original 33-case results remain separately reported.

## Checks

- Product code: mega `894c16f44d30c77dc25d41e7d9a57a644b6ffcfa`; tests based on local commit `b3c1b6db0875462e663a0da79935d84747a93647`. The signed local app is `apps/electron/dist/Rhythm.app`, version 0.18.83, built locally in the previous stage; exact embedded API/engine source identity is asserted before these tests launch it. No product code changed since the build; no GitHub build or installed-app replacement.
- Strict packaged-spec TypeScript check: `cd apps/web && ./node_modules/.bin/tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2022 --skipLibCheck --types node tests/packaged/*.ts` → exit 0. Initial importing of renderer DTOs pulled in renderer-only workspace aliases; replaced with observed response projections in the test, then reran successfully.
- Recon: two bounded probes finished in 40.6s and 46.2s; no unexpected per-test app errors. Normal shutdown stream errors occur after the audit window. Temporary recon specs removed.
- First seven-case run → exit 1, six passed / one semantic failure, 1.5m. Report `/private/tmp/rhythm-model-router-run.json`, log matching `.log`. The routine-arithmetic qualification case was then added and the final eight-case suite rerun without further test-source edits during that invocation.
- Final eight-case run → **exit 1, six passed / two failed, zero skipped or flaky**, 2.2m. Report `/private/tmp/rhythm-model-router-final.json`, log matching `.log`. Settings, cheap trivial Auto route/actual served provenance/follow-up reuse, explicit fixed Luna bypass, formatting/extraction classifier expectations and hard-architecture classifier expectation passed. The routine-arithmetic eligibility qualification and literal-edit calibration expectation failed with the exact diagnostics below. No unexpected per-test app log error or cleanup failure was reported.
- `npm run build:guard -- ai-workflow checks --level issue` → exit 0: Flutter analyze, Dart format, API TypeScript and MCP TypeScript checks succeeded. `git diff --check` → exit 0. No product source changed.
- Final independent read-only DB check: zero `[smoke] model-router%` sessions and zero projects, including both recon runs. Each fixture also verifies its own exact-nonce API deletion and DB removal.
- GitNexus upstream impact attempts for the new test helpers returned target-not-found / risk UNKNOWN; index is rooted in the original checkout and 250 commits stale. `gitnexus detect-changes --repo Rhythm --scope staged --limit 5` returned “No changes detected” with that same warning, which is not evidence about this worktree. Direct staged review confirms exactly five test/docs paths, no product code, generated binaries or private logs. Full PR gate and broader router qualification are not claimed.

Command (cwd `apps/web`):

```sh
RHYTHM_PACKAGED_APP=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app \
RHYTHM_FEATURE_MODEL=1 \
PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/rhythm-model-router-final.json \
./node_modules/.bin/playwright test -c tests/packaged/packaged-playwright.config.ts \
  packaged-model-router.spec.ts --reporter=line,json
```

## Notes

### What the original checks missed

The initial probe proved classification/selection/application wiring, not decision quality. The user had to point out that most requests appeared to choose Sol. This was a coverage failure: receiving an answer and matching the selected model cannot qualify sensible routing. The revised tests assert cheap tiers for trivial/routine tasks, retain traces in failure messages, compare actual engine output/served provenance, and separately test the production score mapping.

### Two distinct reasons Sol appears frequently

1. **Calibration concern (P1).** A one-literal JavaScript edit gets raw Luna score `0.85`; production thresholds `[0.1,0.35,2.25]` map it to tier 2. The question itself describes single-file edits as tier 3. This is reproducible in the standalone six-request sample and the first semantic test run. The classifier is responding successfully; it is not a rules fallback. The low tier-2 boundary needs evaluation against a held-out representative set before choosing replacement values. Do not blindly raise thresholds to make one example green.
2. **Current candidate/account availability (qualification failure).** A correctly classified tier-3 arithmetic prompt still stepped to tier 2 because the Haiku account was marked exhausted/no eligible account and configured `openai/gpt-6-sol` was unavailable in the routable catalog. Tier-2 Sol 6.1 then had an eligible account. Final test reproduced exactly `classifier tier=3, served tier=2, model=openai/gpt-6.1-sol`, with trace `Haiku: no_eligible_account; GPT-6-Sol: model_unavailable; step_up:2; Sol-6.1: route`. This follows existing fallback policy; it is not proof of a classifier or constant-model bug. The cheap-route qualification test is intentionally red when this environment cannot honor the desired cheap route and includes the exact body-free selection trace. No account default, exhaustion state, curation or global grid setting was changed.

The live classifier sample also produced tier 4 for extraction/formatting and tier 1 for hard architecture. The router is not a constant Sol selector. Follow-ups deliberately reuse the first decision; a harder follow-up does not independently classify under `first_prompt` scope. A pinned Luna model bypasses Grid, including when a historical router timestamp remains.

### Safety and limits

- User authorized real-model tests. Synthetic prompts only; no messages to people, integration changes or private prompt corpus. API key is read in memory by the built client, never logged or committed. Classifier-only tests are labeled separately from full UI/API/engine cases.
- Nonce-owned sessions/projects are removed in `finally`, checked by API/read-only DB, and owned temporary directories removed. Existing router/account settings and original dirty files remain unchanged. Normal diagnostic attempts/decision logs survive hard-delete; they are not user-domain leaks and are not erased by direct SQL.
- Settings reads alone are not behavior proof. Model availability/quotas vary over time; current eligibility evidence is a snapshot. Renderer reload is not an API process restart. Failure-application, controlled exhaustion recovery across process restart, explicit account pins/children and a broad quality benchmark remain unqualified; existing source-unit matrices do not replace live coverage.
- No product repairs, push, PR, merge or overall verification PASS. The red semantic/qualification tests are evidence to carry into separately authorized repair work.

### Reauthentication rerun — 2026-10-19

The user reauthorized Personal and requested the same Playwright suite again. Read-only preflight showed both Claude accounts `status:ok`, with unexpired credentials; Personal remained the default. The test fixture launched the same local mega bundle and checked its source identity. No test assertions or product/settings files were edited for this rerun.

- Same command above, with `PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/rhythm-model-router-reauth.json` → **exit 1, seven passed / one failed, zero skipped or flaky**. Matching log `/private/tmp/rhythm-model-router-reauth.log`.
- **Previously failing arithmetic qualification now passes.** Decision ledger ID 1382: successful Decisions classification tier 3, applied tier 3, `anthropic/claude-haiku-5-5`, account `personal`, account source `router`. Trace skips Team as exhausted, picks Personal, routes Haiku. Real UI answer and engine model checks succeeded; no Sol step-up.
- Trivial formatting also passes: ledger ID 1379, tier 4 → tier 4, Haiku through Personal. Follow-up reuse after reload, explicit fixed Luna, settings and the other classifier expectations pass.
- **Literal-edit calibration remains red:** successful Luna result score `0.85`, thresholds `[0.1,0.35,2.25]`, mapped tier 2 versus the test's allowed tier 3/4. Reauthorization resolved the observed account-availability problem, not this separate calibration concern.
- Independent read-only DB check found zero `[smoke] model-router%` sessions and projects. Normal body-free router receipts remain. Test logs report no cleanup or unexpected per-test app errors.

### Calibration fix follow-up

The user then authorized fixing the default calibration and rebuilding locally. Source `d7fb554735f93c0d0a76785cbadd583d0f866610` changes the edit/feature boundary to 1.5; the expanded final router suite passes 17/17 against that newly rebuilt signed app. The original raw literal-edit classifier expectation remains in the suite. See `2026-10-19-router-calibration-fix.md` for the source/build pin, intermediate failures, fixture clarification, sandbox proof and remaining broader qualification limits.
