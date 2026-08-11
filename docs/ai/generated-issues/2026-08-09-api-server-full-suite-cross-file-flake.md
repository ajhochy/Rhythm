---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
priority: P2
status: proposed
tags: [issue, api_server, testing, flake]
---

# api_server full suite has a pre-existing, load-dependent cross-file flake

## Failure

`npx vitest run` (full api_server suite) intermittently fails one test in one file. The victim file is
**different every time** and is unrelated to whatever change is being verified. Each victim passes when
its file is run alone, repeatedly.

## Repro Command

```bash
cd apps/api_server
NODE_BIN=$(dirname "$(which node)")
env -i PATH="$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" SHELL=/bin/zsh TERM=dumb \
  node node_modules/vitest/vitest.mjs run
```

Run it 4+ times. Roughly 25–50% of runs fail.

## Expected

All runs green, or a deterministic failure.

## Actual

Observed across 8 full runs on 2026-08-09 (4 on `feat/artifact-viewer` with the AV-05 change, 4 on the
same branch with the change stashed):

| Branch state | Runs | Failures | Victim |
|---|---|---|---|
| AV-05 changes applied | 4 | 1 | `agent_designs.test.ts` — "accepts built-in finished tif output": `POST /agent-designs` returned `404`, expected `201` |
| AV-05 changes stashed (baseline) | 4 | 2 | `agent_configs_routes.test.ts` — "creates a config with imageGenerationEnabled granted (#1094)"; `issue_1048_engine_session_delete.test.ts` — "hard delete completes even if the engine delete throws" |

**The baseline flakes more than the changed branch, in different files.** This is pre-existing and not
caused by AV-05.

`agent_designs.test.ts` run alone, 5 consecutive times: 31 passed, every time.

## Relevant Output

```
FAIL  src/__tests__/agent_designs.test.ts > D1 — /agent-designs CRUD (authenticated) > accepts built-in finished tif output
AssertionError: expected 404 to be 201
```

## Likely Cause

Not confirmed. The signature — a `404` from a route that is definitely mounted, only under full parallel
load, random victim, green in isolation — points at the real-server harness rather than any product
logic. `src/__tests__/helpers/real_server.ts` already documents one instance of this class of bug
(undici pooling a keep-alive socket against a closed server's ephemeral port, which a later `listen(0)`
recycles) and hardens against it with `maxRequestsPerSocket = 1` + `closeAllConnections()`.

Ephemeral ports are an OS-global resource shared across vitest's parallel worker **processes**, so the
hardening only holds if every real-server test uses the helper. **11 test files still call `.listen(0)`
directly** without it, against 90 that use `startTestServer`. That is the first thing to check.

All three observed victims *do* use `startTestServer`, so if the port-recycling theory is right the
mis-delivered request originates in an unhardened file and the hardened file is the collateral. That
part is unverified.

## Likely Files

- `apps/api_server/src/__tests__/helpers/real_server.ts`
- The 11 test files that still bind `.listen(0)` directly: `rg -l "\.listen\(0\)" src/__tests__ tools`
- `apps/api_server/vitest.config.ts` (no explicit `pool`/`isolate`/`fileParallelism` settings today)

## Required Fix

1. Migrate the remaining raw `.listen(0)` call sites onto `startTestServer`.
2. Re-run the full suite 10× and confirm zero failures.
3. If it persists, capture the failing request's actual response body/headers to confirm or kill the
   cross-process port-recycling theory before changing anything else.

## Required Tests / Evaluation

No new product test. Acceptance is 10 consecutive clean full-suite runs in the sanitized clean shell.

## Note for verification gates

Until this is fixed, a single unrelated failure in a full-suite run is not by itself evidence of a
regression. Confirm by re-running the victim file alone and, if it passes, by running the full suite on
the stashed baseline.
