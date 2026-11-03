---
date: 2026-10-05
repo: Rhythm
branch: unavailable-detached-task-copy
pr: null
issues: []
status: unverified
tags: [run, rhythm, electron, dayflow]
---

# Dayflow notice-payload verifier

## Files

- `apps/electron/scripts/verify-dayflow-notices.mjs` — new. Exports `verifyDayflowNotices({ legalRoot })` and a CLI
  (`node scripts/verify-dayflow-notices.mjs <absolute legalRoot>`, JSON on stdout, exit 1 on failure). It only reads
  files. It makes no network calls, writes nothing, launches nothing, and has no HOME/PATH/env defaults.
- `apps/electron/test/dayflow-notices.test.mjs` — new. 31 `node:test` cases that run against synthetic temp fixtures only.

## What it checks

- `legalRoot`: must be an absolute path to a real directory, not a symlink.
- Manifest: `notice-sources.json` must be a regular file of at most 64 KiB, opened with `O_NOFOLLOW`. It must be a JSON
  array holding exactly these 10 names, each once: `grdb.swift`, `networkimage`, `posthog-ios`, `sentry-cocoa`,
  `sparkle`, `swift-cmark`, `swift-markdown-ui`, `figtree`, `instrumentserif`, `nunito`.
- Each `file` must be exactly `LICENSE-<name>.txt`, so separators, `..` and absolute paths are rejected. Symlinks are
  rejected through `O_NOFOLLOW`.
- Each `url` must be `https://raw.githubusercontent.com/` with no credentials, query or fragment.
- Dependencies need a 40-hex `sourceRevision`, and the URL must be pinned to that revision.
- Fonts need the literal `Google Fonts official family notice` marker and the exact `google/fonts/main/ofl/<name>/OFL.txt`
  URL.
- Every notice file must be non-empty, and its raw-byte SHA-256 must equal the manifest value.
- The `LICENSE` file next to the manifest must match the full MIT text with `Copyright (c) 2025 Jerry Liu`
  (whitespace-normalized).
- The script reads at most 2 MiB in total.
- The output lists name, kind, file, sha256, bytes and sourceRevision, plus this limitation:
  `license-payload-integrity verified; legal clearance and font binary revision mapping are not established`.

## Checks

- First pass: `cd apps/electron && node --test test/dayflow-notices.test.mjs` → 28 pass, 0 fail. The tests were written first and
  failed red because the module did not exist yet.
- Rejections covered: missing, tampered, empty, forged-hash, malformed-hash, duplicate, missing-entry, unexpected-name,
  traversal, nested and absolute file paths, unpinned or non-public URLs, a dependency or font with the wrong revision,
  missing, corrupt or oversize manifest, oversize total, manifest that is a directory, symlinked manifest, symlinked
  notice escaping root, relative, missing or symlinked root, and a missing, wrong-copyright or truncated Dayflow LICENSE.
- CLI: `env {}` with an explicit root passes. Running with no argument and an alternate HOME fails with JSON. Tampering
  fails with JSON.
- Sol review fix: a FIFO named as the manifest or a notice file could block `open()` forever before the
  regular-file check. Files are now opened with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, so `fstat` rejects FIFOs, and
  every other non-regular file, without reading them.
  - Regression tests: 3 POSIX FIFO cases (`notice-sources.json`, `LICENSE-sparkle.txt`, `LICENSE`). Each makes a FIFO
    with `mkfifo` inside a private temp fixture and runs the CLI in a child process with a 5 s `timeout`. The test
    asserts the child was not killed by a signal, exits 1, and reports `must be a regular file`. These cases are skipped
    on win32.
  - Red check: with `O_NONBLOCK` temporarily removed, all 3 failed via the timeout (about 15 s total) without hanging
    the runner. With the flag restored, `node --test test/dayflow-notices.test.mjs` → 31 pass, 0 fail.
- Real staged payload (`Resources/dayflow-desktop/legal`): the parent ran it independently (not this session). All ten
  source notice hashes pass, `bytesRead` is 36640, and the limitation string is intact.

## Notes / limitations

- This proves the payload's integrity against its own manifest. It does not prove the manifest hashes match upstream:
  the script makes no network fetch, so confirming upstream hashes is still a separate, manual source check.
- It does not establish legal clearance. It does not map font binaries to font revisions: the font entries attest only
  to the official family notice.
- It does not check `THIRD-PARTY-NOTICES.txt`, `NOTICES.md`, `Package.resolved`, or `upstream-app-notices/`.
- No other producer files, bundle, package or sign files, legal files, or `project-state.md` were touched. No git metadata
  was used.
