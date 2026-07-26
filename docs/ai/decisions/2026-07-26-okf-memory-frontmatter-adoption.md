---
date: 2026-07-26
repo: rhythm
branch: claude/rhythm-memory-improvements-l7o6dt
pr:
issues: [1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 1196]
status: planned
tags: [decision, rhythm]
---

# Adopt OKF frontmatter conventions for the memory vault

## Context

Rhythm's agent memory (epic #801, #802, #805, #807, #859a/b) stores facts as markdown
notes with YAML frontmatter under `<memoryDir>/<kind>/<slug>.md`, treats the Obsidian
Memory-Vault as source of truth, and rebuilds a disposable SQLite `agent_memory` index
that the prompt path reads exclusively. That architecture works. What it lacks is any
notion of **trust or time**.

Today a note's entire provenance is `source: "agent"` — one opaque string. Consequences:

- `buildMemoryPreface` renders every match as an identical `- ${m.content}` bullet, so a
  fact the agent inferred once carries the same weight as one the user confirmed.
- Nothing expires. Church-staff facts routinely have a shelf life (who is covering youth
  this quarter, a project deadline, a service time) and are injected forever.
- `agent_session_memory_provenance` records which memories fed a session — the reverse of
  the useful direction. There is no record of where a fact came from.
- The consolidation pass folds N notes into the oldest survivor via `mergeMemoryContent`;
  the merged-in claims lose their origin entirely.

[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
(OKF v0.2, from `GoogleCloudPlatform/knowledge-catalog`) is a vendor-neutral convention
for knowledge as markdown + YAML frontmatter in a directory tree. It converged on
essentially the same architecture Rhythm did, and it specifies exactly the fields Rhythm
is missing.

## Decision

Adopt OKF's **frontmatter and layout conventions**, not the format wholesale. Four
workstreams, sequenced across five phases (#1187–#1196):

1. **Foundation (#1187)** — replace both hand-rolled frontmatter parsers with `js-yaml@^4`.
2. **Lifecycle & trust (#1188, #1189, #1190, #1191)** — `status`, `stale_after`,
   `generated`, `verified`; project into the index; gate and rank on them; add a
   verification write path.
3. **Provenance (#1192, #1193)** — `sources[]` with body footnotes, preserved across merges.
4. **Navigation (#1194, #1195)** — generated `index.md` files and tolerant cross-links.
5. **History (#1196)** — `log.md` change history.

### Sub-decisions

**Adopt a real YAML parser up front, rather than flat fields first.** There are two
independent hand-rolled parsers: `parseNote`/`parseFrontmatter` in `memoryVaultSyncService`
and the weaker `readNoteFull` regex in `memoryVaultWriteService`, which extracts only
`id`/`created`/`tags`. Since `renderMemoryNote` rewrites notes from a fixed six-field
struct, **any note touched by merge-on-capture or consolidation silently loses every
frontmatter key outside that set.** Adding OKF fields on top of that would mean the first
merge strips them. Unknown-key round-trip preservation is therefore the load-bearing
requirement, and it needs a real parser. `js-yaml` is not currently an api_server
dependency (only `config_seeds_seeder.ts` provisions it into the seeded OpenCode tools
dir), so this is a genuine new runtime dep, pinned to the `@4` the project already
standardizes on.

**Stale memories are excluded from injection but kept.** Not deleted, not auto-deprecated.
The vault note and index row survive for audit and re-verification. Gating happens before
the `topN` slice so a stale hit is *replaced* by the next live one rather than shrinking
the result set.

**Trust ranks below relevance, not above it.** Comparator order becomes
`matchCount desc → trustTier desc → bestIndex asc → firstSeen asc`. A weakly-relevant
verified fact must not displace a strongly-relevant unverified one.

**Explicit recall is not gated.** The `rhythm_search_memory` MCP tool must still surface
deprecated and stale memories — a user searching their own memory should be able to find
an expired fact and re-verify it. Since that tool shares `AgentMemoryRepository.searchAsync`
with the injection path, gating must live in the retrieval layer, not the repository.

**Keep Rhythm's closed `kind` enum.** OKF's `type` is open and uncentralized; Rhythm's
five-value enum (`fact`/`person`/`project`/`preference`/`context`) is what makes kind-scoped
clustering in the consolidation drafter meaningful. Not adopted.

**Reserved filenames must be excluded from the vault scan before any are written.**
`collectMarkdownFiles` treats every `.md` as a memory note, defaulting missing `kind` to
`fact`. An `index.md` or `log.md` written into the vault would be indexed and injected into
prompts as a remembered fact. #1194 owns the exclusion; #1195 and #1196 depend on it.

## Alternatives considered

- **Flat scalar fields only, stay dependency-free.** Cheapest, no parser risk, ships the
  ranking win fastest. Rejected: cannot represent `verified[]` or `sources[]`, so per-claim
  attribution stays approximate, and the unknown-key stripping bug remains latent.
- **Adopt OKF wholesale, including its `type` model and reference agent.** Rejected: OKF is
  deliberately single-tenant and embedding-free. It has nothing to say about owner scoping,
  the FTS5/Engraph hybrid with RRF fusion, or merge-on-capture — the three hardest things
  Rhythm already built. Its reference agent produces bundles rather than consuming them.
- **Demote stale facts in ranking instead of excluding them.** Rejected: preserves recall
  but risks the agent acting on an expired fact, which is the failure mode being fixed.
- **Auto-deprecate on staleness.** Rejected as too aggressive for a first pass; a still-true
  fact would be silently retired.

## Consequences

- New runtime dependency `js-yaml@^4` in `apps/api_server`; the release bundling step must
  pick it up since the embedded server runs from packaged `node_modules`.
- Six new columns on `agent_memory` (`status`, `stale_after`, `verified_json`,
  `generated_by`, `generated_at`, `trust_tier`) plus `sources_json`. All defaulted so
  existing rows stay valid; no backfill, no forced reindex.
- `trust_tier` is denormalized from `verified_json` so retrieval can sort without parsing
  JSON per row.
- Merge semantics grow: union `verified`, earliest `stale_after`, conservative `status`,
  union `sources` with id-collision rekeying. Consolidation's byte-for-byte
  `revertMemoryConsolidation` must be re-verified against each.
- New cross-user leak surface via link traversal (#1195) — needs an explicit test alongside
  the existing owner-scoping guards.
- Legacy notes with none of the new fields remain valid and read as
  stable/unverified/never-stale. The regression bar throughout is that a legacy vault
  produces a byte-identical preface.
