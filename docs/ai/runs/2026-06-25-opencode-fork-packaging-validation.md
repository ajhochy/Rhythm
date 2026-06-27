---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
pr: 734
issues: []
status: verified end-to-end — desktop_release v18.49 GREEN (notarized + published)
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# opencode fork macOS build/packaging validation

Validated the vendored opencode fork's full build → universal bundle → codesign →
release pipeline. No source changes were required — every opencode-specific step
passed as-is. The only failures encountered were environmental (host memory; Apple
account legal agreement), not code bugs.

## Phase A — local packaging loop

1. **Full build w/ web-UI embed** (`bun run build --macos`, no `--skip-embed-web-ui`) — ✅
   vite built the web UI in 8.49s and it embedded; both `dist/opencode-darwin-{arm64,x64}/bin/opencode`
   produced (105MB arm64, 112MB x64), correct single arches. Fork marker: `0.0.0-feature/agent-scheduler-202606260053`.
2. **lipo universal merge** — ⚠️ ENVIRONMENT-LIMITED. Exit 137 (SIGKILL/jetsam) on both
   iterations. Verified NOT a code bug: each input is a valid single-arch Mach-O
   (`lipo -archs` exit 0), and `lipo -create` works on small inputs. The ~218MB merge is
   killed because the dev box had ~282MB truly-free pages and 2.27M historical pageouts.
   Could not free more without quitting the user's apps (Claude/Obsidian/Codex/Rhythm/a VM).
   Per runbook, stopped looping; CI performs this merge.
3. **Fork marker** — ✅ (per-arch binary, since universal unavailable locally): not stock.
4. **Ad-hoc codesign of extensionless Mach-O** — ✅ `codesign --force --options runtime
   --timestamp --sign -` then `codesign -v` both succeed (proves the sign-script invocation).
5. **Bundling/resolution unit tests** — ✅ `opencode_client_service.test.ts` 21/21 pass.

## Phase B — real release pipeline (definitive packaging test)

- Triggered `desktop_release.yml` on `feature/agent-scheduler`, version `18.48`
  (next patch after v18.47; tag `v18.48`). Run: https://github.com/ajhochy/Rhythm/actions/runs/28210169900
- **All opencode steps passed on CI:** Set up Bun ✅ · Build opencode fork binary ✅ ·
  Bundle opencode fork binary (universal / **lipo**) ✅ · Verify bundled payload ✅ ·
  **Smoke opencode fork marker ✅** (`0.0.0-feature/agent-scheduler-202606260103` →
  "Fork marker verified: binary is not a stock release") · Package macOS artifacts ✅.
- The sign script **successfully codesigned the opencode binary** in the real run:
  `.../Resources/opencode_bin/opencode: replacing existing signature`, then all nested
  binaries, the app, and built the DMG.
- **Run failed only at notarization:** `Error: HTTP status code: 403. A required
  agreement is missing or has expired...` — an Apple Developer Program legal-agreement
  issue (account admin must accept the updated agreement in App Store Connect). Not a
  code bug; re-triggering would hit the identical 403, so stopped rather than loop.

## Re-run after Apple agreement fix — v18.49 GREEN

User accepted the updated Apple Developer Program agreement, then re-triggered with
version `18.49`. Run https://github.com/ajhochy/Rhythm/actions/runs/28210597758 —
conclusion **success**. All steps passed including **Sign and notarize ✅**, Verify
signed OAuth build ✅, and Publish GitHub release ✅. The 403 is resolved; the notarized
DMG is published.

## Conclusion

The opencode fork packaging is **fully validated end-to-end** through the real release
pipeline (v18.49 green, notarized + published): builds with web UI embedded, lipo-merges to universal on CI, codesigns the
extensionless Mach-O, and the bundled binary is confirmed to be the fork (not stock).
Two environmental blockers remain, neither in scope/fixable by code:
- Local `lipo` OOM on the memory-constrained dev box (CI handles it fine).
- Apple notarization 403 — expired/unsigned Apple Developer Program agreement.

## Runtime bug found + fixed (item (e)) — v18.50

Inspecting the running v18.49 instance revealed the bundled fork was NOT being
spawned: the app ran stock `~/.opencode/bin/opencode` 1.14.40 instead. Root cause
in `augmentPathForOpencode()` — it climbed two dirs from the compiled module
(`dist/services/opencode_client_service.js`) to find `opencode_bin`, resolving to
`…/api_server/opencode_bin` (nonexistent) instead of `…/Resources/opencode_bin`
(three up). `existsSync` was always false → bundled dir never prepended → SDK's
`cross-spawn` fell through to stock opencode. The fork was bundled + signed
correctly but inert at runtime.

Fix (commit `962f1ac4e`, on `feature/agent-scheduler`): probe candidate depths
(dist/services → 3 up, flattened dist/ → 2 up), use the first whose `opencode`
binary exists; robust to future output-nesting changes. Added a regression test
that simulates the real `dist/services` layout and fails on the old code.
22/22 tests pass; tsc clean. Released as **v18.50** (run 28212718547, green +
notarized + published). Awaiting user reinstall to confirm the running app now
spawns the bundled universal fork.

## Action needed (user / account admin)

Accept the updated Apple Developer Program License Agreement at
https://appstoreconnect.apple.com (Agreements) / developer.apple.com, then re-trigger
`desktop_release.yml` with the next version tag (`18.49`).
