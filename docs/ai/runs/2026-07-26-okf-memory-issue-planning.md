---
date: 2026-07-26
repo: Rhythm
branch: claude/rhythm-memory-improvements-l7o6dt
pr: (none — planning run, no implementation)
issues: [1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 1196]
status: pass
tags: [run, Rhythm]
---

## Scope

Planning-only run. Evaluated `GoogleCloudPlatform/knowledge-catalog` (specifically its
`okf/` Open Knowledge Format spec, v0.2) against Rhythm's agent-memory subsystem, then
converted the applicable parts into ten GitHub issues. **No source files were changed.**

## Files changed

- NEW `docs/ai/decisions/2026-07-26-okf-memory-frontmatter-adoption.md` — the durable
  decision: which OKF conventions to adopt, which to reject, and why.
- NEW `docs/ai/runs/2026-07-26-okf-memory-issue-planning.md` — this file.

`docs/ai/project-state.md` was deliberately **not** overwritten. It currently tracks the
creative-platform workstream (branch `feature/creative-platform-integration`, draft PR
#1179, awaiting manual visual smoke before merge). This run changed no code and did not
shift project focus; overwriting would have destroyed live state about a PR pending
sign-off.

## Codebase reviewed

Read in full or in relevant part:

- `apps/api_server/src/services/memory_retrieval.ts` (390 lines) — FTS token-probe fan-out,
  junk suppression, RRF fusion with the Engraph semantic lane, `buildMemoryPreface`.
- `apps/api_server/src/services/memoryVaultWriteService.ts` — `NoteFrontmatter`,
  `renderMemoryNote`, `readNoteFull`, merge-on-capture, `VALID_MEMORY_KINDS`.
- `apps/api_server/src/services/memoryVaultSyncService.ts` — `parseNote`,
  `parseFrontmatter`, `collectMarkdownFiles`, `scanVaultNotes`, tombstoning.
- `apps/api_server/src/services/memory_consolidation_drafter.ts` — clustering, survivor
  selection, `beforeSnapshot` / `revertMemoryConsolidation`.
- `apps/api_server/src/services/memory_index_service.ts`, `memory_similarity.ts`.
- `apps/api_server/src/database/migrations.ts` (~1306) — `agent_memory` schema,
  `agent_memory_fts`, `agent_session_memory_provenance` (~1888).
- `apps/api_server/package.json` — dependency audit for the YAML decision.

## Findings that shaped the plan

1. **Latent frontmatter-stripping bug.** `readNoteFull` extracts only `id`, `created`,
   `tags` via regex, and `renderMemoryNote` rewrites from a fixed six-field struct. Any
   note passing through merge-on-capture or the consolidation pass loses every other
   frontmatter key. Adding OKF fields without fixing this first would mean the first merge
   silently discards them. This is why #1187 (YAML parser + unknown-key round-trip
   preservation) is the blocking foundation rather than a cleanup.

2. **Reserved-filename hazard.** `collectMarkdownFiles` ingests every `.md` in the vault
   and `parseNote` defaults an absent `kind` to `'fact'`. Writing an OKF `index.md` or
   `log.md` into the vault would index it as a memory and inject it into prompts. The
   exclusion is therefore a prerequisite inside #1194, and #1195/#1196 are blocked on it.

3. **Gate placement.** `getRelevantMemories` ranks then `.slice(0, topN)`. Filtering the
   returned array would shrink results below `topN`; the gate must run before the slice in
   all three lanes (FTS, semantic join, `fuseMemoryRanks`).

4. **Shared-repository leakage.** `rhythm_search_memory` and the injection path share
   `AgentMemoryRepository.searchAsync`. Gating inside the repository would also hide
   deprecated/stale memories from explicit user recall, which is the wrong behavior.

5. **`js-yaml` is not an api_server dependency.** Absent from `apps/api_server/package.json`,
   the root `package.json`, and `node_modules`. Its only presence is
   `config_seeds_seeder.ts` provisioning `js-yaml@4` into the seeded OpenCode tools dir —
   a separate concern. #1187 adds a genuine new runtime dep.

## Issues created

| # | Phase | Title | Blocked by |
|---|---|---|---|
| 1187 | 1 | Replace hand-rolled memory frontmatter parsers with js-yaml | — |
| 1188 | 2 | Add lifecycle + trust frontmatter (status, stale_after, generated, verified) | 1187 |
| 1189 | 2 | Project lifecycle/trust fields into the derived agent_memory index | 1188 |
| 1190 | 2 | Add a verification write path (confirm / deprecate a memory) | 1188 |
| 1191 | 2 | Gate stale/deprecated out of injection and rank by trust tier | 1189 |
| 1192 | 3 | Add per-claim sources attribution to memory notes | 1187, 1188 |
| 1193 | 3 | Preserve per-claim attribution when consolidation merges notes | 1192 |
| 1194 | 4 | Generate index.md navigation and exclude reserved filenames from the scan | 1187 |
| 1195 | 4 | Support tolerant cross-links between memory notes | 1194 |
| 1196 | 5 | Write a human-readable log.md history of memory changes | 1194 |

Critical path: 1187 → 1188 → 1189 → 1191.

## Checks run

None applicable — no source changed, so no build, test, format, or analyze gate was
triggered. Every issue body carries its own required-tests section
(`tsc` clean + vitest green at minimum).

## Notes

- Milestones were **not** created. The GitHub MCP server exposes no milestone tool, and the
  REST API returns 403 through the agent proxy (only the MCP path is permitted). Phases are
  encoded in issue titles (`MEM-OKF Phase N:`) and in per-issue Dependencies sections,
  matching how the existing OCU/iOS issue families express ordering. Issues can be attached
  to milestones later via `issue_write`'s `milestone` parameter if they are created in the
  UI.
- No labels applied — the repo's existing issues carry none.
- Issue bodies follow the house style observed on #1176–#1178 (`## Summary`,
  `## Acceptance criteria`, `## Likely files`, `## Required tests`,
  `## Safety / out of scope`) rather than the thinner `.github/ISSUE_TEMPLATE/ai-coding-task.md`.
- Each issue is written to be self-contained: an implementing agent should not need to read
  the others or the OKF spec to proceed.
