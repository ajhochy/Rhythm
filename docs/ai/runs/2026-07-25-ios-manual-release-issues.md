---
date: 2026-07-25
repo: Rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1175, 1197, 1198, 1199, 1200]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# iOS manual release issues

## Files changed

- Updated `docs/ai/project-state.md` with the ordered human release chain.
- Added this durable issue-creation record.

## Checks run

- Read existing #1076, #1096, and #1175 to avoid duplicate or unrelated work.
- Searched open issues for TestFlight, physical-iPhone, signed-development, and
  independent-review duplicates; only umbrella #1175 overlapped.
- Read back #1197–#1200 from GitHub and confirmed each is open with the expected
  title, body, labels, dependencies, acceptance criteria, likely files,
  evaluation, and safety boundaries.
- GitNexus working-scope detection passed LOW: one indexed documentation file,
  six symbols, and zero affected processes.

## Notes

- Created #1197 for the independent exact-SHA release review.
- Created #1198 for the signed EAS development build.
- Created #1199 for the full isolated physical-iPhone smoke matrix.
- Created #1200 for the production EAS build, exact-artifact TestFlight
  submission, and bounded TestFlight install smoke.
- Added an ordered checklist comment to umbrella #1175:
  #1197 → #1198 → #1199 → #1200.
- No signing, credential rotation, build, device operation, TestFlight
  submission, merge, or production-data mutation occurred in this run.

## Failure triage

- The repository wrapper for GitNexus initially failed with npm registry
  `ENOTFOUND`; it tried to resolve `gitnexus@latest` because no global binary
  was on `PATH`.
- Triage found a complete cached GitNexus 1.6.9 runner and reran the identical
  working-scope analysis locally without a download; the analysis passed LOW.
- No product or documentation fix was needed, and no follow-up issue was filed.
