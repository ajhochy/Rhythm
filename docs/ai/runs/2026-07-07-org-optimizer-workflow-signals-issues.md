---
date: 2026-07-07
repo: Rhythm
branch: unknown
pr: null
issues: [933, 934, 935, 936]
status: complete
tags: [run, Rhythm]
---

## Summary

Created GitHub issues to add workflow-failure signal extraction to the existing Org Optimizer path, so failed/sloppy agent workflow runs can become optimizer proposals instead of requiring manual retrospectives.

## Issues created

- #933 — Add read-only workflow failure signal extractor
- #934 — Add workflow failure signals to org audit snapshot
- #935 — Feed workflow failure signals into existing optimizer lanes
- #936 — Add dedup, cap, and stale-fixed safeguards for workflow signals

## Notes

- V1 intentionally avoids new schema, new UI, and LLM transcript classification.
- Empty parent `task_result` is treated as possible delegate result transport failure, not proof that the delegated session did no work.
- High-risk changes such as scope broadening, delegation grants, or new agents remain review-queued; low-risk recipe/skill refinements can use existing auto-apply/measure behavior.
- Added runtime safety guidance to all four issues: safe to develop while Rhythm is running, start read-only/log-only, cap recent-session queries, and only enable proposal-writing after dedup/cap/stale safeguards are verified.
