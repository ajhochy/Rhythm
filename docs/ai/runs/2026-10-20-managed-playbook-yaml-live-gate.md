---
date: 2026-10-20
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pass
tags: [run, rhythm, playbooks, live-e2e]
---

# Managed Playbook YAML live gate

## Files

- `apps/api_server/src/__tests__/live_e2e_managed_command_yaml.test.ts`

## Checks

- Guarded `tools/dev/sandbox.sh` runtime supplied by the API lane: API `127.0.0.1:4098`, engine `127.0.0.1:4097`, synthetic approved fixture and sandbox HOME under `/private/tmp`. No default app ports or operator data were used.
- Observation-only Recon created one nonce-named inert Playbook through normal HTTP POST: 200; managed file contained a quoted `[smoke]` description; direct real engine `GET /command` returned the exact literal description and template. Normal DELETE: 204; file and engine catalog item absent. Receipt: `/private/tmp/rhythm-playbook-yaml-live-recon-20261020.json`.
- `cd apps/api_server && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-playbook-yaml-sandbox-20261020-a RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-schedule-owner-fixture-20261020-a npx vitest run src/__tests__/live_e2e_managed_command_yaml.test.ts` → **1 passed, 0 failed**. The test creates a fresh nonce-owned command, checks real engine parsing, and deletes it with exact file/catalog absence.
- `cd apps/api_server && npx tsc --noEmit` → pass after a type-only `process.getuid?.()` correction. The live test was not rerun after that and a cleanup-flag ordering correction because the guarded sandbox was already down; the recorded real API/engine result precedes those two test-harness corrections.

## Notes

- Neither Recon nor the live test invoked the Playbook command, sent a model prompt, or copied credentials.
- This proves API write → managed file → engine catalog parsing for one inert bracketed description in the isolated sandbox. Packaged editor create/edit/delete remains separately pending native confirmation on the post-fix signed build.
