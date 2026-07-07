---
date: 2026-07-07
repo: rhythm
branch: codex/mega-open-prs-2026-07-07
pr: 942
issues: [922, 928, 929, 930, 931, 933, 934, 935, 936]
status: passed
tags: [run, rhythm, smoke]
---

# Mega Open PR Live Backend Smoke

## Scope

Live backend smoke for `codex/mega-open-prs-2026-07-07` after reading the branch commit log and PR descriptions.

Included PRs/commits:

- PR #932: `fix(#928,#931): scope null-clear + deny-all UI surfacing`
- PR #937: `Org Optimizer: workflow failure signals (#933-#936)`
- PR #938: `fix(#922): surface degraded MCP auth status in Agent Profiles`
- PR #939: `Fix delegated agent retry handling`
- PR #940: `feat(#930): rate-limit classifier + cross-provider fallback chain`
- PR #941: `feat(#929): self-regulating harvested skill loop`
- PR #942: final mega-branch rebuild and aggregation commit

## Test

Created `tools/release/smoke_mega_open_prs_backend.mjs`, a live test for a running local backend:

```bash
tools/release/smoke_mega_open_prs_backend.mjs
```

The test creates one disposable local agent session through the Rhythm API, uses its real SDK session id to hit the running opencode fork on `:4096`, verifies the backend spillover persistence path through `:4001`, and hard-deletes the local session in cleanup.

## Results

| Area | Check | Result | Evidence |
| --- | --- | --- | --- |
| Backend | Rhythm API health | Pass | `/health` returned `status=ok`, `service=rhythm-api-server`. |
| Backend | opencode SDK health | Pass | `/opencode/health` returned `status=ready`. |
| Backend | Fallback preconditions | Pass | `/opencode/auth` reported `anthropic` and `openai` authed. |
| Runtime | Running fork binary | Pass | Process on `:4096` resolves to the debug app bundle's `Contents/Resources/opencode_bin/opencode`. |
| Fork / #928 | `skillAllowlist` null clear | Pass | Live PATCH sequence: non-null -> `null` -> `[]` -> `null`; `null` clears while `[]` remains deny-all. |
| Fork / #928 | `mcpAllowlist` null clear | Pass | Live PATCH sequence: non-null -> `null`; `null` clears the stale allowlist. |
| API / #930 | Cross-provider spillover handoff | Pass | `POST /opencode/spillover` with `{exhausted:true}` returned `openai/gpt-5.3-codex`. |
| API / #930 | Handoff persisted | Pass | `GET /agent-sessions/:id` showed `providerId=openai`, `modelId=gpt-5.3-codex`. |
| API / #933-#936 | Org optimizer live workflow read | Pass | Initial smoke only route-checked with `maxProposalsPerRun=0`. A later live run with cap 5 returned a valid run summary and created two scope-hygiene `tighten-scope` findings. The new prompt-fix lane added afterward is covered by unit tests and the smoke now reports both `active` and `proposed` optimizer rows. |
| API / #929 | Skills metadata endpoint | Pass | `GET /opencode/skills?withMetadata=true` returned 126 skills with `metadata.status` and `metadata.env` shape present. |

## Notes

- First script attempt failed because `POST /agent-sessions` returns the pre-backfill row with `sdkSessionId:null`; the controller persists `sdkSessionId` immediately afterward. The smoke now fetches the session after create before using the SDK id.
- The smoke does not intentionally trigger provider stream failures for #939 retry caps; doing that safely would require controlled provider error injection rather than burning live model turns.
- The smoke does not force harvested skills through three real uses for #929 evaluator transitions; it verifies the live metadata surface added for the status vocabulary.
- The modified `workflow-prompt-fix` code path requires a rebuilt/relaunched API server before it can be live-smoked through `:4001`; the already-running desktop app server predates that code change.
