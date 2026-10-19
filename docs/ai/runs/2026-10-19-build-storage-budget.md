---
date: 2026-10-19
repo: rhythm
branch: mega/2026-09-29-consolidation
pr: null
issues: []
status: local-tooling-tested
tags: [run, rhythm, build-storage]
---

### 2026-10-19 — shared build-storage budget

- Files modified: `tools/build/{guard.py,ensure-guard.mjs,test/test_guard.py}` implement
  locked shared accounting, process-group supervision, marker ownership, stale-run
  proof, bounded receipts and real-process tests; direct Electron/native-wrapper
  and macOS shell entrypoints invoke it. Root npm scripts expose guard/tests.
  AGENTS/testing guide document required commands; a separate dated plan preserves
  existing current-plan and project-state.
- Checks run: `python3 -m unittest discover -s tools/build/test -v` — 16 tests OK
  (7.892 s). Real tiny limits, writes, concurrent processes, generated/retained
  outputs, hardlinks/internal/external symlinks, nested Node/group identity,
  original signals, ignoring grandchild/leader exit, stale marker/group proof and
  actual Node/native/shell preflight. No full package produced by these tests.
- Checks run: `node --test apps/electron/test/colony-package.test.mjs apps/electron/test/stage-native-dayflow.test.mjs apps/electron/test/electron-e10-engine-package.test.mjs`
  — 28 tests, 0 failures. These controlled-input import/assembly tests leave
  package-mac import-only behavior intact.
- Checks run: Node syntax checks on helper + both Node entrypoints, `bash -n` on
  shell wrapper, Python compile checks, `git diff --check` — exit 0.
- Prior failed command: accidentally included `apps/electron/test/electron-unsigned-package.test.mjs`
  in the selected Node test invocation. That test attempted two normal packaging
  commands; both refused immediately at missing `GOOGLE_DESKTOP_CLIENT_ID`, before
  packaging writes/builds. Eight artifact-dependent criteria failed and one
  skipped. This is excluded from proportional checks and was not rerun. Those
  refusals initialized the shared default root with small metadata/receipts only.
- Dependencies: reused canonical `/Users/ajhochhalter/Documents/Rhythm/apps/electron/node_modules`
  via an ignored worktree symlink only after `cmp` confirmed exact package.json
  and package-lock match; Node v22.23.0. No dependency install/ci executed.
- Decisions: stdlib Python + fcntl avoid new dependencies; real-account uid home
  keeps the shared root stable under sanitized HOME/TMPDIR. Retained output paths
  remain registered globally. Scratch cleanup requires ownership proof; stale
  cleanup additionally requires old supervisor identity gone and group empty.
  A shared ceiling only decreases; above-10-GiB limits refuse. Cache/temp routing
  captures npm, XDG and Cargo home/target within disposable scratch.
- Deviations: accidental broad package test invocation described above. No
  installed-app change, app restart, or remote write. Integration and legacy
  cleanup were completed by the parent after independent review.
- Concerns: cooperative sampled limit can overshoot between scans; unregistered
  custom caches/output and children deliberately escaping into a new session
  require explicit configuration/oversight. This log qualifies local build
  tooling; installed-app runtime qualification is separate. GitNexus existing `main`
  impact query returned ambiguous/stale-index results (max candidate risk LOW);
  integration adds top-level guards without editing existing function bodies.

- Integration checkpoint: applied to the existing local mega checkout at ceccb88c;
  independent 16-process-test run and 28 focused Node checks exit 0. Syntax/diff
  checks exit 0; a guarded harmless command ran successfully with a peak under
  1 GiB and no owned run scratch left behind. No app build/install/restart.
- macOS storage setup: the default managed scratch root is now a sticky Time
  Machine exclusion (`tmutil isexcluded` reports Excluded). Source checkouts
  remain backed up; existing backup snapshots were not removed.
- Legacy cleanup: explicit generated-path plan, 83 repository trees retained;
  82 readable repositories compared before deletion, 28 dirty workspaces saved
  as separate staged/unstaged recovery patches. One pre-existing incomplete
  shared clone cannot read its tree and remains untouched. Six dependency/build
  providers retained for 17 incoming links. Completion evidence is in the
  projectless cleanup receipt; source, Git refs and installed app are protected.
- Final cleanup comparison: 1,269 generated targets removed; all 82 readable
  repositories retain identical HEADs, refs, staged and unstaged binary diffs.
  All 1,041,167 protected source/evidence files retain their original identities,
  sizes and mtimes (or symlink targets). Installed executable and rollback ZIP
  hashes match. No source repository or Git directory was deleted.
- Corrected cleanup error: the first classification included 26 Git-tracked
  dependency symlinks. Postcheck caught this; every link was restored exactly.
  One removed target dependency store is now an alias to a retained store after
  exact package.json/lockfile comparison. All restored and incoming links resolve;
  the audit classifier now checks Git ownership before symlink classification.
- Folder accounting: Codex reported about 268 GiB before and 59 GiB after cleanup.
  This is not physical disk space reclaimed: APFS clones and five retained local
  Time Machine snapshots complicate accounting, and other builds were active.
  The user explicitly chose to keep local snapshots; none were thinned/deleted.
- Durable local audit and recovery patches:
  `/Users/ajhochhalter/Documents/Codex/2026-10-19/why/outputs/rhythm-storage-cleanup/`.
  Large before-audit JSONs were gzip-compressed with matching round-trip SHA-256.
- Independent final checks: 20 process tests OK (9.631 s), 28 focused Node tests
  with zero failures, syntax/diff checks exit 0. The guarded canonical issue gate
  exits 0 (Flutter analysis/format and API/MCP typechecks). The full guarded PR
  gate is being recorded separately in `pr-checks.log` in the audit directory.
- Broader-gate repair: the first guarded PR attempt stopped at an API test's
  temporary source-alias symlink (exit 74; peak 1,446,325,699 bytes, not a budget
  breach). Reproduced with a real subprocess regression test before changing
  accounting. Owned per-run `tmp` now counts alias bytes without following or
  deleting their external targets; output-tree external symlinks still refuse.
  All 17 process tests, 28 Node checks and the canonical issue gate then passed.
  Full PR checks restarted from the top; first-attempt output is retained.
- Second broader-gate repair: a real tsx temporary IPC node was rejected by the
  generic unsupported-file rule. A new failing subprocess test reproduced it
  with both a FIFO and Unix socket. Owned temporary IPC nodes now count inode
  bytes and are unlinked after processes exit; IPC nodes in registered output
  trees still refuse. All 19 storage tests, 28 focused Node tests, syntax/diff
  checks and issue checks then passed. An actual guarded tsx command ran for
  300 ms and exited 0. The full PR gate restarted again, retaining attempt two.
- This task's temporary implementation worktree was removed after checking all
  source code against the active checkout and archiving its files/patch in
  `implementation-worktree-backup.zip`. Only the existing mega worktree remains;
  implementation changes are local and uncommitted, with a final patch saved.
- Mobile output audit: added standard Expo `dist-e2e`/`dist`/`.expo`, mobile
  build and iOS/Android project build/cache paths to default accounting. A new
  real preflight test verifies over-budget Expo/iOS/Android output refuses before
  child side effects. A successful guarded command activated the extra watches
  in the shared live registry; the already-running gate reads that registry.
- Broad API gate: only three failures, all in the seven-check #1186 fake sandbox
  lifecycle fixture. Reproduced the exact file: its runtime path comes from
  TMPDIR, and sandbox policy intentionally rejects Documents paths. Reran all
  seven unchanged checks under a dedicated 100 MiB marker-owned guarded fixture
  in `/private/tmp`: 7 passed, exit 0, peak 234,940 bytes, no owned runs/scratch
  left. Product sandbox safety policy and test assertions are unchanged. A blanket
  gate under the default Documents temp pool retains this environment mismatch;
  do not describe that raw command as a full PASS.
- Final broad gate: exit 1, 21/22 batches pass, only the documented #1186 fixture
  environment mismatch fails. API/MCP/web real builds, fork checks, mobile
  browser/Jest checks and Electron unit/type checks pass. Restored 22 tracked
  screenshots regenerated by these tests after archiving their bytes separately.
- Concurrent source consolidation: HEAD advanced ceccb88c → 3c24078b with only
  a consolidation run-log update; product source was unchanged. That separate
  job archived/removed 60 old Rhythm Git checkouts and 28 plain copies. All 60
  deleted checkout HEAD objects remain available in the main Git database;
  35 clone tags, 28 copy tags and clone-tip refs exist. Our initial 82-readable
  Git-tree preservation comparison predates this separate removal.
- Reconciliation caught four historical incoming dependency links whose provider
  directories the separate consolidation removed. Restored two compatibility
  aliases without recreating source checkouts. Mobile reuses a retained store
  with byte-identical archived package/lock files. API dependencies were rebuilt
  from the frozen exact lock into the shared budgeted root; identical-lock native
  package artifacts were reused from canonical Node 22 dependencies. SQLite,
  PTY and tsx probes pass; all 16 surviving incoming links resolve.
- Final Codex accounting: 27.05 GiB (including both cleanups), versus about
  268 GiB initially. Shared budget root plus registered outputs: 1.01 GiB,
  cap 10 GiB, no active runs or per-run scratch. The original five local Time
  Machine snapshots remain, with one newer automatic snapshot; none were
  thinned. Disk free space is not inferred from folder accounting.
- Final concurrent cleanup: d6888ed0 subsequently recorded removal of the
  remaining Oct 1–10 build/evidence/recon folders, retaining the two Hermes
  trees, and included this task's already-tested guard implementation in its
  local commit. No product code beyond this task's changes was introduced.
  Old rollback ZIP/input paths from earlier checkpoints are consequently retired;
  the installed app remains unchanged and original local backups remain.
- The calling historical fixtures and compatibility aliases were also removed
  by that final cleanup. After proving there were no live incoming symlinks or
  open files, retired our now-unused generated API dependency store. Its exact
  manifests, vendored SDK source and provenance are preserved in a round-trip
  checked ZIP in the audit. No dated source folder was recreated afterward.
- Final reconciliation supersedes earlier folder counts: Codex is 1.22 GiB
  by du accounting. All 28 dirty tracked states remain reconstructable from
  reachable original HEADs plus 30 checksum-verified recovery patch files.
  Local archive tag count is 101. Source backups were not thinned; accounting
  reductions do not imply physical free-space recovery while snapshots retain
  old blocks. The final review patch is against 3c24078b and excludes the other
  cleanup's consolidation log.
