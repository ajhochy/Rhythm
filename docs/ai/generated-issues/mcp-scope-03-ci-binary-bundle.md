# [mcp-scope-03] CI: build forked engine binary + bundle in macOS app

**Plan:** Per-session MCP tool-schema injection scoping
**Branch:** `feature/agent-scheduler`
**Dependencies:** mcp-scope-01 (subtree), mcp-scope-02 (engine patch)
**Blocks:** mcp-scope-06 (full acceptance requires the bundled fork)

---

## Context

Today `opencode_client_service.ts:203` calls `augmentPathForOpencode()`, which
prepends `~/.opencode/bin`, `/opt/homebrew/bin`, `/usr/local/bin` to PATH and
then spawns `opencode serve`. The binary that executes is the user's
independently-installed opencode (currently 1.14.40) — **not** a Rhythm-bundled
file.

To ensure our patched fork is always used (not a user's PATH opencode), we must:

1. **Build** the forked Bun project to a standalone binary in CI.
2. **Bundle** the binary into the macOS app at a known path
   (`Rhythm.app/Contents/Resources/opencode`).
3. **Prefer** the bundled binary: make `augmentPathForOpencode()` (or the spawn
   path) prepend the bundled binary's directory first, so `opencode` resolves to
   the fork in production.
4. **Sign** the new binary (it must be added to
   `tools/release/sign_and_notarize_macos.sh`'s sign list — unsigned native
   binaries break Gatekeeper on non-App-Store distribution).
5. **Fail hard** if the bundled binary is missing or unsigned in a release build.

**Build toolchain:** opencode is a Bun project. Use `bun build --compile` to
produce a standalone binary. Must target **macOS arm64** and **macOS x64**
(universal or two separate binaries — check `desktop_release.yml`'s existing
arch handling for the api_server bundle).

**Local dev fallback:** when the bundled binary is absent (e.g. `flutter run`
without a release build), the existing PATH fallback behavior is preserved — the
dev session uses whatever `opencode` is on PATH. This fallback MUST NOT silently
obscure whether the patch is active; add a log line at WARN level when the PATH
fallback fires.

**Version/marker assertion:** the bundled fork binary must emit an identifiable
marker when run with `opencode --version` or a custom env flag (e.g.
`OPENCODE_FORK_MARKER=1 opencode --version`) that the smoke step can assert on,
confirming the app is using the fork and not a user's PATH binary.

This is the **riskiest issue** in the plan (see plan "Design tensions"). It
touches CI, signing, binary distribution, and PATH resolution. Do not start this
issue until Issues 01 and 02 are merged to the feature branch.

---

## Acceptance Criteria

- [ ] New CI step in `.github/workflows/desktop_release.yml`: "Build opencode
  fork binary" runs `bun build --compile` on `apps/opencode_fork` for macOS arm64
  and x64; output binary placed at a staging path.
- [ ] New CI step "Bundle opencode fork binary": copies the compiled binary into
  `Rhythm.app/Contents/Resources/opencode` (or an `opencode_bin/` subfolder under
  Resources — consistent with how `api_server` is bundled at lines 95-125).
- [ ] `tools/release/sign_and_notarize_macos.sh` — the new binary path is added
  to the sign list; the script exits non-zero if the binary is absent.
- [ ] `opencode_client_service.ts` — `augmentPathForOpencode()` prepends the
  bundled binary's directory (resolved relative to the running api_server process,
  e.g. `path.join(__dirname, '..', '..', 'opencode')`) **before** `~/.opencode/bin`.
  A WARN-level log fires when the bundled binary is not found and PATH fallback
  is used.
- [ ] **Verify step in CI** ("Verify bundled payload"): asserts the binary exists,
  is executable (`-x`), and is codesigned (`codesign -v`).
- [ ] **Smoke step in CI** (optional but strongly recommended): spawns the binary
  and asserts it outputs a version string containing the fork marker.
- [ ] `flutter run -d macos` still works locally (PATH fallback for dev; WARN log
  confirms it).
- [ ] Release DMG smoke: after install, launch Rhythm, open an agent session, and
  confirm the engine binary path reported in logs is the bundled fork binary, not
  `~/.opencode/bin/opencode`.

---

## Likely Files

- `.github/workflows/desktop_release.yml` (new build step, bundle step, verify step)
- `apps/opencode_fork/` (build script or `package.json` build target)
- `apps/api_server/src/services/opencode_client_service.ts` (`augmentPathForOpencode`, lines ~203-230)
- `tools/release/sign_and_notarize_macos.sh` (add new binary to sign list)
- `apps/desktop_flutter/macos/Runner/` (may need entitlement or resource reference — check)

---

## Required Tests / Evaluation

| Check | Command / method | Pass condition |
|---|---|---|
| CI binary build | `desktop_release.yml` "Build opencode fork binary" step | Exits 0; binary present at staging path |
| CI verify payload | "Verify bundled payload" step | Binary exists, is executable, is codesigned |
| CI smoke (fork marker) | Spawn binary with `--version` or `OPENCODE_FORK_MARKER=1` | Output contains the fork marker string |
| Signing | `codesign -v Rhythm.app/Contents/Resources/opencode` | Exits 0 |
| Local dev PATH fallback | `flutter run`; check server logs | WARN log present; app still usable |
| Release DMG smoke | Launch app, open session, check engine path in logs | Bundled fork binary path confirmed |

---

## Safety Notes

- **This is the riskiest issue.** Touching CI, binary signing, and PATH resolution
  has a large blast radius. Validate locally before pushing to CI.
- **Two arch targets.** `desktop_release.yml` presumably builds for arm64 + x64
  (or a universal binary). The opencode fork binary must match — verify the
  existing CI matrix before writing the build step.
- **Signing discipline.** Every native binary distributed in a non-sandboxed macOS
  app must be signed and notarized. An unsigned binary fails Gatekeeper silently
  at runtime (the user sees a crash, not an error dialog). Add the binary to the
  sign list **before** the notarization step, not after.
- **No silent PATH fallback in release.** The verify step must fail the build if
  the bundled binary is missing. A silent fallback would ship a release that uses
  the user's unpatched PATH opencode — the entire purpose of this issue is to
  prevent that.
- **GitNexus:** run `impact({ target: "augmentPathForOpencode", direction: "upstream" })`
  before editing `opencode_client_service.ts`. Also `detect_changes` before commit.

---

## Open Questions — RESOLVED (orchestrator, 2026-06-25)

**R1 (Binary provisioning):** There is no existing upstream binary download to
replace. The work is: (a) compile the fork with `bun build --compile` for macOS
arm64 + x64; (b) bundle the binary into `Rhythm.app/Contents/Resources/`; (c) add
to `tools/release/sign_and_notarize_macos.sh`; (d) make `api_server` resolve the
bundled binary first (prepend its directory to PATH before `createOpencode()`),
with fallback to PATH for local dev. No SDK fork needed.
