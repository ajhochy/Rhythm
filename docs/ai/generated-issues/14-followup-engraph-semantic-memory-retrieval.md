<!-- Filed as GitHub issue: https://github.com/ajhochy/Rhythm/issues/1093 -->
# FOLLOW-UP: swap/augment FTS token-union scoring with engraph semantic search

## Origin

`memory_retrieval.ts` (built by #12) selects injected memories by tokenizing
the prompt, probing each significant token separately against FTS5/tsvector,
and **unioning** the hits (union, not intersection — deliberate, since FTS
ANDs all terms in one query and a full prompt rarely matches a short fact).
This works but has a real relevance ceiling: a memory needs to share only ONE
common-ish word with the prompt to qualify, with no minimum-overlap
requirement and no semantic scoring. Observed in practice (2026-07-14): asking
about "memory management," "context," and "session" pulled in unrelated
memories (a PCO song title, an AI-trend note, an org-audit note) purely
because those words appear literally in unrelated stored facts. The stopword
list is deliberately kept tiny, so this isn't a tunable-away edge case — it's
the scoring model's ceiling.

AJ has `engraph` (a local Rust binary, semantic search over Obsidian vaults,
`all-MiniLM-L6-v2` local embeddings, RRF fusion across lexical+semantic
lanes) already installed and connected as an MCP server
(`~/.config/opencode/opencode.json` → `engraph serve --read-only`), already
indexing the exact vault Rhythm's memory system reads
(`~/Documents/Obsidian Vault/AGENT-MEMORY/`, confirmed live-matching
`MEMORY_VAULT_PATH` — see
`docs/ai/decisions/2026-07-14-memory-vault-path-dev-repo-vs-app-bundle-env.md`).
A live test query ("trinitarian hymn") ranked the correct stored preference
at rank 2/100% confidence among 175k indexed chunks — noticeably better than
token-union FTS would do for the same query.

## Goal

Replace or augment `getRelevantMemories()`'s scoring with `engraph`'s semantic
search, injected through the retrieval function's existing test seam
(`BuildMemoryPrefaceOptions.getRelevant`), so relevant-but-non-lexically-
matching memories surface and topical-word-collision noise stops winning
slots.

## Integration approach (chosen: CLI shellout, not MCP client)

`engraph` is already a local binary with a scriptable JSON CLI
(`engraph search "<query>" --json --top-n N`) — no need to write api_server
into an MCP client (new SDK dependency, connection lifecycle, stdio framing)
when a `child_process.execFile` call gets structured JSON directly. This
matches the footprint-ladder instinct: extend via existing tool > new
dependency.

```
engraph search "<query>" --json --top-n 5
→ [{ confidence, docid, file, heading, rank, score, snippet }, ...]
```

## Likely files

- NEW `apps/api_server/src/services/engraph_client.ts` — thin wrapper:
  `execFile` the binary, parse JSON, map `file` (vault-relative path) back to
  an `AgentMemory` row via `sourceId` lookup in `AgentMemoryRepository`.
  Must never throw past its boundary (timeout + try/catch → `[]`).
- `apps/api_server/src/services/memory_retrieval.ts` — new
  `getRelevantMemoriesSemantic()` alongside (not replacing) the existing
  `getRelevantMemories()`; `buildMemoryPreface()`'s `opts.getRelevant`
  already supports swapping the implementation without touching call sites.
- `apps/api_server/src/config/env.ts` — new toggle, e.g.
  `AGENT_MEMORY_RETRIEVAL_MODE` (`fts` default | `semantic` | `hybrid`), and
  `ENGRAPH_BIN_PATH` (default `~/.local/bin/engraph`, overridable — do NOT
  hardcode the path, it's user-machine-specific and this is a personal-tool
  integration, not something to assume on every install).
- Tests: `apps/api_server/src/__tests__/memory_retrieval_semantic.test.ts`
  (new) — inject a fake `execFile` result, assert mapping back to
  `AgentMemory` + owner-scoping still enforced.

## Acceptance criteria

- [ ] **Availability gate:** if `ENGRAPH_BIN_PATH` doesn't exist / binary
  missing / `engraph status` fails, semantic mode silently falls back to
  existing FTS retrieval — never a hard dependency, never a startup error.
  (This is a personal local tool, not a guaranteed-present service — the
  memory-provider `is_available()` pattern other agent memory systems use is
  the right shape here.)
- [ ] **Owner-scoping preserved:** `engraph` has no concept of `ownerUserId`.
  After mapping results back to `AgentMemory` rows via `sourceId`/file path,
  the SAME defense-in-depth owner filter `getRelevantMemories` already does
  must run before any result reaches the preface. A semantic hit that maps to
  a row owned by a different user must be dropped, exactly like the existing
  cross-user-leak guard.
- [ ] **Never blocks/breaks the prompt:** `engraph search` is a subprocess
  call with real latency (embedding lookup) — must have a hard timeout
  (recommend ~500ms–1s) and fail closed to empty results, matching
  `buildMemoryPreface`'s existing try/catch-to-empty-preface contract.
- [ ] **Toggle:** `AGENT_MEMORY_RETRIEVAL_MODE` default stays `fts` (current
  behavior unchanged for everyone until explicitly opted in) — this is a
  personal-machine-dependent capability, not something to flip on by default
  for other Rhythm users/installs.
- [ ] **Mapping fidelity:** `engraph`'s `file` (vault-relative path) must
  reliably map to `AgentMemoryRepository` rows via `sourceId` — verify no
  drift between what `MemoryIndexService` derives as `sourceId` and what
  `engraph` reports as `file` (both should be vault-relative, but confirm
  path-separator/casing/leading-slash parity before trusting the join).
- [ ] **Tests:** availability-gate fallback; owner-scoping drop; timeout →
  empty (not thrown); mapping join correctness; toggle off → FTS path
  untouched (no regression to #12's existing test suite).
- [ ] tsc 0; vitest green; no regression.

## Open questions to resolve before implementing

1. Hybrid mode (`fts` ∪ `semantic`, deduped) may beat either alone — worth a
   quick manual A/B (same `--explain` flag shows per-lane RRF breakdown,
   useful for calibrating a combined score) before committing to a pure
   swap.
2. `engraph`'s index staleness: it rebuilds on its own schedule/trigger, not
   tied to Rhythm's `MemoryIndexService` refresh cron — a memory written via
   `rhythm_remember_memory` may not be semantically searchable until
   `engraph` re-indexes. Document (or bound) this lag in the toggle's
   description so it's not a surprise.
3. This is explicitly a **personal-workstation-only** enhancement (the
   binary path, the vault, the whole tool is AJ's local setup) — confirm
   scope stays contained to a locally-gated optional path and doesn't leak
   into anything that assumes `engraph` exists on other installs/CI.

## Out of scope

- Migrating engraph's embedding index itself, or running engraph's `index`
  command from Rhythm (assume it's already kept fresh by AJ / a separate
  cron, per open question 2).
- Building a new MCP-client abstraction in api_server (CLI shellout covers
  this use case; revisit only if a second MCP-tool-as-backend-dependency use
  case appears).
- Widening the stopword list / requiring N-token overlap on the existing FTS
  path — a smaller, independent fix already identified in the same
  diagnosis session; can land separately and first if a quick win is wanted
  before the bigger semantic-search change.
