---
date: 2026-07-02
repo: Rhythm
branch: issue-834-obsidian-write-designated
pr: null
issues: [834]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Obsidian write grant for secretary + worship-planning (#834)

## Files changed

- `.mcp-roles/secretary.mcp.json` — added the 8 librarian write tools it was
  missing to `mcpServers.obsidian.allowedTools`: `obsidian_post_file`,
  `obsidian_delete_file`, `obsidian_patch_active`, `obsidian_put_active`,
  `obsidian_put_periodic`, `obsidian_patch_periodic`, `obsidian_get_commands`,
  `obsidian_execute_command`. (secretary already had `obsidian_put_file` /
  `obsidian_patch_file` from an earlier ad hoc grant — preserved, not
  duplicated.)
- `.mcp-roles/worship-planning.mcp.json` — added the 7 it was missing:
  `obsidian_delete_file`, `obsidian_patch_active`, `obsidian_put_active`,
  `obsidian_put_periodic`, `obsidian_patch_periodic`, `obsidian_get_commands`,
  `obsidian_execute_command`. (already had `put_file`/`patch_file`/`post_file`.)
- NEW `apps/api_server/src/__tests__/obsidian_write_grants.test.ts` — 3
  contract tests (issue-834-c1/c2/c3). The write-tool set is computed
  dynamically as "every obsidian tool `librarian.mcp.json` has beyond
  `OBSIDIAN_READ_TOOLS`" rather than a hardcoded duplicate list, so it can
  never drift from the reference file. c2 checks each non-designated roled
  agent against its OWN pre-#834 baseline (not an assumed-zero bar) —
  `fantasy-gm` and `worship-production` already carried
  `obsidian_put_file`/`obsidian_patch_file` from an unrelated, pre-existing
  grant (present since the original `.mcp-roles/` scaffolding commit
  `ddbf1aa2a`, predating the #812-era read/search rollout); this issue must
  not widen that surface but is not responsible for retroactively narrowing
  it.
- NEW `docs/ai/contracts/issue-834.json` — all 3 criteria `status: pass`.
- No changes to `agent_profile_sync.ts`, `obsidian_scope_backfill.ts`, or any
  other `.mcp-roles/*.mcp.json` file.

## Advertise-layer verification (no change needed)

The issue asked to verify whether the advertise layer
(`agent_configs.allowed_mcps_json`) needed a matching change for either
designated agent. Investigation:

- Grepped `agent_profile_sync.ts` for literal `"secretary"` / `"worship-planning"`
  — zero hardcoded per-agent overrides exist.
- Both agents' `allowed_mcps_json` is the importer-default array form
  (`["rhythm","obsidian"]`, potentially extended by
  `obsidian_scope_backfill.ts`'s array-append path for pre-existing rows).
- `agent_profile_sync.ts`'s own doc comment (near `IMPORTER_DEFAULT_ALLOWED_MCPS_JSON`)
  states array members are "inherit-all only at the advertise layer" and that
  the actual obsidian tool surface for a ROLED agent is narrowed by its
  `.mcp-roles/<slug>.mcp.json` (the #736 dispatch backstop).

Conclusion: the role file is the sole restrictor; the advertise layer already
inherits-all for the array form. No `agent_profile_sync.ts` edit was made or
needed.

## Checks run

- `npx vitest run src/__tests__/obsidian_write_grants.test.ts` — RED before
  implementation (1 failed: issue-834-c1 "secretary missing 8 write tools";
  2 passed: c2, c3); GREEN after (3/3 passed). Re-confirmed fresh in
  verification-gate.
- Falsification: removed `obsidian_execute_command` from secretary's array →
  issue-834-c1 failed with an exact missing-tool diff; restored → GREEN again.
- `npx vitest run obsidian agent_profile_sync mcp_dispatch_guard
  mcp_allowlist_expander mcp_names_alignment obsidian_scope_backfill` → 10
  files / 77 tests passed.
- `./node_modules/.bin/tsc --noEmit` → exit 0 (bare `npx tsc` fails in this
  repo — no global TypeScript install; must invoke the local binary directly
  or use `npm run build`).
- `npm run build` (`tsc -p tsconfig.json`) → exit 0.
- All `.mcp-roles/*.mcp.json` (13 files — see Notes) validated as parseable
  JSON via `python3 -m json.tool`.
- Full suite: `npx vitest run` → 178 files / 1523 tests passed.
- verification-gate independently re-ran every check above fresh against
  branch `issue-834-obsidian-write-designated` and confirmed PASS.

## Notes

- Decisions: computed the write-tool set from `librarian.mcp.json` at test
  run time (diffed against `OBSIDIAN_READ_TOOLS`) instead of hardcoding a
  tool-name list in the test, per the issue's "do not invent tool names"
  instruction — this also makes the contract self-updating if librarian's
  write set ever changes. Checked non-designated agents against their
  individual pre-existing baselines rather than asserting zero writes
  everywhere, since two agents (fantasy-gm, worship-production) already
  carried unrelated write grants before this issue and narrowing them was
  explicitly out of scope ("only change what's actually needed").
- Deviations from spec: the issue said "All 14 `.mcp-roles/*.mcp.json`" — the
  repo has 13 (confirmed via `git log` that no role file was ever added or
  removed around this change); pinned the test to the real count (13) rather
  than the issue's stated number, and recorded the discrepancy in the
  contract JSON's `reason` field for issue-834-c3.
- Concerns: none outstanding. `apps/api_server/node_modules` was symlinked
  from the main checkout for this worktree; not committed.
- No PR opened per the task's instructions (implementation + push only).
