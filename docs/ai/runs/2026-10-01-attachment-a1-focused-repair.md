---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-attachments-20261001
pr: 1598
issues: [A1]
status: unverified
tags: [run, Rhythm, attachments]
---

## Files

- `apps/opencode_fork/packages/opencode/src/session/message-v2.ts`: preserve conversion of already-persisted public HTTPS media URLs while continuing to reject unresolved artifact/file display references and keeping ingress rejection of new remote URLs.
- `apps/opencode_fork/packages/opencode/src/session/prompt.ts`: staged unsupported binary bytes now follow the existing file-path reader-discovery flow; recognized content continues to use the owned staged bytes and installed Read tool.
- `apps/opencode_fork/packages/opencode/src/tool/read-xlsx.ts`: stop after 256 ZIP entries before retaining another entry, and budget serialized cell/shared-string expansion before allocating each JSON fragment.
- `apps/opencode_fork/packages/opencode/test/tool/attachment-xlsx.test.ts`: added malformed entry 257 and repeated 8 KiB shared-string regressions; the latter proves rejection before whole-output serialization.

## Checks

- Before edits, existing `message-v2` HTTPS conversion and staged browser-binary reader-discovery tests each reproduced as one failure. The two added XLSX hostile-input tests also failed before production edits (`XLSX_CORRUPT` instead of bounded `XLSX_LIMIT`).
- Focused `bun test test/tool/read.test.ts test/tool/attachment-xlsx.test.ts --timeout 30000`: 57 pass, 0 fail, 138 assertions.
- Focused `bun test test/session/message-v2.test.ts test/session/prompt.test.ts --timeout 30000`: 97 pass, 0 fail, 285 assertions.
- Affected session matrix `bun test test/session/ src/session/ --timeout 30000`: 411 pass, 5 skip, 1 todo, 0 fail, 1162 assertions across 29 files. This closes the two failures recorded in the preceding A1 resume receipt.
- `bun run typecheck` in fork package: exit 0. `git diff --check`: exit 0.
- No live backend, engine, sandbox, installed app, browser, or external-provider check in this focused repair. Prior A1 live checks in the preceding receipt predate these edits and must be rerun for behavioral acceptance.

## Notes

This is a newly narrowed recovery after the two bounded repair cycles documented in `2026-10-01-attachment-a1-resume.md`; those earlier cycles remain recorded. The candidate is uncommitted and unpushed. No dependency installation, server launch, database write, or worktree cleanup occurred in this repair.

GitNexus's existing index was two commits stale. Before source edits, CLI upstream impact returned LOW/0 for `toModelMessagesEffect` and `resolvePart`, HIGH for their containing files (message-v2: 29 direct / 161 total; prompt: 8 direct / 103 total), and UNKNOWN for the unindexed new `readXlsx`. The HIGH scope was disclosed before editing and is limited to the existing A1 attachment repair. No commit was made, so precommit `detect_changes` has not run.

Remaining gate: rebuild the fork, then run the isolated, real engine/API/browser behavior checks from the A1 contract and inspect their exact output before claiming A1 complete. The existing public HTTPS conversion is compatibility for persisted messages; new remote attachment ingress remains rejected. No mobile or shared contract files were changed here.
