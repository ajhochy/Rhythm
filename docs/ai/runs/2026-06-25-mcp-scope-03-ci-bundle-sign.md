---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
pr: "734"
issues: [mcp-scope-03]
status: done
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# mcp-scope-03 — CI binary bundle + sign + PATH injection

## Files changed

| File | Change |
|------|--------|
| `apps/api_server/src/services/opencode_client_service.ts` | `augmentPathForOpencode()`: checks `existsSync` for bundled binary at `__dirname/../../opencode_bin/opencode`; prepends its dir FIRST when present; WARNs and falls back to existing extras when absent (local dev). |
| `apps/api_server/src/services/opencode_client_service.test.ts` | Added 4 new tests (bundled dir is FIRST, idempotent with bundled, no-throw/no-dir when absent, warn-not-throw on missing); mocked `fs.existsSync` via `vi.mock('fs')` at module level. |
| `.github/workflows/desktop_release.yml` | 5 new steps inserted before "Package macOS artifacts": `Set up Bun`, `Build opencode fork binary` (both arches, assert presence), `Bundle opencode fork binary (universal)` (lipo + chmod +x), `Verify bundled opencode fork payload` (existence + executability), `Smoke opencode fork marker` (`--version` must NOT match `^1\.[0-9]+\.[0-9]+$`). |
| `tools/release/sign_and_notarize_macos.sh` | Explicit `codesign --force --options runtime --timestamp` of `opencode_bin/opencode` before the broad `find` loop; hard `exit 1` if the binary is absent. |

## Checks run

| Check | Result |
|-------|--------|
| `bun run build --single --skip-embed-web-ui` (opencode fork) | PASS — `0.0.0-feature/agent-scheduler-202606260015` |
| `npx tsc --noEmit` (api_server) | PASS — exit 0 |
| `npx vitest run src/services/opencode_client_service.test.ts` | PASS — 21/21 |
| `ai-workflow checks --level issue` | PASS — flutter analyze, dart format, tsc |
| `ai-workflow checks --level pr` | PASS — above + vitest full suite |
| `bun run typecheck` (opencode fork) | PASS — exit 0 |
| `bun test test/session/ src/session/` (opencode fork) | PASS — 325 pass, 0 fail |
| `bash -n sign_and_notarize_macos.sh` | PASS — syntax OK |

## Decisions

**Bundled binary path resolution:** The running api_server entry point is at
`Contents/Resources/api_server/dist/server.js` → `__dirname` = `.../api_server/dist/`.
`path.join(__dirname, '..', '..', 'opencode_bin')` resolves to `.../Contents/Resources/opencode_bin/`.
This is consistent with how `.env` is loaded (`join(__dirname, '..', '.env')` → `api_server/` root).

**`vi.mock('fs')` approach:** `existsSync` is imported at module load time in the service.
Mocking at module level (before the service import) intercepts the import correctly.
`mockReturnValue(false)` is the per-test default; `mockReturnValue(true)` simulates
the bundled binary being present.

**`oven-sh/setup-bun@v2` step added:** `bun` is not available on `macos-latest` runners
by default; the setup action is required for `bun install` + `bun run build` to work in CI.

**`working-directory` for Bundle step:** set to `apps/desktop_flutter` so `$APP` path
(`build/macos/Build/Products/Release/Rhythm.app`) is consistent with the existing
"Bundle CLI server" step. The fork binary source paths use `../../apps/opencode_fork/...`
relative to that working directory.

**Sign script explicit path before find:** the `find` pattern only matches named extensions
(`.framework`, `.dylib`, `.so`, `.node`, `spawn-helper`). An extensionless Mach-O from
`bun build --compile` is invisible to it. Explicit sign before the loop is the correct fix
— a `sort -rz` inside-out order still applies for the find loop, but the opencode binary
sits outside that scope.

See `docs/ai/decisions/` — no new decision doc created (the approach follows directly from
the audit findings inlined in the orchestrator brief).

## Deviations from spec

- The spec said "OR explicitly codesign the known bundled path." We chose the explicit path
  approach rather than adding `-o -name "opencode"` to the find pattern, because a name-only
  match could accidentally sign an unrelated binary named `opencode` if one were ever added
  elsewhere in the bundle tree.
- The YAML working-directory for the Bundle step uses `apps/desktop_flutter` (not the repo
  root) for parity with the existing CLI server bundle step.

## Orchestrator verification & refinements (2026-06-25)

- **`--macos` build refinement (orchestrator edit):** the CI build step originally ran
  `bun run build` (all 12 targets: linux/windows/musl/baseline + web UI) — slow and, per
  build.ts's own comment, baseline/musl runtimes "can be flaky to download." Added a
  `--macos` flag to `apps/opencode_fork/packages/opencode/script/build.ts` that filters to
  the two clean darwin targets (arm64 + x64), and pointed the CI step at `bun run build --macos`.
  This makes the eventual release run faster and less flaky. Validated by running it locally.
- **Fuller local compile proof:** `bun run build --macos --skip-embed-web-ui` produced BOTH
  darwin binaries — `dist/opencode-darwin-arm64/bin/opencode` (87 MB, `--version` smoke passed:
  `0.0.0-feature/agent-scheduler-…`) and `dist/opencode-darwin-x64/bin/opencode` (95 MB,
  cross-compiled). `file` confirms valid `Mach-O … arm64` and `… x86_64`; `lipo -info` accepts
  both as inputs.
- **Local lipo limitation (honest gap):** `lipo -create` of the two binaries into the ~183 MB
  universal could NOT complete in this local environment — it was SIGKILL'd (exit 137, OOM/
  ulimit on the large write), with the sandbox both on and off. This is a local-machine memory
  limit, NOT a binary incompatibility: `file`/`lipo -info` accept the inputs (a real lipo
  rejection is exit 1 + stderr, not SIGKILL). `lipo -create` of two valid single-arch Mach-O is
  a standard op the macos-latest CI runner (~14 GB) handles routinely. The universal-merge step
  is therefore the one part of Issue 03 NOT locally end-to-end proven; it will be exercised on
  the first real release run (Issue 06 handoff).
- Re-verified in orchestrator context: api_server `tsc --noEmit` exit 0; augmentPathForOpencode
  tests 21/21; git tree free of stray build artifacts (`dist/` gitignored).

## Follow-up

- Issue **mcp-scope-06** is next: acceptance measurement in a live Secretary session.
- The `--version` fork-marker regex (`^1\.[0-9]+\.[0-9]+$`) may need tightening if the
  fork ever emits a semver-like version for other reasons; track as a low-priority note.
- Real CI run not triggered (HARD STOP rule). Must be exercised as part of the Issue 06
  smoke handoff.
