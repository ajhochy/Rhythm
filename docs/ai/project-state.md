# Project state

## Current focus

One integration branch only. All open work is consolidated into mega PR #1594; `main` plus that mega branch are the only branches (local and GitHub) and the only worktree is the main checkout.

## Active branch / PR

`mega/2026-09-29-electron-orgreviewer` → draft PR #1594 against `main`. It carries the local decision engine, router curation, the System One (Kev / Jev) routing backend (#1596, closed into it), the Electron fixes and the Rhythm MCP bundle and sign-in install (#1597), mobile streaming, and Org Reviewer paging. Deleted branch tips can still be reached from the local tag `archive/branch-consolidation-2026-09-29` (run log: `docs/ai/runs/2026-09-29-branch-consolidation.md`).

## In progress

- CI on #1594 for the consolidated head.
- Manual smoke per the #1594 checklist, including the System One backend (Kev running: `uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009`; recommended rollout `first_prompt` scope, Shadow for a week, then On — `docs/ai/decision-engine-setup.md`) and the packaged Electron rhythm MCP after sign-in.

## Risks / known issues

- **Kev cold latency**: 2.8–4.2 s for the first calls after other heavy work; under the 1000 ms default those prompts time out and keep the baseline route (logged as `timeout`).
- Electron `issue-1402` packaging test needs `RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR`; only the release workflow supplies it, so the MCP bundling is not covered by PR CI.
- Local env: `native_runtime_guard` fails under Node 24.21 + better-sqlite3 12.8; `apps/mobile/node_modules` is missing `expo-image-picker` (breaks local mobile lint + web e2e; CI installs fresh).
- Carried: `issue-1387` mobile tests base-red (offline-mirror hydration); #1586 silent session stalls still open.

## Test status

Consolidated head 7b0cba74: api_server + web tsc clean; api_server decision/router/MCP vitest 239 passed; mobile router settings jest 32/32; `ai-workflow checks --level pr` green except the three local-env failures above.

## Next step

AJ smoke-tests PR #1594 and merges it to `main` manually.
