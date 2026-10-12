---
date: 2026-10-05
repo: Rhythm
branch: unavailable-detached-task-copy
pr: null
issues: []
status: partial
tags: [run, rhythm, electron, dayflow]
---

# Dayflow packaged-app verification

## Files

- `apps/electron/scripts/verify-packaged-dayflow.mjs` — independent, non-launching post-package verifier and JSON receipt CLI.
- `apps/electron/test/dayflow-packaged-verification.test.mjs` — synthetic-tree Node coverage for successful bounded receipt and fail-closed paths.

## Source evidence

- The existing `apps/electron/src/dayflow-desktop-artifact.mjs` remains unchanged and is the trust authority for the pinned upstream Dayflow 2.6.0 (build 133), `teleportlabs.com.Dayflow`, team `L75WYD8X4Y`, arm64 designated requirement, and Gatekeeper check.
- The verifier requires an explicit absolute Rhythm `.app` path; it has no home-directory or PATH fallback for the artifact. It rejects a symlinked outer root, checks the staged `Contents/Resources/dayflow-desktop/Dayflow.app` path is physically rooted below it, verifies the outer app with `codesign --verify --deep --strict`, then calls the upstream validator without modifying either signature.
- The current stager places legal material under `Contents/Resources/dayflow-desktop/legal/`. The verifier now requires real `LICENSE`, `NOTICES.md`, `notice-sources.json`, `THIRD-PARTY-NOTICES.txt`, and at least one `LICENSE-*.txt` source file there. It reports presence only; `scripts/verify-dayflow-notices.mjs` remains the separate authority for manifest hash validation.
- Because the embedded Dayflow validator pins arm64, the verifier also rejects an outer Rhythm executable that lacks arm64. This prevents a file-only green receipt for an x64-only composition that cannot run the companion.
- The outer `CFBundleExecutable` is now accepted only as a single safe basename before any `Contents/MacOS` path resolution. Empty values, `.`, `..`, slash, backslash, and NUL are rejected. This preserves legitimate normal names such as `Rhythm` without permitting an outer receipt to hash or inspect the embedded Dayflow executable through a plist traversal value.
- The receipt is package-integrity-only. It records outer app identity/hash metadata, Dayflow identity/hash metadata, signature outcomes, legal-file presence, and `captureGate: not_tested`. It makes no launch-health, runtime capture, or complete integration claim.

## Checks

- PASS — `cd apps/electron && node --check scripts/verify-packaged-dayflow.mjs`
- PASS — `cd apps/electron && node --test --test-concurrency=1 test/dayflow-packaged-verification.test.mjs` (9 tests: synthetic factory legal paths including manifest/aggregate/source license; absent companion; outer signature failure; absent manifest; x64-only outer rejection; slash traversal and other invalid executable-basename rejections before signing details/lipo; symlinked source root; and JSON CLI fail-closed behavior with no app path).
- PASS — `cd apps/electron && node --test --test-concurrency=1 test/dayflow-desktop-artifact.test.mjs` (6 existing upstream artifact-validator tests).

## Notes / handoff

- Tests inject the command executor only for controlled synthetic fixture trees. They do not establish real macOS signature or Gatekeeper trust.
- No packaged Rhythm app was supplied in this task copy, and no app was launched, installed, re-signed, or granted capture/TCC/auth access. The parent session should invoke the verifier against its real signed artifact once the builder produces it, optionally supplying trusted outer identity flags.
- The task copy is detached (no `.git` directory), so GitNexus impact/diff detection and branch metadata are unavailable here.
- Full release verification remains intentionally unperformed: the required real signed artifact is absent, and package launch, runtime capture qualification, installation, and permission grants are outside this task's authority.
- Parent invocation once a real artifact exists: `node apps/electron/scripts/verify-packaged-dayflow.mjs --app /absolute/path/to/Rhythm.app [--receipt /caller-authorized/receipt.json]`. Optional `--expected-identifier`, `--expected-team-id`, `--expected-version`, `--expected-build`, and `--expected-architecture` flags bind outer-app identity to caller-provided trusted values.
- The first added invalid-basename assertion had the empty-value error wording reversed; it was corrected without changing verifier behavior, then the final focused suite was rerun successfully.
