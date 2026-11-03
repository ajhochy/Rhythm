---
date: 2026-10-20
repo: Rhythm + Hermes source fixture
branch: local-defect-contract
pr: null
issues: []
status: red
tags: [run, rhythm, hermes, provider-catalog]
---

# Hermes OpenAI GPT-6 Luna acceptance contract

## Files

- Added focused contract tests at `/private/tmp/rhythm-hermes-timeout-source/tests/hermes_cli/test_openai_gpt6_luna_contract.py`.
- Added the local no-issue contract at `docs/ai/contracts/hermes-openai-luna.json`.
- Hermes source fixture HEAD: `23589566471dbd2068a0387c85a2cb85d4a7d737`; its only worktree change is the new untracked test file. No production source was edited.

## Checks

Command:

```sh
python3 /Users/ajhochhalter/Documents/Rhythm/tools/build/guard.py --repo /Users/ajhochhalter/Documents/Rhythm -- /bin/zsh -f -c 'cd /private/tmp/rhythm-hermes-timeout-source && scripts/run_tests.sh tests/hermes_cli/test_openai_gpt6_luna_contract.py'
```

Result: **expected RED, exit 1; 2 failed, 4 passed** (`6` tests total). Failures:

- `test_gpt6_luna_is_exposed_when_official_live_listing_contains_it`: catalog returned only the existing `gpt-5.6-sol` entry.
- `test_openai_api_label_matches_its_canonical_provider_label`: `get_label("openai-api")` returned `openai-api`; canonical label is `OpenAI API`.

The absent-listing rejection, non-agent junk filtering, exact Luna Responses-mode resolver, and zero-curated-intersection fallback characterization passed. The fixture mocks only the external model-listing response and uses no real credential or provider network request. Runner reported Python 3.11.15 and pytest 9.1.1. Build guard reported peak 6,870,897,406 bytes; its command returned the test runner's expected nonzero status.

Test SHA-256: `7c235ec9558390a237d7e06462f4c76cd4261dbb4a62743f914a350399f89d39`.

## Notes

Official OpenAI picker behavior currently intersects the successful live list with curated models, but falls back to the whole curated list when the intersection is empty. The new characterization preserves that existing behavior and does not extend or alter it. Successful official-list validation already rejects an absent model; the current gap is exposing Luna when present in the live list and presenting the canonical provider label.
