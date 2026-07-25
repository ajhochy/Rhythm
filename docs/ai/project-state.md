# Project State

## Current focus

Resolve and independently verify every open issue in #1076–#1175 on the
coordinator branch, then run the combined merge gate and open a draft PR.

## Active branch / PR

- Branch: `codex/issues-1076-1175-2026-07-24`
- PR: none; isolated issue worktrees are integrated only after verification.

## In progress

- Integrated and verified: #1096 semantic-memory Settings; #1123 async
  delegation; #1132 generated SDK; #1134 email security; #1135 audit locks;
  #1157 Anthropic schema sanitization; #1161 cookbook profile binding.
- #1137 is integrated but under adversarial follow-up for a newly found fork UI
  post-selection gate and binary @mention containment path.
- Other independently verified slices remain to be integrated.

## Risks / known issues

- #1137 independent review found a P1 fork-UI consumption gap and is validating
  a possible containment regression; completion is frozen until fixed/retested.
- Fork-wide typecheck has one unrelated base failure in
  `GlobalBusEmitter.emit`; focused fork/core suites pass.
- Two fork session timing tests fail in untouched base code.
- #1135's additive SQLite/Postgres change requires normal migration review.
- #1123 adds one Rhythm MCP tool; update the PR tool count.

## Test status

- Every integrated slice has its issue contract and run log with focused/full
  automated checks and live sandbox or signed-client evidence as applicable.
- #1134 security smoke observed zero external sends across all malicious cases.
- #1157 real Anthropic strict-schema call passed against the built fork.
- #1161 live cookbook execution used the profile-bound engine/model/prompt.
- #1137 is review-failed pending repair despite its earlier green gates.
- Aggregate coordinator validation is pending after all slices land.

## Next step

Repair and independently re-review #1137, integrate the remaining issue
commits, finish the mobile dependency chain, then run combined gates and push a
draft PR.
