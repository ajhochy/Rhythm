---
date: 2026-10-05
tags: [decision, rhythm, electron, dayflow]
---

# Retain Dayflow's upstream Developer ID signature

## Context

Rhythm packages Dayflow 2.6.0 (build 133) as a companion macOS application. The supplied artifact is arm64, bundle identifier `teleportlabs.com.Dayflow`, and Team ID `L75WYD8X4Y`. Re-signing any part of that bundle would replace the upstream identity and could invalidate its expected authorization/data/OS identity behavior.

## Decision

Require an explicit `RHYTHM_DAYFLOW_APP_DIR`; verify its Info.plist identity, arm64 architecture, exact Developer ID requirement, and Gatekeeper assessment before copying. The exact requirement is supplied to `codesign` as an inline source prefixed by `=` (`-R`, `=<requirement>`), because a bare `-R` argument is interpreted as a requirement-file path. Copy the signed app structurally unchanged to `Resources/dayflow-desktop/Dayflow.app`, then repeat the same verification on the staged copy.

The package-time ad-hoc seal is outer-only. The production nested-signing walker excludes the Dayflow app root before traversal, leaving its complete subtree untouched. Immediately before outer signing, production signing repeats the validator. The final outer `codesign --verify --deep --strict` remains in place and therefore still verifies the embedded upstream application.

The walker also ignores every symbolic-link directory entry before attempting Mach-O inspection. This prevents a Resource sibling symlink from aliasing a Dayflow helper/executable into the nested `codesign --force` target list, while ordinary framework directories and their canonical `Versions/A` files remain eligible targets.

The upstream MIT license, combined pinned-source third-party notices, lock/provenance metadata, and individual dependency/font licenses live beside—not inside—the signed Dayflow bundle. The complete repository legal directory is copied to a sibling `legal/` directory. Notices found in an installed upstream app are copied separately as supplementary evidence; Rhythm does not claim those installed notices alone establish legal clearance or manufacture additional attribution.

## Alternatives

- Re-sign Dayflow with Rhythm's identity: rejected because it changes the upstream app's signing identity and violates the companion-bundle boundary.
- Permit a development-checkout, home-directory, or PATH fallback: rejected because it allows an unintended artifact into a release.
- Accept a manifest hash instead of macOS signature/Gatekeeper verification: rejected because a hash is provenance metadata, not a trust authority.

## Consequences

Normal macOS packages require a compatible explicit Dayflow artifact and fail clearly if it is absent or does not match. x64 packages fail rather than embedding the arm64 companion. A dependency/font-notice source absent from the supplied upstream app remains a release legal-review blocker; it must not be solved by inventing notice content.

The bundled legal directory includes raw individual license copies named by `notice-sources.json`; their declared SHA-256 values are independently checkable. The aggregate notice does not replace those source files.
