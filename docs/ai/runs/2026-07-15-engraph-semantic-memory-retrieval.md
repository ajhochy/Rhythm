---
date: 2026-07-15
repo: Rhythm
branch: feat/1093-hybrid-engraph-memory-retrieval
pr: 1095
issues: [1093]
status: verified-draft-pr-open
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Engraph semantic memory retrieval

## Files

- `apps/api_server/src/services/engraph_client.ts` — loopback-only HTTP client, one-second timeout, response parsing, and memory-root path confinement.
- `apps/api_server/src/services/memory_retrieval.ts` — opt-in hybrid retrieval, deterministic RRF fusion, unchanged FTS fallback, and punctuation-safe tokenization.
- `apps/api_server/src/repositories/agent_memory_repository.ts` — exact source/source-id batch join with owner filtering.
- `apps/api_server/src/config/env.ts` — default-off hybrid mode and Engraph vault-root configuration.
- `apps/api_server/src/__tests__/memory_retrieval_semantic.test.ts`, `memory_injection.test.ts`, and `live_e2e_memory_retrieval.test.ts` — focused, fresh-write, security-boundary, and live behavior coverage.

## Checks

- PASS — prerequisite benchmark: persistent memory-only Engraph HTTP service p95 **56.279ms**; one-shot CLI remained unsuitable for prompt-path latency.
- PASS — live sandbox E2E: 1 test. With Engraph healthy, a pre-indexed semantic hit appeared in session memory provenance. The test then terminated that isolated Engraph process, wrote a fresh memory with a hyphenated marker, and observed its note path through FTS fallback.
- PASS — focused retrieval/injection suites: 36 tests.
- PASS — full API suite: 2,737 passed, 29 skipped.
- PASS — TypeScript, API build, issue-level workflow checks, PR-level workflow checks, change-scope/diff check, and `git diff --check`.
- PASS — cleanup left sandbox API `:4098`, sandbox engine `:4097`, and isolated Engraph `:7788` clear.

## Live lifecycle

The verification used the repository sandbox under Node 22, with a temporary SQLite copy and temporary memory directory. The API was launched in `hybrid` mode against an independently started Engraph 1.7.2 HTTP service bound to `127.0.0.1:7788` and scoped only to that temporary memory directory. A fixture memory was created and indexed before the test; its path and opaque marker were passed as environment values without recording private memory content.

```bash
# From the repository root in the Node 22 login-shell runtime:
RHYTHM_SANDBOX_DIR="$TMPDIR/rhythm-1093-e2e" \
AGENT_MEMORY_RETRIEVAL_MODE=hybrid \
ENGRAPH_MEMORY_URL=http://127.0.0.1:7788 \
ENGRAPH_MEMORY_VAULT_ROOT="$TMPDIR/rhythm-1093-e2e/vault" \
tools/dev/sandbox.sh up

# After starting the isolated, pre-indexed memory-only Engraph HTTP service:
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
ENGRAPH_MEMORY_URL=http://127.0.0.1:7788 \
RHYTHM_LIVE_ENGRAPH_PID=<isolated-engraph-pid> \
RHYTHM_LIVE_ENGRAPH_SEMANTIC_PATH=<fixture-note-path> \
RHYTHM_LIVE_ENGRAPH_SEMANTIC_MARKER=<opaque-fixture-marker> \
npx vitest run src/__tests__/live_e2e_memory_retrieval.test.ts

cd ../..
RHYTHM_SANDBOX_DIR="$TMPDIR/rhythm-1093-e2e" tools/dev/sandbox.sh down
lsof -nP -iTCP:4097 -iTCP:4098 -iTCP:7788 -sTCP:LISTEN
```

The live test owns Engraph shutdown via `RHYTHM_LIVE_ENGRAPH_PID`; the final `lsof` produced no listeners on the three isolated ports.

## Notes

- Decision: hybrid only. No pure semantic mode was added.
- Decision: FTS remains default and unconditional, preserving synchronous visibility for fresh writes and exact fallback ordering when Engraph fails.
- Decision: Rhythm never starts or indexes Engraph. Hybrid mode uses an optional, persistent, operator-managed, loopback, memory-only HTTP service because per-prompt CLI startup misses the latency budget.
- Decision: semantic hits are path-confined, exact-joined to `obsidian-memory` source ids, owner-filtered in the repository, and injected only from repository content. Missing, cross-owner, ambiguous, or out-of-root hits are dropped.
- Commit: `b099f78fa` (`feat: add opt-in hybrid memory retrieval`).
- Draft PR: [#1095](https://github.com/ajhochy/Rhythm/pull/1095) is open and verified; manual smoke review remains.
