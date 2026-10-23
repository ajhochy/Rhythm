---
date: 2026-10-20
repo: Rhythm
branch: local qualification checkout
pr: none
issues: []
status: pending
tags: [run, Rhythm, hermes, codify]
---

# Hermes direct OpenAI API one-turn Codify

## Files

- Contract: `apps/web/tests/packaged/packaged-ai-private-hermes-openai-luna.spec.ts`.
- Metadata preflight helper: `apps/web/tests/packaged/helpers/hermes-private-provider-preflight.mjs`.
- Isolated Confirm config: `apps/web/tests/packaged/packaged-ai-private-hermes-openai-luna.config.mjs`.
- Private exact-build Confirm launcher: `/private/tmp/rhythm-hermes-one-turn-launch-checked-20261021.mjs`.
- Recon receipt: `/private/tmp/rhythm-hermes-one-turn-b7d5-RsvjAb/turn-observation.json`.

## Checks

Static TypeScript and Playwright discovery are to be run under the shared Rhythm build guard. The native Confirm command must use a fresh creator-owned synthetic fixture, an explicit non-secret grant matching that fixture's manifest hash, source revision, actor, Hermes home, provider/model, and bounded deadline, plus a unique canonical `0700` run root. The exact packaged build must be revalidated before any provider turn. Playwright screenshots, traces, and video remain disabled.

The test registers as a raw Playwright failure unless model opt-in, exact app/build, fixture manifest, audience grant, and private run-root inputs are all present; ordinary packaged-suite runs therefore do not enter packaged app fixtures for this provider test. The private launcher checks the exact b7d5 candidate, uses the existing bounded model-loan runner, points at this checked config, and verifies teardown before scrubbing only the fresh owned fixture. The check requires normal UI key save/readback, a real catalog entry and normal provider/model apply, exactly one user send, exact answer `2` in rendered text/API/SQLite, no tool parts, one matching `openai-api/gpt-6-luna` usage call at the official base URL, and unchanged build/Hermes artifact identity. It refuses any run without at least three minutes remaining before key materialization and two minutes before send. A source-only pass or discovery listing is not Confirm evidence.

## Notes

No app, model, credential material, or loan was used while preparing this checked contract. Parent-owned native Confirm is pending. Record its exact command, fresh-run receipt, scrub receipt, source-hash result, and dynamic-port teardown result before changing this status.
