---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
tags: [decision, rhythm, opencode, mcp]
---

# Vendor sst/opencode as a git subtree (`apps/opencode_fork`)

## Context

Rhythm spawns an opencode engine (`opencode serve`) as a child process via
`@opencode-ai/sdk` (^1.14.49) and talks to it over HTTP. The engine binary is
resolved from `PATH` at startup — it is **not** bundled today.

To implement **per-session MCP tool-schema injection scoping** (a "lite" agent
session should only pay the token weight of its Agent Profile's MCP allowlist;
see `docs/ai/current-plan.md` and
`docs/ai/decisions/2026-06-25-per-session-mcp-scoping-investigation.md`), we must
own the engine source so we can carry a minimal patch to `SessionPrompt.resolveTools`.
Upstream sst/opencode has no native per-session MCP schema scoping
(upstream issue sst/opencode#5373).

Two ways to own the source were considered:

1. **Separate fork repository** + git submodule. Adds a second repo to maintain,
   a submodule pointer to bump, and cross-repo CI.
2. **Vendored git subtree** inside this monorepo. Source lives in-tree, CI stays
   in one place, and upstream syncs are a single `git subtree pull` with no
   submodule/rebase ceremony.

## Decision

Vendor `github.com/sst/opencode` at tag **v1.14.49** as a **git subtree** under
`apps/opencode_fork`, imported with `--squash` so Rhythm history carries one
squash commit per upstream sync (not the full upstream history).

**Why v1.14.49:** the installed SDK is `@opencode-ai/sdk ^1.14.49`. Aligning the
vendored engine to the same tag removes the prior 1.14.40↔1.14.49 drift noted in
the investigation. MCP logic was verified materially identical across those
versions; v1.14.49 is the cleanest base and matches the SDK the api_server links.

**Scope rule:** the subtree is **source for building a standalone engine binary
only** (Issue mcp-scope-03 produces a `bun build --compile` binary). It is **not**
imported into the api_server TypeScript build — no `apps/opencode_fork` path may
appear in `apps/api_server/tsconfig.json` or any existing build pipeline.

## Commands

### Initial import (already executed, 2026-06-25)

```bash
git subtree add --prefix=apps/opencode_fork \
  https://github.com/sst/opencode v1.14.49 --squash
```

### Future upstream sync (pull a newer tag)

```bash
# Replace vX.Y.Z with the target upstream tag.
git subtree pull --prefix=apps/opencode_fork \
  https://github.com/sst/opencode vX.Y.Z --squash
```

This produces a new squash commit + merge. Resolve conflicts in our minimal
patch (`packages/opencode/src/session/prompt.ts`, `mcp/index.ts`, `session/session.ts`)
if upstream moved the touched lines; the patch is intentionally small to keep
these merges cheap.

### Rebase-our-patch-on-upstream procedure (when a `subtree pull` conflicts heavily)

If `git subtree pull` produces a large/awkward conflict (upstream refactored the
MCP loop), prefer re-applying our patch cleanly instead of hand-merging:

1. Record our patch as a diff before syncing:
   `git diff <pre-fork-base>..HEAD -- apps/opencode_fork/packages/opencode/src/{session,mcp} > /tmp/rhythm-mcp-patch.diff`
2. Vendor the new tag into a scratch worktree/branch with a fresh
   `git subtree add ... <newtag> --squash` (or `pull`).
3. `git apply --3way /tmp/rhythm-mcp-patch.diff`, resolve any rejects against the
   new upstream lines, and re-run the fork's `packages/opencode` typecheck.
4. Update the patch's line-number references in mcp-scope issues 02/04 if upstream
   shifted them.

Keep the patch surface minimal (one optional field on `Session.Info`/`CreateInput`
+ one gated `continue` in `resolveTools` + a composed-key index in `mcp/index.ts`)
precisely so these syncs stay mechanical.

### Rebuild the fork-generated SDK artifact (#1132)

After every subtree sync—or any change to the fork's HTTP API/schema—run:

```bash
cd apps/opencode_fork/packages/sdk/js
bun run build:rhythm
```

This is the single supported SDK materialization command. It:

1. generates the fork's OpenAPI document from the engine;
2. preserves explicit-null semantics for the two session allowlist fields
   (the engine's OpenAPI emitter currently drops `Schema.NullOr` on object
   properties);
3. regenerates v2 client/types;
4. deletes both `dist/` and the composite `.tsbuildinfo`, then forces a complete
   JS + `.d.ts` emit; and
5. refreshes the committed, installable package at
   `apps/api_server/vendor/opencode-ai-sdk`.

`api_server` consumes that artifact through
`"@opencode-ai/sdk": "file:vendor/opencode-ai-sdk"`. The fork source remains
outside the API TypeScript build. The committed vendor directory is required
because Docker builds and the macOS release bundle install the API package from
a detached directory where a live relative reference into `opencode_fork`
would not exist.

The fork CI reruns the command and requires a clean diff across the checked-in
spec, generated v2 surface, and API vendor package. A stale artifact therefore
fails before merge.

## Alternatives

- **Separate fork repo + submodule** — rejected: two repos, submodule pointer
  bumps, split CI.
- **Runtime monkey-patch / SDK wrapper** — rejected: the token-weight fix is in
  the engine's schema assembly (`resolveTools`), which the SDK does not expose;
  can only be changed in engine source.
- **Per-directory MCP isolation** (the earlier "3c" approach) — rejected: agents
  working in the *same* project directory need *different* scoping, so a
  per-directory key collides. Superseded; see the investigation decision doc.

## Consequences

- `apps/opencode_fork/**` (the full upstream monorepo: ~20 packages) is now
  committed in-tree. Build artifacts are excluded via the subtree's own
  `.gitignore` plus explicit root `.gitignore` entries.
- Upstream syncs are a single `git subtree pull ... --squash`; our patch must be
  re-validated against moved lines on each sync.
- `packages/opencode` supplies the standalone engine binary and
  `packages/sdk/js` supplies the generated client artifact consumed by
  `api_server`. Other packages (web, desktop, console, SST infra) ride along as
  source but are never built by Rhythm CI.
- The standalone binary build, signing, and bundling are deferred to
  mcp-scope-03; this decision covers vendoring only.

## Known upstream baseline (typecheck)

Pristine v1.14.49 does **not** typecheck clean in `packages/opencode` with its own
locked deps: `tsgo --noEmit` and `tsc 5.8.2` both report exactly **one** error —
`src/bus/global.ts(14,12) TS2416`, where `GlobalBusEmitter.emit`'s override is
narrower than the `@types/node` 24.x `EventEmitter` base signature. Our
`bun install` did not modify `bun.lock`, so this is upstream's exact dependency
closure, not Rhythm drift. The error is unrelated to MCP and does **not** block the
binary: `bun build` transpiles the file at exit 0 (type errors don't gate the
bundler). Recorded during the mcp-scope-01 verification (failure-triage, 2026-06-25).

**Disposition:** mcp-scope-01 leaves the source pristine. mcp-scope-02 — which
already patches the fork — carries a minimal, commented type-only fix to that
`emit` override so the opencode-package `bun run typecheck` is green for all
downstream gates. Keep this carried patch tiny; re-validate/re-apply it on every
`git subtree pull`.

## Re-vendor checklist (2026-09-29)

The subtree was imported once (v1.14.49, this commit) and never re-pulled — the
patch sites below are future risk, not past loss. Before any `git subtree pull`,
and again right after, run the commands below and diff the results; a patch
site whose test goes red (or whose marker comment/grep hit disappears) did not
survive the merge and needs manual re-application.

| Patch site | What it does | Prove it survived |
|---|---|---|
| `packages/opencode/src/tool/task.ts` (`childScope`, `childMcpAllowlist`, `childSkillAllowlist`) | Delegated task-tool children resolve their own profile's MCP/skill scope, falling back to the parent's scope only when profile-less (never "everything") | `cd apps/opencode_fork/packages/opencode && bun test test/tool/task.test.ts` (expect 25 pass — includes the real-writer contract test) |
| `packages/sdk/js/src/{server,process}.ts` (commit `13624919`) | `createOpencodeServer()` spawns the engine `detached: true` (own process group) so `stop()` can reap the whole tree, not just the engine pid | `bun test test/util/process.test.ts` (fork side) + `cd apps/api_server && npx vitest run src/__tests__/issue_655_contract.test.ts` |
| `packages/opencode/src/session/{mcp_allowlist,mcp_deferred_tools,skill_allowlist}.ts`, `session.ts`, `session.sql.ts`, `prompt.ts`, `system.ts` | Per-session MCP/skill allowlist columns + `SessionPrompt.resolveTools` scoping (the mcp-scope-02/03 token-weight fix this doc covers) | `bun test test/session/mcp_allowlist_e2e.test.ts test/session/mcp_gemini_cap_e2e.test.ts` |
| `packages/opencode/src/mcp/index.ts`, `security/rhythm-mcp-proof.ts`, `server/routes/instance/httpapi/groups/{instance,session}.ts`, `handlers/session.ts` | MCP Apps negotiation/execution gating + result-envelope preservation (#1341/#1342/#1345/#1352/#1356/#1357) | `bun test test/mcp/issue_1352_mcp_apps_contract.test.ts test/session/issue_134*.test.ts test/session/issue_135*.test.ts` |
| `packages/opencode/src/skill/index.ts`, `tool/skill.ts` | Skill discovery/injection scoping | `bun test test/skill/skill.test.ts test/tool/skill.test.ts` |
| `packages/opencode/src/tool/image-generation.ts` | Tool image downscaling (keep original on failure) | `grep -n "downscal" packages/opencode/src/tool/image-generation.ts` (no dedicated suite; re-check by hand if this diverges) |
| `packages/sdk/js/src/rhythm.ts`, `client.ts`, `v2/gen/sdk.gen.ts` | Rhythm-specific SDK additions + generated client surface consumed by `apps/api_server` (mirrored copy lives in `apps/api_server/vendor/opencode-ai-sdk`) | `cd apps/api_server && npx tsc --noEmit` (catches a shape drift against the vendored `.d.ts` copy) |

General sweep for anything not listed above: `git -C apps/opencode_fork log --oneline <old-subtree-sha>..HEAD -- packages` lists every Rhythm commit since the last vendor point once one exists; until then, `grep -rl "Rhythm\|#1[0-9][0-9][0-9]" packages/opencode/src packages/sdk/js/src` (excluding `cli/cmd/tui/context/theme/*.json`, which are false-positive hex colors) finds the current patch surface.

Full regression gate after a pull: `cd apps/opencode_fork/packages/opencode && bun test` (whole suite) plus `cd apps/api_server && npm test` (contract tests that cross the writer/reader boundary, e.g. `opencode_agent_writer*.test.ts`, `issue_655_contract.test.ts`).
