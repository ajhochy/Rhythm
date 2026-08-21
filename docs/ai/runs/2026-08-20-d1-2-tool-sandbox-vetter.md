---
date: 2026-08-20
repo: Rhythm
branch: agent-stack/si-d1-tool-vetting-sonnet
pr: null
issues: [1427]
status: ready-for-verification
tags: [run, Rhythm]
---

## Contract

- `docs/ai/contracts/issue-1427.json`
- RED: hand-verified the Docker mechanics (sentinel write/read detection, network-error signature, orphaned-container-on-client-kill) directly against this environment's Docker daemon BEFORE writing any TypeScript (see the module doc comment in `tool_sandbox_vetter.ts` for the exact commands). Once the TS was written, the first `vitest run` of the new test file failed 2/15 real (a slow `npm install left-pad` network test exceeded vitest's 30s timeout, and its still-running container leaked into the next test's teardown assertion) — fixed by switching the network-attempt fixture to a fast `node -e http.get(...)` call (no npm retry/backoff) and adding a defensive `afterAll` container sweep. Re-run: 15/15 GREEN.

## Files changed

- `apps/api_server/src/services/tool_sandbox_vetter.ts` (new)
- `apps/api_server/src/services/__tests__/tool_sandbox_vetter.test.ts` (new)
- `docs/ai/contracts/issue-1427.json` (new)

## Checks run

- `npx vitest run src/services/__tests__/tool_sandbox_vetter.test.ts` — 15/15 passed, including 9 tests against the REAL local Docker daemon (safe/unsafe/conditional/unavailable verdicts, credential-access-attempt counting, unconditional teardown, unsupported-install-method fail-closed).
- `node_modules/.bin/tsc --noEmit` — passed (one fix needed: `ToolVettingOutcome` had to be `Required<Pick<...>>` rather than a bare `Pick<...>`, since `ToolSafetyReportInput`'s observational fields are optional on the INPUT type but this module always populates every one of them).
- `npm run build` — passed.
- `git diff --check --cached` — clean.
- Added-line secret scan — only hit is the synthetic fixture `sk-abcdefghijklmnopqrstuvwx` inside a test asserting that exact string is NOT present in the outcome (same fake-secret convention as D1.1's redaction test).
- Docker cleanup verified: `docker ps -a --filter name=rhythm-d1-vet- --format '{{.Names}}'` returns empty both mid-suite (asserted by a dedicated test) and after the full run (checked by hand).

## GitNexus

- `vetToolInSandboxAsync`/`DockerSandboxRuntime` are new symbols — not present in the stale integration index (expected; recorded as UNKNOWN, no upstream callers to break since nothing calls this module yet — D1.3/D1.4 are the first callers).
- No existing symbol was edited in this commit.

## Notes

- Scope decision: no tool-invocation protocol exists yet for "run a candidate tool against a typed prompt" (not defined by any of the D1 issues), so raw prompt text never enters the sandbox container — only its COUNT is recorded. This also sidesteps a real risk: Docker's default log driver persists container stdout/stderr to disk on the host, so printing raw prompt text inside the container would risk it landing in durable state.
- Docker sandbox lifecycle used the track's unique directory (`/private/tmp/rhythm-si-d1-sonnet/docker-vet-tests-*` scratch dirs) and randomized `rhythm-d1-vet-<hex>` container names; no candidate tool ever executes on the host — only inside the disposable, `--network none`, `--pull never`, memory/cpu-bounded container.
- `npm install left-pad` was tried first for the network-detection test and found to be slow (npm's own retry/backoff under a DNS failure), not merely a timeout tuning issue — switched to a fixture that fails fast with the same `getaddrinfo` signature real installs would produce.
