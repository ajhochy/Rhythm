---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
pr: null
issues: [mcp-scope-01]
status: complete
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# mcp-scope-01 — Vendor sst/opencode as `apps/opencode_fork` subtree

First issue of the per-session MCP tool-schema scoping effort: own the opencode
engine source so a later minimal patch can scope MCP schema injection by Agent
Profile (so "lite" agents don't pay token weight for MCP servers outside their
allowlist).

## Files changed

- `apps/opencode_fork/**` — git subtree import of `github.com/sst/opencode` @ tag
  **v1.14.49** (`git subtree add --prefix=apps/opencode_fork … --squash`). Source
  only; NOT in the api_server TS build.
- `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md` (new) — tag rationale,
  `subtree add` / `subtree pull` / rebase-on-upstream procedures, known baseline.
- `.gitignore` — explicit `apps/opencode_fork` build-artifact exclusions.
- `AGENTS.md` — note that the subtree is vendored, not a standalone project.
- `docs/ai/generated-issues/mcp-scope-02-*.md` — folded the baseline typecheck
  unblock into Issue 02's scope.

Commits: `f0981434b` (subtree merge), `caeb7cb38` (supporting docs/gitignore/AGENTS).

## Checks run

- `git log --oneline apps/opencode_fork/ | head -1` → message contains `v1.14.49` ✓
- `cd apps/opencode_fork && bun install` → exit 0 (lockfile unchanged → upstream's
  exact closure) ✓
- `bun build …/bus/global.ts --target=bun` → exit 0 (transpiles despite baseline) ✓
- `cd apps/api_server && npx tsc --noEmit` → exit 0 (no bleed / no regression) ✓
- GitNexus `detect_changes` vs main → additions-only; no existing code symbol
  modified (the `critical` label is volume-driven by the subtree's file count) ✓

## Notes

- **Repair loop ran (failure-triage).** Pristine upstream v1.14.49 does not
  typecheck clean: one `TS2416` in `packages/opencode/src/bus/global.ts:14`
  (`@types/node` 24.x `EventEmitter` generic-override). Disposition: **OUT OF
  SCOPE** for Issue 01 — unrelated to MCP, non-blocking for the binary (bun
  transpiles it). The minimal type-only fix is folded into **Issue 02** (which
  already patches the fork), not filed as a redundant issue. Recorded in the
  vendoring decision doc as a carried patch to re-validate on each `subtree pull`.
- Issue 01 acceptance was structural (no behavioral contract tests); the
  `acceptance-contract` step was intentionally skipped for this issue.
- Run order on this branch: 01 (done) → 02 → 05 → 04 → local proof → 03 → 06.
