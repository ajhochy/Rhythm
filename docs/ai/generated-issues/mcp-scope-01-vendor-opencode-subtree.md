# [mcp-scope-01] Vendor sst/opencode as `apps/opencode_fork` git subtree

**Plan:** Per-session MCP tool-schema injection scoping
**Branch:** `feature/agent-scheduler`
**Dependencies:** none
**Blocks:** mcp-scope-02, mcp-scope-03

---

## Context

Rhythm uses the `@opencode-ai/sdk` (^1.14.49) to spawn an opencode engine as a
child process (`opencode serve`) and communicate with it over HTTP. The engine
binary is resolved from PATH at startup — it is NOT bundled with the app today.

To implement per-session MCP tool-schema filtering, we must own the engine source.
Rather than maintaining a separate fork repository, we vendor the upstream
`sst/opencode` source as a git subtree under `apps/opencode_fork`. This lets us
carry a minimal patch, stay in the same monorepo for CI, and sync with upstream
via `git subtree pull` without a rebase ceremony.

**Why v1.14.49?** The installed SDK is `@opencode-ai/sdk ^1.14.49`. Aligning
the vendored engine to the same tag removes the existing 1.14.40↔1.14.49 drift
documented in the investigation. MCP logic was verified byte-identical between
the two versions; v1.14.49 is the cleanest base.

The vendored subtree must NOT be imported into the TypeScript build — it is
source for building a standalone binary only. No `apps/opencode_fork` path should
appear in `apps/api_server/tsconfig.json` includes.

---

## Acceptance Criteria

- [ ] `apps/opencode_fork/` exists as a git-subtree import of `github.com/sst/opencode`
  at tag **v1.14.49**; `git log --oneline apps/opencode_fork/ | head -1` shows the
  squash-merge commit with that tag in the message.
- [ ] A decision doc at `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md`
  records: chosen tag + rationale, the exact `git subtree add` command used, the
  `git subtree pull` command for future upstream syncs, and the rebase-on-upstream
  procedure.
- [ ] On a clean checkout: `cd apps/opencode_fork && bun install && bun run typecheck`
  (or the fork's equivalent check script, e.g. `bun run --filter opencode typecheck`)
  exits 0.
- [ ] `apps/opencode_fork/` is listed in `.gitignore` exclusions only for build
  artifacts (e.g. `apps/opencode_fork/.bun/`, `apps/opencode_fork/node_modules/`)
  — the source itself is committed.
- [ ] Root `AGENTS.md` contains a note pointing to the decision doc and explaining
  that `apps/opencode_fork` is a vendored subtree, not a standalone project.
- [ ] No `apps/opencode_fork` path bleeds into `apps/api_server/tsconfig.json` or
  any existing build pipeline.

---

## Likely Files

- `apps/opencode_fork/**` (new — entire subtree import)
- `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md` (new)
- `AGENTS.md` (add note about subtree)
- `.gitignore` (add build-artifact exclusions for the subtree)

---

## Required Tests / Evaluation

| Check | Command | Pass condition |
|---|---|---|
| Subtree installed | `git log --oneline apps/opencode_fork/ \| head -1` | Contains "v1.14.49" |
| Fork typechecks | `cd apps/opencode_fork && bun install && bun run typecheck` | Exit 0 |
| No bleed into api_server build | `cd apps/api_server && npx tsc --noEmit` | Exit 0 (unchanged) |

No vitest tests are added in this issue — verification is structural (subtree
presence, build success). Issue 2 adds the fork's first unit test.

---

## Safety Notes

- **No secrets in the subtree.** `sst/opencode` is public Apache-2.0. Confirm
  the squash-merge carries no `.env` files or credential literals before pushing
  the feature branch.
- **Build artifacts must not be committed.** Add `apps/opencode_fork/node_modules/`,
  `apps/opencode_fork/.bun/`, and Bun's output directories to `.gitignore`.
- **No merge to `main`.** This PR lives on `feature/agent-scheduler` only
  (AGENTS.md / CLAUDE.md policy).
- **GitNexus:** no symbols are modified; `detect_changes` will show only new
  untracked files. No `impact` call required for this issue.

---

## Open Questions — RESOLVED (orchestrator, 2026-06-25)

**R1 (Binary provisioning — shapes Issue 3):** There is no upstream binary
download in `desktop_release.yml` to swap. The SDK's `createOpencodeServer` spawns
`opencode` resolved from PATH. Issue 3 will build a Bun-compiled standalone binary
for macOS arm64 + x64. This issue (01) only imports the source; the binary build
is Issue 03.
