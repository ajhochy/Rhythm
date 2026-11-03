---
date: 2026-10-20
repo: Rhythm
branch: local qualification checkout
pr: none
issues: []
status: pass
tags: [run, Rhythm, hermes, recon]
---

# Hermes direct OpenAI API one-turn Recon

## Files

- Private observer receipt: `/private/tmp/rhythm-hermes-one-turn-b7d5-RsvjAb/turn-observation.json`.
- Private preflight and teardown evidence: `/private/tmp/rhythm-hermes-one-turn-b7d5-RsvjAb/preflight.json` and `/private/tmp/rhythm-hermes-one-turn-b7d5-RsvjAb/scrub.json`.
- Native command log: `/private/tmp/rhythm-private-b7d5-hermes-one-turn-clean-source-recon-20261020.log`.
- Checked Codify contract prepared at `apps/web/tests/packaged/packaged-ai-private-hermes-openai-luna.spec.ts`; its Confirm run remains pending.

## Checks

The exact reviewed Rhythm candidate `b7d5db0af960196a3ca3ed0291877f7e7d2e0771` with Hermes desktop source `2ad39a4cdb2c3c986219f8ca828fef8060e76273` completed one normal Hermes UI turn. The ordinary OpenAI API key Save flow persisted safe `openai-api` key metadata, the normal catalog exposed `gpt-6-luna`, and the provider/model controls applied that selection. The exact prompt and one-character response were observed in the UI, Hermes session API, and SQLite history. Evidence records one user row, one assistant row, zero tool parts, one main usage row and one API call at `https://api.openai.com/v1`; the assistant answer was `2`. SQLite recorded session `billing_mode` as NULL and per-model usage `billing_mode` as an empty string, consistent with the source's non-subscription billing classification.

The run completed in 29.4 seconds (about 1.1 minutes including the guarded command). The owned fixture was scrubbed with source hashes unchanged, the dynamic Hermes port was free, and the private Hermes `.env` was absent. Screenshots, traces, and video were disabled. The receipt contains hashes and metadata, not the key or message text.

## Notes

This proves one real Hermes direct OpenAI Luna turn on that exact packaged build. It does not prove Claude account failover, provider retry, or other Hermes lifecycle behavior. The new checked Playwright contract is a Codify artifact; it has not been rerun against a fresh loan in this turn. Native Confirm remains a separate required step.
