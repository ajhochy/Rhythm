---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d1-tool-vetting-sonnet
pr: null
issues: [1429]
status: pass
tags: [run, rhythm, d1, security, managed-installer]
---

# D1 managed installer artifact-boundary security repair

## Files

- `tool_install_artifact.ts` now fully validates immutable tar archive bytes.
- `tool_install_apply.ts` constrains managed paths to canonical direct children and revalidates the staged archive before npm.
- Managed-apply and live approval tests cover the reviewed symlink, source-swap, archive-ambiguity, and activation paths.
- `issue-1429.json` records this repair evidence.

## RED

Before the repair, `tool_install_managed_apply.test.ts` showed each pre-created `tools`, `.staging`, and `.locks` symlink reached the injected runner; an exact destination symlink with a matching receipt was accepted; the post-inspection artifact swap reached the runner; and duplicate `package/package.json`, packaged `package/node_modules`, and `bundleDependencies` archives passed inspection.

## Checks

- Focused GREEN: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" npx vitest run src/services/__tests__/tool_install_managed_apply.test.ts` — 15 passed, 1 expected Docker skip.
- Explicit D1.1–D1.4 + Docker: `RHYTHM_DOCKER_E2E=1 ... npx vitest run <12 D1 files>` — 12 files, 279 passed. The managed immutable-tarball Docker vet ran live, and no `rhythm-d1-vet-*` container remained.
- Node 22: `npx tsc --noEmit` and `npm run build` passed.
- Live: built fork plus API, then `tools/dev/sandbox.sh up --foreground` with a sanitized copied SQLite/config fixture and a 206-byte self-contained local tarball at the sandbox-owned artifact root. `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/d1_tool_install_approval_live_e2e.test.ts --no-file-parallelism --reporter=verbose` — 1 passed. It observed real Docker vet → `sandbox-vetted` → approval `applied` plus an on-disk receipt; a missing digest remained `pending`/`unknown` and was denied.
- Cleanup: `sandbox.sh down` removed the exact sandbox/staging tree; ports 4097/4098/4099 had no listeners; Docker filter `rhythm-d1-vet-` was empty.
- Repository checks: `git diff --check` and the changed-line secret scan were clean. `ai-workflow checks --level issue` and `--level pr` both reached a non-repair environment blocker at `apps/mcp_server`: its TypeScript compiler dependency is absent and its `tsc` command prints “This is not the tsc command you are looking for”. Flutter formatting/analysis and the API Node 22 typecheck had already passed in both runs.

## Notes

The test hook exists only to deterministically mutate the source after initial inspection. It demonstrates that the staged bytes, not the mutable source pathname, are validated before npm. No #1430/D4 work was included. GitNexus impact/detect remains UNKNOWN because this worktree is not indexed in this session.
