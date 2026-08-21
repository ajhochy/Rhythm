---
date: 2026-08-14
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [task-live-lifecycle, electron-m1-slice-3]
status: done
tags: [run, Rhythm, retrospective]
---

# Retro — Slice 3 second verification failure (checksum + red-evidence bookkeeping)

## What failed

Verification rerun (session 522e06d5) failed on two non-behavioral items while all 11
behavior criteria passed: `SHA256SUMS` verified 142/144 (drifted: `package.json`,
`src/pages/tasks/fixtures.ts` — both approved Slice 3 adaptations), and the run note
lacked the red-first command/output excerpt for the c5/c7 token repair.

## Why

1. Two repair dispatches edited tracked-inventory files in `apps/web` without running the
   provenance reconciliation step that Slices 1–3 had established (update SHA256SUMS
   entry, extend PROVENANCE hash chain, roll the inventory root). The convention lived in
   PROVENANCE.md but not in the repair-dispatch checklists.
2. The red run was captured in the orchestrator chat transcript and summarized into the
   contract JSON, but never pasted as a command/output excerpt into the run note — the
   only place the gate reads.

## Repairs applied

- SHA256SUMS reconciled → 144/144; new root `1239de54…`; PROVENANCE.md chains extended;
  `task-live-lifecycle.json` root updated.
- Red excerpt (command, counts, early-abort error, affected tests) added to the run note.

## Lessons (applied to future dispatch templates)

1. Any dispatch that may touch a file listed in an `apps/web` SHA256SUMS-style inventory
   MUST include: "after edits, reconcile SHA256SUMS + PROVENANCE.md and record the new
   root in the slice contract" as an explicit step.
2. Red-first evidence is recorded where the gate reads it — the run note — at capture
   time, as a verbatim command/output excerpt, not only summarized in contract JSON.
3. Aborted delegated children (two this session) leave doc steps unfinished more often
   than code steps; post-abort audits must diff the dispatch checklist against the run
   note, not just the code.
