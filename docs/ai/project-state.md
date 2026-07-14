# Project State

## Current focus

Dev sandbox isolation is implemented and fully verified on `feat/dev-sandbox-isolation`.

## Active branch / PR

- Branch: `feat/dev-sandbox-isolation`
- Commit verified: `a59a759a76d8fecd53d09f4f7d13e87a426dc020` plus uncommitted implementation and verification records.
- PR: none; no push or PR action was performed.

## In progress

- Awaiting human review of the branch diff and verification record.

## Risks / known issues

- Run local lifecycle checks with the repository-supported Node 22 login-shell runtime; the host command shell currently resolves unsupported Node 26.
- API tests require the documented `MEMORY_VAULT_SUBDIR=memory` layout because the host exports an empty value.
- Sandbox copies contain sensitive local auth/data until `sandbox.sh down` removes the temporary directory.

## Test status

- Issue-level workflow checks passed: Flutter analyze, Dart format, and API TypeScript.
- PR-level workflow checks passed with normalized memory-vault layout; API build passed.
- Focused API contracts passed 54/54; Flutter tests passed 861/861.
- Full lifecycle smoke passed: live `:4001`/`:4096` PIDs remained unchanged; sandbox `:4098` and `:4098/opencode/health` were healthy; `down` freed `:4097`/`:4098` and removed the sandbox directory.
- Postmortem: `.agent-stack/postmortems/2026-07-14-dev-sandbox-isolation.json`.

## Next step

Human reviews the diff and durable run note, then decides whether to push/open a draft PR. No additional manual behavior gap is known.
