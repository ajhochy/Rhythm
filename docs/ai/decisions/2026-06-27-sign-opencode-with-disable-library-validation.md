---
index: "[[Rhythm]]"
date: 2026-06-27
repo: rhythm
tags: [decision, rhythm]
---

# Sign the bundled opencode binary with disable-library-validation

> **UPDATE (v18.53, PR #756):** `disable-library-validation` ALONE (shipped in
> v18.52) regressed the engine — the bun binary SIGTRAP-crashes at launch once
> any entitlement is added, because Hardened Runtime then enforces JIT
> restrictions. Corrected decision: a dedicated `opencode.entitlements` with
> `disable-library-validation` + `allow-jit` + `allow-unsigned-executable-memory`
> applied to the opencode binary ONLY, with the app's `Release.entitlements`
> kept strict. See run `2026-06-27-opencode-jit-entitlements-fix.md`. The
> context/rationale below still holds for the dlopen half of the problem.

## Context
The Agents → Terminal tab fails only in notarized release builds: opencode's PTY backend `dlopen()`s a native FFI dylib it extracts to a temp path at runtime, and Hardened Runtime library validation rejects it because the extracted dylib's Team ID differs from the re-signed opencode binary's. The opencode binary was signed with `--options runtime` but no entitlements.

## Decision
Add `com.apple.security.cs.disable-library-validation` to `Release.entitlements` and sign the opencode binary **with** those entitlements in `sign_and_notarize_macos.sh`. The entitlement must be on the process doing the `dlopen` (opencode itself).

## Alternatives considered
- **Separate `opencode.entitlements`** (only opencode gets the relaxed entitlement, app stays stricter): more surgical but adds a second entitlements file and processing step. Rejected for now — the app-wide entitlement is the standard, well-trodden fix and applying it to the outer Flutter app is harmless (it only *permits* loading other-team libs; nothing currently working is weakened). Revisit if a tighter posture is wanted.
- **Re-sign opencode's extracted dylib** with our Team ID: not possible — it's extracted at runtime from inside the bun standalone, not present at sign time.
- **Drop the lipo'd universal binary** (the initial hypothesis): disproved — a single-arch thinned binary failed identically; the cause is library validation, not lipo.

## Consequences
- PTY/terminal works in release once shipped (validate in v18.52).
- `disable-library-validation` is notarization-compatible.
- Future opencode upgrades that change the FFI/native-lib strategy stay covered by the same entitlement.
- Validation requires a real notarized build — this class of bug is invisible to `flutter run` and local test suites.
